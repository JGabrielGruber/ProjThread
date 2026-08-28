import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";
import { parseBearerSessionId } from "../lib/session-id.ts";
import type { CatalogStore } from "./catalog.ts";
import { handleCatalog } from "./catalog-http.ts";
import type { Env } from "./env.ts";
import { handleMe } from "./me.ts";
import { resolveSession, type SessionStore } from "./session.ts";
import type { WikiStore } from "./wiki.ts";
import { handleWiki } from "./wiki-http.ts";

export type WorkerContext = {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
};

const noopCtx: WorkerContext = {
  waitUntil() {},
  passThroughOnException() {},
};

const MCP_OPTIONS = {
  route: "/mcp",
  responseMode: "json" as const,
  legacy: "stateless" as const,
};

type Deps = {
  env: Env;
  sessions: SessionStore;
  catalog: CatalogStore;
  wiki: WikiStore;
  sessionId: string;
};

function compactJson(record: Record<string, unknown>): string {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined) out[key] = value;
  }
  return JSON.stringify(out);
}

function errorText(status: number, text: string): string {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    return JSON.stringify({ status, ...parsed });
  } catch {
    return JSON.stringify({ status, error: text });
  }
}

async function wrap(
  deps: Deps,
  path: string,
  init: RequestInit = {},
): Promise<{
  content: { type: "text"; text: string }[];
  isError?: true;
}> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${deps.sessionId}`);
  const request = new Request(`http://mcp.internal${path}`, { ...init, headers });
  const url = new URL(request.url);
  let res: Response;
  if (url.pathname === "/api/me") {
    res = await handleMe(request, deps.env, deps.sessions, deps.catalog);
  } else if (
    url.pathname.startsWith("/api/nodes") ||
    /^\/api\/workspaces\/[^/]+\/nodes$/.test(url.pathname)
  ) {
    res = await handleWiki(
      request,
      deps.env,
      deps.sessions,
      deps.catalog,
      deps.wiki,
    );
  } else {
    res = await handleCatalog(request, deps.env, deps.sessions, deps.catalog);
  }
  const text = await res.text();
  if (!res.ok) {
    return {
      isError: true,
      content: [{ type: "text", text: errorText(res.status, text) }],
    };
  }
  return { content: [{ type: "text", text: text || "{}" }] };
}

