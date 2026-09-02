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

const MCP_INSTRUCTIONS = `ProjThread is a live workspace, not a ticket tracker. A card is the work (one card, one chat room — chat is not on this server). Wiki is reusable knowledge. Activity on a card is working memory. Start with session_briefing; wiki_read the pins — that is how this workspace works. Then search. Session may bind workspace; omit workspace_id when bound or when there is one membership. Maintain members, projects, stages, and extra workspaces with workspace_create, members_*, project_*, stages_replace. principal_id is an id, not a display name.`;

const HITS_CAP = 50;

const WORKSPACE_REQUIRED = {
  error: "workspace_required",
  hint: "Pass workspace_id from session_briefing.",
} as const;

type Deps = {
  env: Env;
  sessions: SessionStore;
  catalog: CatalogStore;
  wiki: WikiStore;
  sessionId: string;
};

type ToolOut = {
  content: { type: "text"; text: string }[];
  isError?: true;
};

type MembershipView = {
  workspace_id: string;
  workspace_name: string;
  role: "owner" | "member";
};

type MePayload = {
  principal: { id: string; type: string; display_name: string };
  memberships: MembershipView[];
  workspace_id: string | null;
};

type CompactCard = {
  id: string;
  title: string;
  stage_key: string;
  project_id: string;
  updated_at: string;
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

function jsonResult(obj: unknown): ToolOut {
  return { content: [{ type: "text", text: JSON.stringify(obj) }] };
}

function errorResult(obj: Record<string, unknown>): ToolOut {
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(obj) }],
  };
}

function isErrorOut(value: unknown): value is ToolOut & { isError: true } {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as ToolOut).isError === true
  );
}

async function wrap(
  deps: Deps,
  path: string,
  init: RequestInit = {},
  mode: "json" | "node" = "json",
): Promise<ToolOut> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${deps.sessionId}`);
  const request = new Request(`http://mcp.internal${path}`, { ...init, headers });
  const url = new URL(request.url);
  let res: Response;
  if (url.pathname === "/api/me") {
    res = await handleMe(request, deps.env, deps.sessions, deps.catalog);
  } else if (
    url.pathname.startsWith("/api/nodes") ||
    /^\/api\/workspaces\/[^/]+\/nodes$/.test(url.pathname) ||
    /^\/api\/work-items\/[^/]+\/nodes$/.test(url.pathname)
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
  if (mode === "node") return nodeToolResult(text);
  return { content: [{ type: "text", text: text || "{}" }] };
}

function nodeEnvelope(text: string): { markdown: string; envelope: string } {
  let parsed: { node?: Record<string, unknown> };
  try {
    parsed = JSON.parse(text) as { node?: Record<string, unknown> };
  } catch {
    return { markdown: "", envelope: text || "{}" };
  }
  const markdown =
    typeof parsed.node?.content === "string" ? parsed.node.content : "";
  const envelope: Record<string, unknown> = { ...parsed };
  if (parsed.node && typeof parsed.node === "object") {
    const {
      content: _content,
      blob_key: _blobKey,
      mime_type: _mimeType,
      byte_size: _byteSize,
      filename: _filename,
      ...rest
    } = parsed.node;
    envelope.node = rest;
  }
  return { markdown, envelope: JSON.stringify(envelope) };
}

function nodeToolResult(text: string): ToolOut {
  const { markdown, envelope } = nodeEnvelope(text);
  return {
    content: [
      { type: "text", text: markdown },
      { type: "text", text: envelope },
    ],
  };
}

function parseWrapJson(result: ToolOut): ToolOut | Record<string, unknown> {
  if (result.isError) return result;
  try {
    return JSON.parse(result.content[0]?.text ?? "{}") as Record<
      string,
      unknown
    >;
  } catch {
    return result;
  }
}

async function loadMe(deps: Deps): Promise<ToolOut | MePayload> {
  const parsed = parseWrapJson(await wrap(deps, "/api/me"));
  if (isErrorOut(parsed)) return parsed;
  const record = parsed as Record<string, unknown>;
  const principal = record.principal as MePayload["principal"];
  const memberships = (record.memberships as MePayload["memberships"]) ?? [];
  const workspace_id =
    typeof record.workspace_id === "string" ? record.workspace_id : null;
  return { principal, memberships, workspace_id };
}

