import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { handleAdmin } from "./admin.ts";
import {
  type CatalogStore,
  type Membership,
  type TenantBundle,
} from "./catalog.ts";
import { COOKIE_NAME } from "../lib/cookies.ts";
import type { Env } from "./env.ts";
import { handleMcp } from "./mcp.ts";
import {
  type Principal,
  type SessionRow,
  type SessionStore,
} from "./session.ts";
import { memoryWikiStore, type WikiStore } from "./wiki.ts";

const ORIGIN = "http://127.0.0.1:8787";
const env = { APP_ORIGIN: ORIGIN } as Env;

const TOOL_NAMES = [
  "me",
  "list_projects",
  "list_stages",
  "list_work_items",
  "get_work_item",
  "create_work_item",
  "update_work_item_title",
  "move_work_item",
  "list_nodes",
  "get_node",
  "create_node",
  "update_node",
  "attach_node_work_item",
] as const;

function unused(): never {
  throw new Error("unused");
}

function memoryCatalog(
  byPrincipal: Map<string, Membership[]> = new Map(),
): CatalogStore {
  const organizations = new Map<
    string,
    { id: string; name: string; created_at: string }
  >();
  const workspaces = new Map<
    string,
    { id: string; organization_id: string; name: string; created_at: string }
  >();
  const memberships = new Map<
    string,
    { workspace_id: string; principal_id: string; role: "owner" | "member" }
  >();

  function membershipKey(workspaceId: string, principalId: string): string {
    return `${workspaceId}:${principalId}`;
  }

  return {
    async listMemberships(principalId) {
      return [...(byPrincipal.get(principalId) ?? [])];
    },
    async getMembership(workspaceId, principalId) {
      const row = memberships.get(membershipKey(workspaceId, principalId));
      if (!row) return null;
      const workspace = workspaces.get(workspaceId);
      if (!workspace) return null;
      const organization = organizations.get(workspace.organization_id);
      if (!organization) return null;
      return {
        organization_id: organization.id,
        organization_name: organization.name,
        workspace_id: workspace.id,
        workspace_name: workspace.name,
        role: row.role,
      };
    },
    listMembers: unused,
    insertMembership: unused,
    listProjects: unused,
    getProject: unused,
    insertProject: unused,
    updateProjectName: unused,
    listStages: unused,
    replaceStages: unused,
    listWorkItems: unused,
    getWorkItem: unused,
    insertWorkItem: unused,
    updateWorkItemTitle: unused,
    async insertTenantBundle(b) {
      organizations.set(b.organization.id, { ...b.organization });
      workspaces.set(b.workspace.id, { ...b.workspace });
      memberships.set(
        membershipKey(b.membership.workspace_id, b.membership.principal_id),
        { ...b.membership },
      );
      const row: Membership = {
        organization_id: b.organization.id,
        organization_name: b.organization.name,
        workspace_id: b.workspace.id,
        workspace_name: b.workspace.name,
        role: b.membership.role,
      };
      const existing = byPrincipal.get(b.membership.principal_id) ?? [];
      byPrincipal.set(b.membership.principal_id, [...existing, row]);
    },
    listOrganizations: unused,
    listWorkItemEvents: unused,
    commitWorkItemEvent: unused,
  };
}

function memoryStore(): SessionStore {
  const principals = new Map<string, Principal>();
  const sessions = new Map<string, SessionRow>();
  return {
    async getPrincipal(id) {
      return principals.get(id) ?? null;
    },
    async insertPrincipal(p) {
      principals.set(p.id, {
        id: p.id,
        type: p.type,
        display_name: p.display_name,
      });
    },
    async listPrincipals() {
      return [...principals.values()];
    },
    async insertSession(row) {
      sessions.set(row.id, { ...row });
    },
    async getSession(id) {
      const row = sessions.get(id);
      return row ? { ...row } : null;
    },
    async revokeSession(id, at) {
      const row = sessions.get(id);
      if (row) sessions.set(id, { ...row, revoked_at: at });
    },
  };
}

async function mintSession(
  store: SessionStore,
): Promise<{ principal: Principal; cookie: string; sessionId: string }> {
  const catalog = memoryCatalog();
  const created = await handleAdmin(
    new Request(`${ORIGIN}/api/admin/principals`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "agent", display_name: "Grok Bot" }),
    }),
    env,
    store,
    catalog,
  );
  const principal = (await created.json()) as Principal;
  const minted = await handleAdmin(
    new Request(`${ORIGIN}/api/admin/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ principal_id: principal.id, set_cookie: false }),
    }),
    env,
    store,
    catalog,
  );
  const { session } = (await minted.json()) as { session: SessionRow };
  const cookieMint = await handleAdmin(
    new Request(`${ORIGIN}/api/admin/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ principal_id: principal.id }),
    }),
    env,
    store,
    catalog,
  );
  const setCookie = cookieMint.headers.get("set-cookie");
  assert.ok(setCookie);
  const cookie = setCookie.split(";")[0]!;
  assert.equal(cookie.slice(`${COOKIE_NAME}=`.length), cookie.split("=")[1]);
  return { principal, cookie, sessionId: session.id };
}

function farmBundle(principalId: string): TenantBundle {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    organization: { id: "org-farm", name: "Farm", created_at: now },
    workspace: {
      id: "ws-farm",
      organization_id: "org-farm",
      name: "Farm",
      created_at: now,
    },
    project: {
      id: "proj-farm",
      workspace_id: "ws-farm",
      organization_id: "org-farm",
      parent_id: null,
      name: "Farm",
      created_at: now,
    },
    principal: {
      id: principalId,
      type: "agent",
      display_name: "Grok Bot",
      created_at: now,
    },
    membership: {
      workspace_id: "ws-farm",
      principal_id: principalId,
      role: "member",
    },
  };
}