function createServer(deps: Deps): McpServer {
  const server = new McpServer({ name: "projthread", version: "1.0.0" });

  server.registerTool(
    "me",
    { description: "Current principal and workspace memberships", inputSchema: {} },
    async () => wrap(deps, "/api/me"),
  );

  server.registerTool(
    "list_projects",
    {
      description: "List projects in a workspace",
      inputSchema: { workspace_id: z.string() },
    },
    async ({ workspace_id }) =>
      wrap(deps, `/api/workspaces/${workspace_id}/projects`),
  );

  server.registerTool(
    "list_stages",
    {
      description: "List kanban stages in a workspace",
      inputSchema: { workspace_id: z.string() },
    },
    async ({ workspace_id }) =>
      wrap(deps, `/api/workspaces/${workspace_id}/stages`),
  );

  server.registerTool(
    "list_work_items",
    {
      description: "List cards under a project (includes descendants)",
      inputSchema: {
        workspace_id: z.string(),
        project_id: z.string(),
      },
    },
    async ({ workspace_id, project_id }) =>
      wrap(
        deps,
        `/api/workspaces/${workspace_id}/work-items?project_id=${encodeURIComponent(project_id)}`,
      ),
  );

  server.registerTool(
    "get_work_item",
    {
      description: "Get one card by id",
      inputSchema: { work_item_id: z.string() },
    },
    async ({ work_item_id }) => wrap(deps, `/api/work-items/${work_item_id}`),
  );

  server.registerTool(
    "create_work_item",
    {
      description: "Create a card on a project (starts in backlog)",
      inputSchema: {
        workspace_id: z.string(),
        project_id: z.string(),
        title: z.string(),
      },
    },
    async ({ workspace_id, project_id, title }) =>
      wrap(deps, `/api/workspaces/${workspace_id}/work-items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ project_id, title }),
      }),
  );

  server.registerTool(
    "update_work_item_title",
    {
      description: "Rename a card",
      inputSchema: {
        work_item_id: z.string(),
        title: z.string(),
      },
    },
    async ({ work_item_id, title }) =>
      wrap(deps, `/api/work-items/${work_item_id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title }),
      }),
  );

  server.registerTool(
    "move_work_item",
    {
      description: "Move a card between stages (writes Activity, may wake the room)",
      inputSchema: {
        work_item_id: z.string(),
        from: z.string(),
        to: z.string(),
        body: z.string(),
      },
    },
    async ({ work_item_id, from, to, body }) =>
      wrap(deps, `/api/work-items/${work_item_id}/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "stage_changed", from, to, body }),
      }),
  );

  server.registerTool(
    "list_nodes",
    {
      description: "List wiki nodes in a workspace (no full content)",
      inputSchema: { workspace_id: z.string() },
    },
    async ({ workspace_id }) =>
      wrap(deps, `/api/workspaces/${workspace_id}/nodes`),
  );

  server.registerTool(
    "get_node",
    {
      description: "Get a wiki node including markdown content",
      inputSchema: { node_id: z.string() },
    },
    async ({ node_id }) => wrap(deps, `/api/nodes/${node_id}`),
  );

  server.registerTool(
    "create_node",
    {
      description: "Create a markdown wiki node",
      inputSchema: {
        workspace_id: z.string(),
        title: z.string(),
        type: z.string().optional(),
        summary: z.string().optional(),
        content: z.string().optional(),
        work_item_id: z.string().optional(),
      },
    },
    async ({ workspace_id, title, type, summary, content, work_item_id }) =>
      wrap(deps, `/api/workspaces/${workspace_id}/nodes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: compactJson({ title, type, summary, content, work_item_id }),
      }),
  );

  server.registerTool(
    "update_node",
    {
      description: "Patch a wiki node (title, type, summary, content)",
      inputSchema: {
        node_id: z.string(),
        title: z.string().optional(),
        type: z.string().optional(),
        summary: z.string().optional(),
        content: z.string().optional(),
      },
    },
    async ({ node_id, title, type, summary, content }) =>
      wrap(deps, `/api/nodes/${node_id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: compactJson({ title, type, summary, content }),
      }),
  );

  server.registerTool(
    "attach_node_work_item",
    {
      description: "Link a wiki node to a card",
      inputSchema: {
        node_id: z.string(),
        work_item_id: z.string(),
      },
    },
    async ({ node_id, work_item_id }) =>
      wrap(deps, `/api/nodes/${node_id}/work-items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ work_item_id }),
      }),
  );

  return server;
}

function withMcpHttp(request: Request): Request {
  const headers = new Headers(request.headers);
  let changed = false;
  if (!headers.get("host")) {
    headers.set("host", new URL(request.url).host);
    changed = true;
  }
  const accept = headers.get("accept") ?? "";
  if (
    !/\bapplication\/json\b/i.test(accept) ||
    !/\btext\/event-stream\b/i.test(accept)
  ) {
    headers.set("accept", "application/json, text/event-stream");
    changed = true;
  }
  return changed ? new Request(request, { headers }) : request;
}

export async function handleMcp(
  request: Request,
  env: Env,
  sessions: SessionStore,
  catalog: CatalogStore,
  wiki: WikiStore,
  ctx: WorkerContext = noopCtx,
): Promise<Response> {
  const incoming = withMcpHttp(request);

  if (incoming.method === "OPTIONS") {
    return createMcpHandler(
      () =>
        createServer({
          env,
          sessions,
          catalog,
          wiki,
          sessionId: "preflight",
        }),
      MCP_OPTIONS,
    )(incoming, env, ctx);
  }

  const sessionId = parseBearerSessionId(incoming.headers.get("authorization"));
  if (!sessionId) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const principal = await resolveSession(sessions, sessionId);
  if (!principal) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  return createMcpHandler(
    () => createServer({ env, sessions, catalog, wiki, sessionId }),
    MCP_OPTIONS,
  )(incoming, env, ctx);
}