async function workspaceId(
  deps: Deps,
  explicit?: string,
): Promise<string | ToolOut> {
  const me = await loadMe(deps);
  if (isErrorOut(me)) return me;
  const memberships = me.memberships;
  if (explicit) {
    if (!memberships.some((row) => row.workspace_id === explicit)) {
      return errorResult({ ...WORKSPACE_REQUIRED });
    }
    return explicit;
  }
  if (
    typeof me.workspace_id === "string" &&
    memberships.some((row) => row.workspace_id === me.workspace_id)
  ) {
    return me.workspace_id;
  }
  if (memberships.length === 1) return memberships[0]!.workspace_id;
  return errorResult({ ...WORKSPACE_REQUIRED });
}

function compactCard(item: {
  id: string;
  title: string;
  stage_key: string;
  project_id: string;
  updated_at: string;
}): CompactCard {
  return {
    id: item.id,
    title: item.title,
    stage_key: item.stage_key,
    project_id: item.project_id,
    updated_at: item.updated_at,
  };
}

function capHits<T>(hits: T[]): { hits: T[]; truncated: boolean } {
  const truncated = hits.length > HITS_CAP;
  return { hits: hits.slice(0, HITS_CAP), truncated };
}

function substringMatch(haystack: string, query: string): boolean {
  return haystack.toLowerCase().includes(query.toLowerCase());
}

async function listRootCards(
  deps: Deps,
  workspace: string,
): Promise<ToolOut | { cards: CompactCard[]; truncated: boolean }> {
  const projectsParsed = parseWrapJson(
    await wrap(deps, `/api/workspaces/${workspace}/projects`),
  );
  if (isErrorOut(projectsParsed)) return projectsParsed;
  const projects = (projectsParsed.projects as {
    id: string;
    parent_id: string | null;
  }[]) ?? [];
  const roots = projects.filter((project) => project.parent_id === null);
  const cards: CompactCard[] = [];
  for (const root of roots) {
    const listed = parseWrapJson(
      await wrap(
        deps,
        `/api/workspaces/${workspace}/work-items?project_id=${encodeURIComponent(root.id)}`,
      ),
    );
    if (isErrorOut(listed)) return listed;
    const items = (listed.work_items as CompactCard[]) ?? [];
    for (const item of items) cards.push(compactCard(item));
  }
  const truncated = cards.length > HITS_CAP;
  return { cards: cards.slice(0, HITS_CAP), truncated };
}

const READ = { readOnlyHint: true, idempotentHint: true } as const;
const WRITE = { readOnlyHint: false } as const;