async function memberContext(): Promise<{
  cookie: string;
  sessionId: string;
  catalog: ReturnType<typeof memoryCatalog>;
  wiki: WikiStore;
  bundle: TenantBundle;
  sessions: SessionStore;
  principal: Principal;
}> {
  const sessions = memoryStore();
  const { principal, cookie, sessionId } = await mintSession(sessions);
  const catalog = memoryCatalog();
  const wiki = memoryWikiStore();
  const bundle = farmBundle(principal.id);
  await catalog.insertTenantBundle(bundle);
  return { cookie, sessionId, catalog, wiki, bundle, sessions, principal };
}

const META = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientInfo": {
    name: "mcp-test",
    version: "1.0.0",
  },
  "io.modelcontextprotocol/clientCapabilities": {},
};

function rpc(
  method: string,
  params: Record<string, unknown>,
  id = 1,
): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id,
    method,
    params: { ...params, _meta: META },
  });
}

function postMcp(
  headers: HeadersInit,
  method: string,
  params: Record<string, unknown> = {},
  toolName?: string,
): Request {
  const next: Record<string, string> = {
    "content-type": "application/json",
    "mcp-protocol-version": "2026-07-28",
    "mcp-method": method,
  };
  if (toolName) next["mcp-name"] = toolName;
  return new Request(`${ORIGIN}/mcp`, {
    method: "POST",
    headers: { ...next, ...headers },
    body: rpc(method, params),
  });
}

describe("handleMcp", () => {
  it("returns 401 without Authorization", async () => {
    const res = await handleMcp(
      postMcp({}, "server/discover"),
      env,
      memoryStore(),
      memoryCatalog(),
      memoryWikiStore(),
    );
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: "unauthorized" });
  });

  it("returns 401 with cookie only", async () => {
    const { cookie, sessions, catalog, wiki } = await memberContext();
    const res = await handleMcp(
      postMcp({ cookie }, "server/discover"),
      env,
      sessions,
      catalog,
      wiki,
    );
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: "unauthorized" });
  });

  it("returns 401 for Bearer with no token", async () => {
    const res = await handleMcp(
      postMcp({ authorization: "Bearer" }, "server/discover"),
      env,
      memoryStore(),
      memoryCatalog(),
      memoryWikiStore(),
    );
    assert.equal(res.status, 401);
  });

  it("returns 401 for an unknown session id", async () => {
    const res = await handleMcp(
      postMcp(
        { authorization: "Bearer missing" },
        "server/discover",
      ),
      env,
      memoryStore(),
      memoryCatalog(),
      memoryWikiStore(),
    );
    assert.equal(res.status, 401);
  });

  it("server/discover succeeds with a live Bearer session", async () => {
    const { sessionId, sessions, catalog, wiki } = await memberContext();
    const res = await handleMcp(
      postMcp({ authorization: `Bearer ${sessionId}` }, "server/discover"),
      env,
      sessions,
      catalog,
      wiki,
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      jsonrpc: string;
      result?: {
        _meta?: { "io.modelcontextprotocol/serverInfo"?: { name: string } };
      };
    };
    assert.equal(body.jsonrpc, "2.0");
    assert.equal(
      body.result?._meta?.["io.modelcontextprotocol/serverInfo"]?.name,
      "projthread",
    );
  });

  it("tools/list names the catalog wrap", async () => {
    const { sessionId, sessions, catalog, wiki } = await memberContext();
    const res = await handleMcp(
      postMcp({ authorization: `Bearer ${sessionId}` }, "tools/list"),
      env,
      sessions,
      catalog,
      wiki,
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      result?: { tools?: { name: string }[] };
    };
    const names = (body.result?.tools ?? []).map((t) => t.name).sort();
    assert.deepEqual(names, [...TOOL_NAMES].sort());
  });

  it("tools/call me returns the principal", async () => {
    const { sessionId, sessions, catalog, wiki, principal } =
      await memberContext();
    const res = await handleMcp(
      postMcp(
        { authorization: `Bearer ${sessionId}` },
        "tools/call",
        { name: "me", arguments: {} },
        "me",
      ),
      env,
      sessions,
      catalog,
      wiki,
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      result?: { content?: { type: string; text: string }[]; isError?: boolean };
    };
    assert.equal(body.result?.isError, undefined);
    const payload = JSON.parse(body.result?.content?.[0]?.text ?? "{}") as {
      principal: Principal;
    };
    assert.equal(payload.principal.id, principal.id);
    assert.equal(payload.principal.display_name, "Grok Bot");
  });

  it("tools/call create_node writes a wiki node", async () => {
    const { sessionId, sessions, catalog, wiki, bundle } =
      await memberContext();
    const res = await handleMcp(
      postMcp(
        { authorization: `Bearer ${sessionId}` },
        "tools/call",
        {
          name: "create_node",
          arguments: {
            workspace_id: bundle.workspace.id,
            title: "Feed schedule",
            type: "note",
            content: "Twice daily.",
          },
        },
        "create_node",
      ),
      env,
      sessions,
      catalog,
      wiki,
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      result?: { content?: { type: string; text: string }[]; isError?: boolean };
    };
    assert.notEqual(body.result?.isError, true);
    const payload = JSON.parse(body.result?.content?.[0]?.text ?? "{}") as {
      node: { title: string; workspace_id: string };
    };
    assert.equal(payload.node.title, "Feed schedule");
    assert.equal(payload.node.workspace_id, bundle.workspace.id);
  });
});