function createServer(deps: Deps): McpServer {
  const server = new McpServer(
    { name: "projthread", version: "1.0.0" },
    { instructions: MCP_INSTRUCTIONS },
  );

  server.registerTool(
    "session_briefing",
    {
      description:
        "Tool to compile who you are and the workspace board (projects, stages, compact cards). Side effects: none.",
      inputSchema: { workspace_id: z.string().optional() },
      annotations: READ,
    },
    async ({ workspace_id }) => {
      const me = await loadMe(deps);
      if (isErrorOut(me)) return me;
      const bound =
        typeof me.workspace_id === "string" &&
        me.memberships.some((row) => row.workspace_id === me.workspace_id);
      if (!workspace_id && me.memberships.length !== 1 && !bound) {
        return jsonResult({
          principal: me.principal,
          memberships: me.memberships.map((row) => ({
            workspace_id: row.workspace_id,
            workspace_name: row.workspace_name,
            role: row.role,
          })),
        });
      }
      const ws = await workspaceId(deps, workspace_id);
      if (typeof ws !== "string") return ws;
      const membership = me.memberships.find((row) => row.workspace_id === ws);
      if (!membership) return errorResult({ ...WORKSPACE_REQUIRED });
      const projectsParsed = parseWrapJson(
        await wrap(deps, `/api/workspaces/${ws}/projects`),
      );
      if (isErrorOut(projectsParsed)) return projectsParsed;
      const stagesParsed = parseWrapJson(
        await wrap(deps, `/api/workspaces/${ws}/stages`),
      );
      if (isErrorOut(stagesParsed)) return stagesParsed;
      const board = await listRootCards(deps, ws);
      if (isErrorOut(board)) return board;
      const nodesParsed = parseWrapJson(
        await wrap(deps, `/api/workspaces/${ws}/nodes`),
      );
      if (isErrorOut(nodesParsed)) return nodesParsed;
      const pins = (
        (nodesParsed.nodes as {
          id: string;
          title: string;
          type: string;
          summary: string | null;
          pinned: number;
          updated_at: string;
        }[]) ?? []
      )
        .filter((node) => node.pinned === 1)
        .sort((a, b) => {
          if (a.updated_at > b.updated_at) return -1;
          if (a.updated_at < b.updated_at) return 1;
          if (a.id > b.id) return -1;
          if (a.id < b.id) return 1;
          return 0;
        })
        .slice(0, 10)
        .map((node) => ({
          id: node.id,
          title: node.title,
          type: node.type,
          summary: node.summary,
        }));
      const projects = (
        (projectsParsed.projects as {
          id: string;
          name: string;
          parent_id: string | null;
        }[]) ?? []
      ).map((project) => ({
        id: project.id,
        name: project.name,
        parent_id: project.parent_id,
      }));
      const stages = (
        (stagesParsed.stages as {
          key: string;
          label: string;
          position: number;
        }[]) ?? []
      ).map((stage) => ({
        key: stage.key,
        label: stage.label,
        position: stage.position,
      }));
      return jsonResult({
        principal: me.principal,
        workspace: {
          id: membership.workspace_id,
          name: membership.workspace_name,
          role: membership.role,
        },
        projects,
        stages,
        cards: board.cards,
        truncated: board.truncated,
        pins,
      });
    },
  );

  server.registerTool(
    "wiki_search",
    {
      description:
        "Tool to search wiki nodes by title/summary substring. Side effects: none.",
      inputSchema: {
        query: z.string().min(1),
        type: z.string().optional(),
        workspace_id: z.string().optional(),
      },
      annotations: READ,
    },
    async ({ query, type, workspace_id }) => {
      if (!query) {
        return errorResult({
          error: "query_required",
          hint: "wiki_search needs query; do not list the whole wiki.",
        });
      }
      const ws = await workspaceId(deps, workspace_id);
      if (typeof ws !== "string") return ws;
      const listed = parseWrapJson(
        await wrap(deps, `/api/workspaces/${ws}/nodes`),
      );
      if (isErrorOut(listed)) return listed;
      const nodes = (listed.nodes as {
        id: string;
        title: string;
        type: string;
        summary: string | null;
        updated_at: string;
      }[]) ?? [];
      const matched = nodes.filter((node) => {
        if (type && node.type !== type) return false;
        if (substringMatch(node.title, query)) return true;
        if (node.summary && substringMatch(node.summary, query)) return true;
        return false;
      });
      const { hits, truncated } = capHits(
        matched.map((node) => ({
          id: node.id,
          title: node.title,
          type: node.type,
          summary: node.summary,
          updated_at: node.updated_at,
        })),
      );
      return jsonResult({ hits, truncated });
    },
  );

  server.registerTool(
    "wiki_read",
    {
      description:
        "Tool to read one wiki page. Side effects: none.",
      inputSchema: { node_id: z.string() },
      annotations: READ,
    },
    async ({ node_id }) => wrap(deps, `/api/nodes/${node_id}`, {}, "node"),
  );

  server.registerTool(
    "wiki_create",
    {
      description:
        "Tool to create a wiki page. Side effects: write.",
      inputSchema: {
        title: z.string(),
        type: z.string().optional(),
        summary: z.string().optional(),
        content: z.string().optional(),
        work_item_id: z.string().optional(),
        workspace_id: z.string().optional(),
      },
      annotations: WRITE,
    },
    async ({ title, type, summary, content, work_item_id, workspace_id }) => {
      const ws = await workspaceId(deps, workspace_id);
      if (typeof ws !== "string") return ws;
      return wrap(
        deps,
        `/api/workspaces/${ws}/nodes`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: compactJson({ title, type, summary, content, work_item_id }),
        },
        "node",
      );
    },
  );

  server.registerTool(
    "wiki_write",
    {
      description:
        "Tool to patch canonical wiki (title, type, summary, content). Side effects: write; overwrites the page.",
      inputSchema: {
        node_id: z.string(),
        title: z.string().optional(),
        type: z.string().optional(),
        summary: z.string().optional(),
        content: z.string().optional(),
      },
      annotations: WRITE,
    },
    async ({ node_id, title, type, summary, content }) => {
      if (
        title === undefined &&
        type === undefined &&
        summary === undefined &&
        content === undefined
      ) {
        return errorResult({
          error: "patch_required",
          hint: "Pass at least one of title, type, summary, content.",
        });
      }
      return wrap(
        deps,
        `/api/nodes/${node_id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: compactJson({ title, type, summary, content }),
        },
        "node",
      );
    },
  );

  server.registerTool(
    "compose_node",
    {
      description:
        "Tool to include a wiki node as an ordered child. Side effects: write.",
      inputSchema: {
        node_id: z.string(),
        child_id: z.string(),
        position: z.number().int().optional(),
      },
      annotations: WRITE,
    },
    async ({ node_id, child_id, position }) =>
      wrap(
        deps,
        `/api/nodes/${node_id}/includes`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: compactJson({ child_id, position }),
        },
        "node",
      ),
  );

  server.registerTool(
    "cite_node",
    {
      description:
        "Tool to cite another wiki node (ref, not include). Side effects: write.",
      inputSchema: {
        node_id: z.string(),
        to_id: z.string(),
      },
      annotations: WRITE,
    },
    async ({ node_id, to_id }) =>
      wrap(
        deps,
        `/api/nodes/${node_id}/refs`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ to_id }),
        },
        "node",
      ),
  );

  server.registerTool(
    "attach_node_work_item",
    {
      description:
        "Tool to link a wiki node to a card. Side effects: write.",
      inputSchema: {
        node_id: z.string(),
        work_item_id: z.string(),
      },
      annotations: WRITE,
    },
    async ({ node_id, work_item_id }) =>
      wrap(deps, `/api/nodes/${node_id}/work-items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ work_item_id }),
      }),
  );

  server.registerTool(
    "card_search",
    {
      description:
        "Tool to find cards (id, title, stage, project). Side effects: none.",
      inputSchema: {
        query: z.string().optional(),
        project_id: z.string().optional(),
        stage_key: z.string().optional(),
        workspace_id: z.string().optional(),
      },
      annotations: READ,
    },
    async ({ query, project_id, stage_key, workspace_id }) => {
      const ws = await workspaceId(deps, workspace_id);
      if (typeof ws !== "string") return ws;
      let cards: CompactCard[];
      if (project_id) {
        const listed = parseWrapJson(
          await wrap(
            deps,
            `/api/workspaces/${ws}/work-items?project_id=${encodeURIComponent(project_id)}`,
          ),
        );
        if (isErrorOut(listed)) return listed;
        cards = ((listed.work_items as CompactCard[]) ?? []).map(compactCard);
      } else {
        const board = await listRootCards(deps, ws);
        if (isErrorOut(board)) return board;
        cards = board.cards;
      }
      const matched = cards.filter((card) => {
        if (stage_key && card.stage_key !== stage_key) return false;
        if (query && !substringMatch(card.title, query)) return false;
        return true;
      });
      const { hits, truncated } = capHits(matched);
      return jsonResult({ hits, truncated });
    },
  );

  server.registerTool(
    "card_get",
    {
      description:
        "Tool to get one card plus last N Activity events. Side effects: none.",
      inputSchema: {
        work_item_id: z.string(),
        limit: z.number().int().min(1).max(20).optional(),
      },
      annotations: READ,
    },
    async ({ work_item_id, limit }) => {
      const n = limit ?? 10;
      const itemParsed = parseWrapJson(
        await wrap(deps, `/api/work-items/${work_item_id}`),
      );
      if (isErrorOut(itemParsed)) return itemParsed;
      const eventsParsed = parseWrapJson(
        await wrap(deps, `/api/work-items/${work_item_id}/events`),
      );
      if (isErrorOut(eventsParsed)) return eventsParsed;
      const events = (eventsParsed.events as unknown[]) ?? [];
      return jsonResult({
        card: compactCard(itemParsed as unknown as CompactCard),
        events: events.slice(-n),
      });
    },
  );

  server.registerTool(
    "card_create",
    {
      description:
        "Tool to create a card on a project (starts in backlog). Side effects: write unless exists.",
      inputSchema: {
        project_id: z.string(),
        title: z.string(),
        workspace_id: z.string().optional(),
      },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async ({ project_id, title, workspace_id }) => {
      const ws = await workspaceId(deps, workspace_id);
      if (typeof ws !== "string") return ws;
      const listed = parseWrapJson(
        await wrap(
          deps,
          `/api/workspaces/${ws}/work-items?project_id=${encodeURIComponent(project_id)}`,
        ),
      );
      if (isErrorOut(listed)) return listed;
      const items = (listed.work_items as CompactCard[]) ?? [];
      const existing = items.find((item) => item.title === title);
      if (existing) {
        return jsonResult({
          already_exists: true,
          card: compactCard(existing),
        });
      }
      const created = parseWrapJson(
        await wrap(deps, `/api/workspaces/${ws}/work-items`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ project_id, title }),
        }),
      );
      if (isErrorOut(created)) return created;
      return jsonResult({
        already_exists: false,
        card: compactCard(created as unknown as CompactCard),
      });
    },
  );

  server.registerTool(
    "card_rename",
    {
      description:
        "Tool to retitle a card. Side effects: write.",
      inputSchema: {
        work_item_id: z.string(),
        title: z.string(),
      },
      annotations: WRITE,
    },
    async ({ work_item_id, title }) => {
      const parsed = parseWrapJson(
        await wrap(deps, `/api/work-items/${work_item_id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title }),
        }),
      );
      if (isErrorOut(parsed)) return parsed;
      return jsonResult({ card: compactCard(parsed as unknown as CompactCard) });
    },
  );

  server.registerTool(
    "card_move",
    {
      description:
        "Tool to move a card between stages. Side effects: write; writes Activity; may wake the room.",
      inputSchema: {
        work_item_id: z.string(),
        from: z.string(),
        to: z.string(),
        body: z.string(),
      },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ work_item_id, from, to, body }) => {
      const parsed = parseWrapJson(
        await wrap(deps, `/api/work-items/${work_item_id}/events`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "stage_changed", from, to, body }),
        }),
      );
      if (isErrorOut(parsed)) return parsed;
      const workItem = parsed.work_item as CompactCard | undefined;
      return jsonResult({
        event: parsed.event,
        card: workItem ? compactCard(workItem) : workItem,
      });
    },
  );

  server.registerTool(
    "activity_log",
    {
      description:
        "Tool to append a typed Activity event (decision, occurrence, note). Side effects: write; may wake the room.",
      inputSchema: {
        work_item_id: z.string(),
        type: z.enum(["decision", "occurrence", "note"]),
        body: z.string(),
        ref_node_id: z.string().optional(),
      },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ work_item_id, type, body, ref_node_id }) => {
      const parsed = parseWrapJson(
        await wrap(deps, `/api/work-items/${work_item_id}/events`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: compactJson({ type, body, ref_node_id }),
        }),
      );
      if (isErrorOut(parsed)) return parsed;
      const workItem = parsed.work_item as CompactCard | undefined;
      return jsonResult({
        event: parsed.event,
        card: workItem ? compactCard(workItem) : workItem,
      });
    },
  );

  server.registerTool(
    "activity_recent",
    {
      description:
        "Tool to read recent Activity on a card (failed-approach precheck). Side effects: none.",
      inputSchema: {
        work_item_id: z.string(),
        limit: z.number().int().min(1).max(20).optional(),
        type: z.enum(["decision", "occurrence", "note", "stage_changed"]).optional(),
      },
      annotations: READ,
    },
    async ({ work_item_id, limit, type }) => {
      const n = limit ?? 10;
      const parsed = parseWrapJson(
        await wrap(deps, `/api/work-items/${work_item_id}/events`),
      );
      if (isErrorOut(parsed)) return parsed;
      let events = (parsed.events as { type: string }[]) ?? [];
      if (type) events = events.filter((event) => event.type === type);
      return jsonResult({ events: events.slice(-n) });
    },
  );

  server.registerTool(
    "workspace_create",
    {
      description:
        "Tool to create an organization + workspace + root project + default stages; caller becomes owner. Use when this principal needs a new place. Do not use to add a member or a project inside an existing workspace. Side effects: write. Does not mint a principal.",
      inputSchema: { name: z.string() },
      annotations: WRITE,
    },
    async ({ name }) =>
      wrap(deps, "/api/organizations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      }),
  );

  server.registerTool(
    "members_list",
    {
      description:
        "Tool to list workspace members (principal_id, display_name, type, role). Use before add/role/remove. Do not use to search wiki or cards. Side effects: none.",
      inputSchema: { workspace_id: z.string().optional() },
      annotations: READ,
    },
    async ({ workspace_id }) => {
      const ws = await workspaceId(deps, workspace_id);
      if (typeof ws !== "string") return ws;
      return wrap(deps, `/api/workspaces/${ws}/members`);
    },
  );

  server.registerTool(
    "members_add",
    {
      description:
        "Tool to add an existing principal to the workspace. Use a principal_id from briefing or members_list, not a display name. Do not use to create a login. Side effects: write. Unknown principal_id is an error.",
      inputSchema: {
        principal_id: z.string(),
        role: z.enum(["owner", "member"]).optional(),
        workspace_id: z.string().optional(),
      },
      annotations: WRITE,
    },
    async ({ principal_id, role, workspace_id }) => {
      const ws = await workspaceId(deps, workspace_id);
      if (typeof ws !== "string") return ws;
      return wrap(deps, `/api/workspaces/${ws}/members`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: compactJson({ principal_id, role }),
      });
    },
  );

  server.registerTool(
    "members_set_role",
    {
      description:
        "Tool to set a member role (owner or member). Caller must be owner. Do not use to add or remove. Side effects: write. Last owner demotion is an error.",
      inputSchema: {
        principal_id: z.string(),
        role: z.enum(["owner", "member"]),
        workspace_id: z.string().optional(),
      },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ principal_id, role, workspace_id }) => {
      const ws = await workspaceId(deps, workspace_id);
      if (typeof ws !== "string") return ws;
      return wrap(
        deps,
        `/api/workspaces/${ws}/members/${encodeURIComponent(principal_id)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ role }),
        },
      );
    },
  );

  server.registerTool(
    "members_remove",
    {
      description:
        "Tool to remove a member. Caller must be owner. Do not use to change role. Side effects: write. Last owner removal is an error.",
      inputSchema: {
        principal_id: z.string(),
        workspace_id: z.string().optional(),
      },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ principal_id, workspace_id }) => {
      const ws = await workspaceId(deps, workspace_id);
      if (typeof ws !== "string") return ws;
      return wrap(
        deps,
        `/api/workspaces/${ws}/members/${encodeURIComponent(principal_id)}`,
        { method: "DELETE" },
      );
    },
  );

  server.registerTool(
    "project_create",
    {
      description:
        "Tool to create a project (optional parent_id). Use after session_briefing. Do not use to rename or reparent. Side effects: write.",
      inputSchema: {
        name: z.string(),
        parent_id: z.string().optional(),
        workspace_id: z.string().optional(),
      },
      annotations: WRITE,
    },
    async ({ name, parent_id, workspace_id }) => {
      const ws = await workspaceId(deps, workspace_id);
      if (typeof ws !== "string") return ws;
      return wrap(deps, `/api/workspaces/${ws}/projects`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: compactJson({ name, parent_id }),
      });
    },
  );

  server.registerTool(
    "project_rename",
    {
      description:
        "Tool to retitle a project. Use when project_id is known. Do not use to move it in the forest (project_reparent). Side effects: write.",
      inputSchema: {
        project_id: z.string(),
        name: z.string(),
      },
      annotations: WRITE,
    },
    async ({ project_id, name }) =>
      wrap(deps, `/api/projects/${project_id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      }),
  );

  server.registerTool(
    "project_reparent",
    {
      description:
        "Tool to set a project's parent_id (string or null for root). Use to place it in the forest. Do not use to rename. Side effects: write. Cycle or other-workspace parent is an error.",
      inputSchema: {
        project_id: z.string(),
        parent_id: z.union([z.string(), z.null()]),
      },
      annotations: WRITE,
    },
    async ({ project_id, parent_id }) =>
      wrap(deps, `/api/projects/${project_id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ parent_id }),
      }),
  );

  server.registerTool(
    "stages_replace",
    {
      description:
        "Tool to replace workspace stage labels and positions. Pass the full list; keys must stay backlog, doing, done. Do not invent keys. Side effects: write.",
      inputSchema: {
        stages: z.array(
          z.object({
            key: z.string(),
            label: z.string(),
            position: z.number(),
          }),
        ),
        workspace_id: z.string().optional(),
      },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ stages, workspace_id }) => {
      const ws = await workspaceId(deps, workspace_id);
      if (typeof ws !== "string") return ws;
      return wrap(deps, `/api/workspaces/${ws}/stages`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stages }),
      });
    },
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
