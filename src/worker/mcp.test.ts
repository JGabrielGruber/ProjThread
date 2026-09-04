import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { handleAdmin } from "./admin.ts";
import { handleMe } from "./me.ts";
import {
  DEFAULT_STAGES,
  type CatalogStore,
  type Membership,
  type ProjectRow,
  type StageRow,
  type TenantBundle,
  type WorkItemEventRow,
  type WorkItemRow,
  type WorkspaceMemberRow,
} from "./catalog.ts";
import { COOKIE_NAME } from "../lib/cookies.ts";
import { newId } from "../lib/id.ts";
import type { Env } from "./env.ts";
import { handleMcp } from "./mcp.ts";
import { memoryNotifyStore } from "./notify.ts";
import {
  type Principal,
  type SessionRow,
  type SessionStore,
} from "./session.ts";
import { memoryWikiStore, type WikiStore } from "./wiki.ts";

const ORIGIN = "http://127.0.0.1:8787";
const env = {
  APP_ORIGIN: ORIGIN,
  Room: {
    getByName() {
      return {
        fetch: async () => new Response(),
        async appendSystem({ event_id }: { event_id: string }) {
          return {
            seq: 1,
            kind: "activity" as const,
            body: "",
            actor_id: null,
            event_id,
            created_at: "2026-01-01T00:00:00.000Z",
          };
        },
      };
    },
  },
} as Env;

const TOOL_NAMES = [
  "session_briefing",
  "wiki_search",
  "wiki_read",
  "wiki_create",
  "wiki_write",
  "compose_node",
  "cite_node",
  "attach_node_work_item",
  "attach_node_project",
  "card_search",
  "card_get",
  "card_create",
  "card_rename",
  "card_move",
  "activity_log",
  "activity_recent",
  "workspace_create",
  "members_list",
  "members_add",
  "members_set_role",
  "members_remove",
  "project_create",
  "project_rename",
  "project_reparent",
  "stages_replace",
  "notify_list",
  "notify_add",
  "notify_set",
  "notify_remove",
] as const;

function memoryCatalog(): CatalogStore {
  const organizations = new Map<
    string,
    { id: string; name: string; created_at: string }
  >();
  const principals = new Map<
    string,
    {
      id: string;
      type: "human" | "agent" | "service";
      display_name: string;
      created_at: string;
    }
  >();
  const workspaces = new Map<
    string,
    { id: string; organization_id: string; name: string; created_at: string }
  >();
  const memberships = new Map<
    string,
    { workspace_id: string; principal_id: string; role: "owner" | "member" }
  >();
  const stages = new Map<string, StageRow>();
  const projects = new Map<string, ProjectRow & { created_at: string }>();
  const workItems = new Map<string, WorkItemRow>();
  const events = new Map<string, WorkItemEventRow>();

  function membershipKey(workspaceId: string, principalId: string): string {
    return `${workspaceId}:${principalId}`;
  }

  function toMembership(
    workspaceId: string,
    principalId: string,
  ): Membership | null {
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
  }

  return {
    async listMemberships(principalId) {
      const out: Membership[] = [];
      for (const row of memberships.values()) {
        if (row.principal_id !== principalId) continue;
        const m = toMembership(row.workspace_id, principalId);
        if (m) out.push(m);
      }
      return out;
    },
    async getMembership(workspaceId, principalId) {
      return toMembership(workspaceId, principalId);
    },
    async listMembers(workspaceId) {
      const out: WorkspaceMemberRow[] = [];
      for (const row of memberships.values()) {
        if (row.workspace_id !== workspaceId) continue;
        const principal = principals.get(row.principal_id);
        out.push({
          workspace_id: row.workspace_id,
          principal_id: row.principal_id,
          display_name: principal?.display_name ?? "",
          type: principal?.type ?? "human",
          role: row.role,
        });
      }
      return out;
    },
    async updateMembershipRole(workspaceId, principalId, role) {
      const key = membershipKey(workspaceId, principalId);
      const row = memberships.get(key);
      if (!row) return false;
      memberships.set(key, { ...row, role });
      return true;
    },
    async deleteMembership(workspaceId, principalId) {
      const key = membershipKey(workspaceId, principalId);
      if (!memberships.has(key)) return false;
      memberships.delete(key);
      return true;
    },
    async countOwners(workspaceId) {
      let n = 0;
      for (const row of memberships.values()) {
        if (row.workspace_id === workspaceId && row.role === "owner") n += 1;
      }
      return n;
    },
    async insertMembership(row) {
      const key = membershipKey(row.workspace_id, row.principal_id);
      if (memberships.has(key)) return "exists";
      memberships.set(key, { ...row });
      return "inserted";
    },
    async listProjects(workspaceId) {
      return [...projects.values()]
        .filter((p) => p.workspace_id === workspaceId)
        .map(({ created_at: _createdAt, ...row }) => ({ ...row }));
    },
    async getProject(id) {
      const row = projects.get(id);
      return row ? { ...row } : null;
    },
    async insertProject(row) {
      projects.set(row.id, { ...row });
    },
    async updateProjectName(id, name) {
      const row = projects.get(id);
      if (!row) return false;
      projects.set(id, { ...row, name });
      return true;
    },
    async updateProjectParent(id, parentId) {
      const row = projects.get(id);
      if (!row) return false;
      projects.set(id, { ...row, parent_id: parentId });
      return true;
    },
    async listStages(workspaceId) {
      return [...stages.values()]
        .filter((s) => s.workspace_id === workspaceId)
        .sort((a, b) => a.position - b.position)
        .map((s) => ({ ...s }));
    },
    async replaceStages(workspaceId, next) {
      const existing = [...stages.values()].filter(
        (s) => s.workspace_id === workspaceId,
      );
      const existingKeys = new Set(existing.map((s) => s.key));
      const incomingKeys = new Set(next.map((s) => s.key));
      if (
        existingKeys.size !== incomingKeys.size ||
        [...existingKeys].some((key) => !incomingKeys.has(key))
      ) {
        return false;
      }
      for (const stage of next) {
        stages.set(`${workspaceId}:${stage.key}`, { ...stage });
      }
      return true;
    },
    async listWorkItems(workspaceId, projectIds) {
      if (projectIds.length === 0) return [];
      const allowed = new Set(projectIds);
      return [...workItems.values()]
        .filter(
          (item) =>
            item.workspace_id === workspaceId && allowed.has(item.project_id),
        )
        .map((item) => ({ ...item }));
    },
    async getWorkItem(id) {
      const row = workItems.get(id);
      return row ? { ...row } : null;
    },
    async insertWorkItem(row) {
      workItems.set(row.id, { ...row });
    },
    async updateWorkItemTitle(id, title, updatedAt) {
      const row = workItems.get(id);
      if (!row) return false;
      workItems.set(id, { ...row, title, updated_at: updatedAt });
      return true;
    },
    async insertTenantBundle(b) {
      organizations.set(b.organization.id, { ...b.organization });
      principals.set(b.principal.id, { ...b.principal });
      workspaces.set(b.workspace.id, { ...b.workspace });
      for (const stage of DEFAULT_STAGES) {
        const row: StageRow = {
          workspace_id: b.workspace.id,
          key: stage.key,
          label: stage.label,
          position: stage.position,
        };
        stages.set(`${row.workspace_id}:${row.key}`, row);
      }
      projects.set(b.project.id, { ...b.project });
      memberships.set(
        membershipKey(b.membership.workspace_id, b.membership.principal_id),
        {
          ...b.membership,
        },
      );
    },
    async insertWorkspaceFor(principalId, name) {
      const now = new Date().toISOString();
      const organization = { id: newId(), name, created_at: now };
      const workspace = {
        id: newId(),
        organization_id: organization.id,
        name,
        created_at: now,
      };
      const project = {
        id: newId(),
        workspace_id: workspace.id,
        organization_id: organization.id,
        parent_id: null as const,
        name,
        created_at: now,
      };
      organizations.set(organization.id, organization);
      workspaces.set(workspace.id, workspace);
      for (const stage of DEFAULT_STAGES) {
        const row: StageRow = {
          workspace_id: workspace.id,
          key: stage.key,
          label: stage.label,
          position: stage.position,
        };
        stages.set(`${row.workspace_id}:${row.key}`, row);
      }
      projects.set(project.id, project);
      memberships.set(membershipKey(workspace.id, principalId), {
        workspace_id: workspace.id,
        principal_id: principalId,
        role: "owner",
      });
      return {
        organization: { id: organization.id, name },
        workspace: { id: workspace.id, name },
        project: { id: project.id, name, parent_id: null },
      };
    },
    async listOrganizations() {
      return [...organizations.values()].map((o) => ({
        id: o.id,
        name: o.name,
      }));
    },
    async listWorkItemEvents(workItemId) {
      return [...events.values()]
        .filter((row) => row.work_item_id === workItemId)
        .sort((a, b) => {
          if (a.created_at < b.created_at) return -1;
          if (a.created_at > b.created_at) return 1;
          if (a.id < b.id) return -1;
          if (a.id > b.id) return 1;
          return 0;
        })
        .map((row) => ({ ...row }));
    },
    async commitWorkItemEvent(commit) {
      events.set(commit.event.id, { ...commit.event });
      const item = workItems.get(commit.event.work_item_id);
      if (!item) return;
      if (commit.stage_key === undefined && commit.owner_id === undefined) {
        return;
      }
      workItems.set(commit.event.work_item_id, {
        ...item,
        ...(commit.stage_key !== undefined
          ? { stage_key: commit.stage_key }
          : {}),
        ...(commit.owner_id !== undefined ? { owner_id: commit.owner_id } : {}),
        ...(commit.updated_at !== undefined
          ? { updated_at: commit.updated_at }
          : {}),
      });
    },
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
    async updateSessionWorkspace(id, workspaceId) {
      const row = sessions.get(id);
      if (row) sessions.set(id, { ...row, workspace_id: workspaceId });
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

function callTool(
  sessionId: string,
  name: string,
  args: Record<string, unknown>,
) {
  return postMcp(
    { authorization: `Bearer ${sessionId}` },
    "tools/call",
    { name, arguments: args },
    name,
  );
}

async function toolResult(
  res: Response,
): Promise<{
  isError?: boolean;
  content: { type: string; text: string }[];
}> {
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    result?: { content?: { type: string; text: string }[]; isError?: boolean };
  };
  return {
    isError: body.result?.isError,
    content: body.result?.content ?? [],
  };
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

  it("tools/list names the façade", async () => {
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

  it("tools/call wiki_create writes a wiki node", async () => {
    const { sessionId, sessions, catalog, wiki, bundle } =
      await memberContext();
    const result = await toolResult(
      await handleMcp(
        callTool(sessionId, "wiki_create", {
          title: "Feed schedule",
          type: "note",
          content: "Twice daily.",
        }),
        env,
        sessions,
        catalog,
        wiki,
      ),
    );
    assert.notEqual(result.isError, true);
    assert.equal(result.content[0]?.text, "Twice daily.");
    const payload = JSON.parse(result.content[1]?.text ?? "{}") as {
      node: { title: string; workspace_id: string; content?: string };
    };
    assert.equal(payload.node.title, "Feed schedule");
    assert.equal(payload.node.workspace_id, bundle.workspace.id);
    assert.equal(payload.node.content, undefined);
  });

  it("wiki_create content[0] is unescaped markdown", async () => {
    const markdown = 'Hay twice.\n\nSay "ready".';
    const { sessionId, sessions, catalog, wiki } = await memberContext();
    const created = await toolResult(
      await handleMcp(
        callTool(sessionId, "wiki_create", {
          title: "Feed",
          content: markdown,
        }),
        env,
        sessions,
        catalog,
        wiki,
      ),
    );
    assert.notEqual(created.isError, true);
    assert.equal(created.content[0]?.text, markdown);
    assert.equal(created.content[0]?.text.includes("\\n"), false);
    const stored = JSON.parse(created.content[1]?.text ?? "{}") as {
      node: { id: string; content?: string };
    };
    assert.equal(stored.node.content, undefined);
    const got = await toolResult(
      await handleMcp(
        callTool(sessionId, "wiki_read", { node_id: stored.node.id }),
        env,
        sessions,
        catalog,
        wiki,
      ),
    );
    assert.equal(got.content[0]?.text, markdown);
  });

  it("wiki_create payload_kind json puts JSON text in content[0]", async () => {
    const { sessionId, sessions, catalog, wiki } = await memberContext();
    const created = await toolResult(
      await handleMcp(
        callTool(sessionId, "wiki_create", {
          title: "Meta",
          payload_kind: "json",
          content: '{"k":1}',
        }),
        env,
        sessions,
        catalog,
        wiki,
      ),
    );
    assert.notEqual(created.isError, true);
    assert.equal(created.content[0]?.text, '{"k":1}');
    const stored = JSON.parse(created.content[1]?.text ?? "{}") as {
      node: { payload_kind?: string; content?: string };
    };
    assert.equal(stored.node.payload_kind, "json");
    assert.equal(stored.node.content, undefined);
  });

  it("wiki_read blob caption in content[0]; envelope keeps mime, strips blob_key", async () => {
    const { sessionId, sessions, catalog, wiki, bundle } = await memberContext();
    await wiki.insertNode({
      id: "n-blob",
      workspace_id: bundle.workspace.id,
      organization_id: bundle.organization.id,
      type: "note",
      payload_kind: "blob",
      title: "Shot",
      summary: null,
      content: "Front yard",
      blob_key: "ws-farm/n-blob",
      mime_type: "image/png",
      byte_size: 4,
      filename: "shot.png",
      created_at: "2026-01-02T00:00:00.000Z",
      updated_at: "2026-01-02T00:00:00.000Z",
      pinned: 0,
    });
    const result = await toolResult(
      await handleMcp(
        callTool(sessionId, "wiki_read", { node_id: "n-blob" }),
        env,
        sessions,
        catalog,
        wiki,
      ),
    );
    assert.notEqual(result.isError, true);
    assert.equal(result.content[0]?.text, "Front yard");
    const payload = JSON.parse(result.content[1]?.text ?? "{}") as {
      node: {
        mime_type?: string;
        byte_size?: number;
        filename?: string;
        blob_key?: string;
        content?: string;
      };
    };
    assert.equal(payload.node.mime_type, "image/png");
    assert.equal(payload.node.byte_size, 4);
    assert.equal(payload.node.filename, "shot.png");
    assert.equal(payload.node.blob_key, undefined);
    assert.equal(payload.node.content, undefined);
  });

  it("attach_node_project points a node without a card", async () => {
    const { sessionId, sessions, catalog, wiki, bundle } =
      await memberContext();
    const created = await toolResult(
      await handleMcp(
        callTool(sessionId, "wiki_create", { title: "Report" }),
        env,
        sessions,
        catalog,
        wiki,
      ),
    );
    const createdBody = JSON.parse(created.content[1]?.text ?? "{}") as {
      node: { id: string };
    };
    const first = await toolResult(
      await handleMcp(
        callTool(sessionId, "attach_node_project", {
          node_id: createdBody.node.id,
          project_id: bundle.project.id,
        }),
        env,
        sessions,
        catalog,
        wiki,
      ),
    );
    assert.notEqual(first.isError, true);
    const firstJson = JSON.parse(first.content[0]?.text ?? "{}") as {
      project_ids: string[];
      work_item_ids: string[];
    };
    assert.deepEqual(firstJson.project_ids, [bundle.project.id]);
    assert.deepEqual(firstJson.work_item_ids, []);

    const second = await toolResult(
      await handleMcp(
        callTool(sessionId, "attach_node_project", {
          node_id: createdBody.node.id,
          project_id: bundle.project.id,
        }),
        env,
        sessions,
        catalog,
        wiki,
      ),
    );
    assert.notEqual(second.isError, true);

    const read = await toolResult(
      await handleMcp(
        callTool(sessionId, "wiki_read", { node_id: createdBody.node.id }),
        env,
        sessions,
        catalog,
        wiki,
      ),
    );
    const envelope = JSON.parse(read.content[1]?.text ?? "{}") as {
      project_ids: string[];
      node: { content?: string };
    };
    assert.deepEqual(envelope.project_ids, [bundle.project.id]);
    assert.equal(envelope.node.content, undefined);
  });

  it("compose_node includes without citing; cite_node cites without including", async () => {
    const { sessionId, sessions, catalog, wiki } = await memberContext();

    async function create(title: string, content: string) {
      const result = await toolResult(
        await handleMcp(
          callTool(sessionId, "wiki_create", { title, content }),
          env,
          sessions,
          catalog,
          wiki,
        ),
      );
      return JSON.parse(result.content[1]?.text ?? "{}") as {
        node: { id: string };
      };
    }

    const parent = await create("Plan", "Parent body");
    const child = await create("Requirements", "Child body");
    const other = await create("Other plan", "Cite me");

    const composed = await toolResult(
      await handleMcp(
        callTool(sessionId, "compose_node", {
          node_id: parent.node.id,
          child_id: child.node.id,
        }),
        env,
        sessions,
        catalog,
        wiki,
      ),
    );
    assert.notEqual(composed.isError, true);
    assert.equal(composed.content[0]?.text, "Parent body");
    const composedPayload = JSON.parse(composed.content[1]?.text ?? "{}") as {
      includes: { id: string }[];
      refs: { id: string }[];
    };
    assert.equal(composedPayload.includes[0]?.id, child.node.id);
    assert.equal(composedPayload.refs.length, 0);

    const cited = await toolResult(
      await handleMcp(
        callTool(sessionId, "cite_node", {
          node_id: parent.node.id,
          to_id: other.node.id,
        }),
        env,
        sessions,
        catalog,
        wiki,
      ),
    );
    assert.notEqual(cited.isError, true);
    const citedPayload = JSON.parse(cited.content[1]?.text ?? "{}") as {
      includes: { id: string }[];
      refs: { id: string }[];
    };
    assert.equal(citedPayload.refs[0]?.id, other.node.id);
    assert.equal(citedPayload.includes.length, 1);
    assert.equal(citedPayload.includes[0]?.id, child.node.id);
  });

  it("compose_node cycle is isError", async () => {
    const { sessionId, sessions, catalog, wiki } = await memberContext();

    async function create(title: string) {
      const result = await toolResult(
        await handleMcp(
          callTool(sessionId, "wiki_create", { title }),
          env,
          sessions,
          catalog,
          wiki,
        ),
      );
      return JSON.parse(result.content[1]?.text ?? "{}") as {
        node: { id: string };
      };
    }

    const a = await create("A");
    const b = await create("B");
    await handleMcp(
      callTool(sessionId, "compose_node", {
        node_id: a.node.id,
        child_id: b.node.id,
      }),
      env,
      sessions,
      catalog,
      wiki,
    );
    const cycle = await toolResult(
      await handleMcp(
        callTool(sessionId, "compose_node", {
          node_id: b.node.id,
          child_id: a.node.id,
        }),
        env,
        sessions,
        catalog,
        wiki,
      ),
    );
    assert.equal(cycle.isError, true);
  });

  it("session_briefing without workspace_id uses the sole membership", async () => {
    const { sessionId, sessions, catalog, wiki, bundle, principal } =
      await memberContext();
    await catalog.insertWorkItem({
      id: "wi-1",
      project_id: bundle.project.id,
      workspace_id: bundle.workspace.id,
      organization_id: bundle.organization.id,
      title: "Collect eggs",
      stage_key: "doing",
      owner_id: null,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    });
    const result = await toolResult(
      await handleMcp(
        callTool(sessionId, "session_briefing", {}),
        env,
        sessions,
        catalog,
        wiki,
      ),
    );
    assert.notEqual(result.isError, true);
    const payload = JSON.parse(result.content[0]?.text ?? "{}") as {
      principal: { id: string };
      workspace: { id: string };
      cards: { id: string; title: string; stage_key: string }[];
      memberships?: unknown;
    };
    assert.equal(payload.principal.id, principal.id);
    assert.equal(payload.workspace.id, bundle.workspace.id);
    assert.equal(payload.memberships, undefined);
    assert.equal(payload.cards[0]?.title, "Collect eggs");
    assert.equal(payload.cards[0]?.stage_key, "doing");
  });

  it("session_briefing pins titles without bodies; empty when none", async () => {
    const { sessionId, sessions, catalog, wiki, bundle } = await memberContext();
    await wiki.insertNode({
      id: "n-pin",
      workspace_id: bundle.workspace.id,
      organization_id: bundle.organization.id,
      type: "process",
      payload_kind: "markdown",
      title: "How we work",
      summary: "Cold start",
      content: "SECRET_PIN_BODY",
      blob_key: null,
      mime_type: null,
      byte_size: null,
      filename: null,
      created_at: "2026-01-02T00:00:00.000Z",
      updated_at: "2026-01-02T00:00:00.000Z",
      pinned: 1,
    });
    const pinned = await toolResult(
      await handleMcp(
        callTool(sessionId, "session_briefing", {}),
        env,
        sessions,
        catalog,
        wiki,
      ),
    );
    assert.notEqual(pinned.isError, true);
    const text = pinned.content[0]?.text ?? "";
    const payload = JSON.parse(text) as {
      pins: {
        id: string;
        title: string;
        type: string;
        summary: string | null;
        content?: string;
      }[];
    };
    assert.equal(payload.pins[0]?.title, "How we work");
    assert.equal(payload.pins[0]?.type, "process");
    assert.equal(payload.pins[0]?.summary, "Cold start");
    assert.equal(payload.pins[0]?.content, undefined);
    assert.equal(text.includes("SECRET_PIN_BODY"), false);

    await wiki.updateNode("n-pin", {
      pinned: 0,
      updated_at: "2026-01-03T00:00:00.000Z",
    });
    const empty = await toolResult(
      await handleMcp(
        callTool(sessionId, "session_briefing", {}),
        env,
        sessions,
        catalog,
        wiki,
      ),
    );
    const emptyPayload = JSON.parse(empty.content[0]?.text ?? "{}") as {
      pins: unknown[];
    };
    assert.deepEqual(emptyPayload.pins, []);
  });

  it("session_briefing with two memberships lists them until workspace_id is passed", async () => {
    const { sessionId, sessions, catalog, wiki, bundle, principal } =
      await memberContext();
    await catalog.insertTenantBundle({
      organization: {
        id: "org-consult",
        name: "Consultoria",
        created_at: "2026-01-01T00:00:00.000Z",
      },
      workspace: {
        id: "ws-consult",
        organization_id: "org-consult",
        name: "Consultoria",
        created_at: "2026-01-01T00:00:00.000Z",
      },
      project: {
        id: "proj-consult",
        workspace_id: "ws-consult",
        organization_id: "org-consult",
        parent_id: null,
        name: "Consultoria",
        created_at: "2026-01-01T00:00:00.000Z",
      },
      principal: {
        id: principal.id,
        type: "agent",
        display_name: principal.display_name,
        created_at: "2026-01-01T00:00:00.000Z",
      },
      membership: {
        workspace_id: "ws-consult",
        principal_id: principal.id,
        role: "member",
      },
    });
    const listed = await toolResult(
      await handleMcp(
        callTool(sessionId, "session_briefing", {}),
        env,
        sessions,
        catalog,
        wiki,
      ),
    );
    const listedPayload = JSON.parse(listed.content[0]?.text ?? "{}") as {
      memberships: { workspace_id: string }[];
      cards?: unknown;
      pins?: unknown;
    };
    assert.equal(listedPayload.memberships.length, 2);
    assert.equal(listedPayload.cards, undefined);
    assert.equal("pins" in listedPayload, false);

    const wikiFail = await toolResult(
      await handleMcp(
        callTool(sessionId, "wiki_search", { query: "feed" }),
        env,
        sessions,
        catalog,
        wiki,
      ),
    );
    assert.equal(wikiFail.isError, true);
    assert.match(wikiFail.content[0]?.text ?? "", /workspace_required/);

    const farm = await toolResult(
      await handleMcp(
        callTool(sessionId, "session_briefing", {
          workspace_id: bundle.workspace.id,
        }),
        env,
        sessions,
        catalog,
        wiki,
      ),
    );
    const farmPayload = JSON.parse(farm.content[0]?.text ?? "{}") as {
      workspace: { id: string };
    };
    assert.equal(farmPayload.workspace.id, bundle.workspace.id);
  });

  it("session_briefing without workspace_id uses bound session workspace", async () => {
    const { sessionId, sessions, catalog, wiki, bundle, principal } =
      await memberContext();
    await catalog.insertTenantBundle({
      organization: {
        id: "org-consult",
        name: "Consultoria",
        created_at: "2026-01-01T00:00:00.000Z",
      },
      workspace: {
        id: "ws-consult",
        organization_id: "org-consult",
        name: "Consultoria",
        created_at: "2026-01-01T00:00:00.000Z",
      },
      project: {
        id: "proj-consult",
        workspace_id: "ws-consult",
        organization_id: "org-consult",
        parent_id: null,
        name: "Consultoria",
        created_at: "2026-01-01T00:00:00.000Z",
      },
      principal: {
        id: principal.id,
        type: "agent",
        display_name: principal.display_name,
        created_at: "2026-01-01T00:00:00.000Z",
      },
      membership: {
        workspace_id: "ws-consult",
        principal_id: principal.id,
        role: "member",
      },
    });
    const patched = await handleMe(
      new Request(`${ORIGIN}/api/me`, {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${sessionId}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ workspace_id: bundle.workspace.id }),
      }),
      env,
      sessions,
      catalog,
    );
    assert.equal(patched.status, 200);
    const result = await toolResult(
      await handleMcp(
        callTool(sessionId, "session_briefing", {}),
        env,
        sessions,
        catalog,
        wiki,
      ),
    );
    assert.notEqual(result.isError, true);
    const payload = JSON.parse(result.content[0]?.text ?? "{}") as {
      workspace: { id: string };
      memberships?: unknown;
    };
    assert.equal(payload.workspace.id, bundle.workspace.id);
    assert.equal(payload.memberships, undefined);
  });

  it("server instructions mention bound workspace", async () => {
    const { sessionId, sessions, catalog, wiki } = await memberContext();
    const res = await handleMcp(
      postMcp({ authorization: `Bearer ${sessionId}` }, "server/discover"),
      env,
      sessions,
      catalog,
      wiki,
    );
    assert.equal(res.status, 200);
    const text = JSON.stringify(await res.json());
    assert.match(
      text,
      /Session may bind workspace; omit workspace_id when bound or when there is one membership\./,
    );
  });

  it("wiki_search returns hits without content", async () => {
    const { sessionId, sessions, catalog, wiki } = await memberContext();
    await handleMcp(
      callTool(sessionId, "wiki_create", {
        title: "Feed schedule",
        content: "Twice daily. Secret ration.",
      }),
      env,
      sessions,
      catalog,
      wiki,
    );
    const result = await toolResult(
      await handleMcp(
        callTool(sessionId, "wiki_search", { query: "feed" }),
        env,
        sessions,
        catalog,
        wiki,
      ),
    );
    assert.notEqual(result.isError, true);
    const payload = JSON.parse(result.content[0]?.text ?? "{}") as {
      hits: { title: string; content?: string }[];
    };
    assert.equal(payload.hits[0]?.title, "Feed schedule");
    assert.equal(payload.hits[0]?.content, undefined);
    assert.equal(result.content[0]?.text.includes("Secret ration"), false);
  });

  it("card_create is idempotent on title in the same project", async () => {
    const { sessionId, sessions, catalog, wiki, bundle } = await memberContext();
    const first = await toolResult(
      await handleMcp(
        callTool(sessionId, "card_create", {
          project_id: bundle.project.id,
          title: "Collect eggs",
        }),
        env,
        sessions,
        catalog,
        wiki,
      ),
    );
    const firstPayload = JSON.parse(first.content[0]?.text ?? "{}") as {
      already_exists: boolean;
      card: { id: string; title: string };
    };
    assert.equal(firstPayload.already_exists, false);
    const second = await toolResult(
      await handleMcp(
        callTool(sessionId, "card_create", {
          project_id: bundle.project.id,
          title: "Collect eggs",
        }),
        env,
        sessions,
        catalog,
        wiki,
      ),
    );
    const secondPayload = JSON.parse(second.content[0]?.text ?? "{}") as {
      already_exists: boolean;
      card: { id: string };
    };
    assert.equal(secondPayload.already_exists, true);
    assert.equal(secondPayload.card.id, firstPayload.card.id);
  });

  it("activity_log then activity_recent round-trips a decision", async () => {
    const { sessionId, sessions, catalog, wiki, bundle } = await memberContext();
    const created = await toolResult(
      await handleMcp(
        callTool(sessionId, "card_create", {
          project_id: bundle.project.id,
          title: "Nest boxes",
        }),
        env,
        sessions,
        catalog,
        wiki,
      ),
    );
    const card = JSON.parse(created.content[0]?.text ?? "{}") as {
      card: { id: string };
    };
    const logged = await toolResult(
      await handleMcp(
        callTool(sessionId, "activity_log", {
          work_item_id: card.card.id,
          type: "decision",
          body: "Rejected hourly collection; twice daily stays.",
        }),
        env,
        sessions,
        catalog,
        wiki,
      ),
    );
    assert.notEqual(logged.isError, true);
    const recent = await toolResult(
      await handleMcp(
        callTool(sessionId, "activity_recent", {
          work_item_id: card.card.id,
        }),
        env,
        sessions,
        catalog,
        wiki,
      ),
    );
    const payload = JSON.parse(recent.content[0]?.text ?? "{}") as {
      events: { type: string; body: string }[];
    };
    assert.equal(payload.events.at(-1)?.type, "decision");
    assert.match(payload.events.at(-1)?.body ?? "", /twice daily/i);
  });

  it("workspace_create returns org, workspace, root project; caller is owner", async () => {
    const { sessionId, sessions, catalog, wiki, principal } =
      await memberContext();
    const result = await toolResult(
      await handleMcp(
        callTool(sessionId, "workspace_create", { name: "Palm Engine" }),
        env,
        sessions,
        catalog,
        wiki,
      ),
    );
    assert.notEqual(result.isError, true);
    const payload = JSON.parse(result.content[0]?.text ?? "{}") as {
      organization: { name: string };
      workspace: { id: string; name: string };
      project: { name: string; parent_id: string | null };
    };
    assert.equal(payload.organization.name, "Palm Engine");
    assert.equal(payload.workspace.name, "Palm Engine");
    assert.equal(payload.project.name, "Palm Engine");
    assert.equal(payload.project.parent_id, null);
    const listed = await toolResult(
      await handleMcp(
        callTool(sessionId, "members_list", {
          workspace_id: payload.workspace.id,
        }),
        env,
        sessions,
        catalog,
        wiki,
      ),
    );
    const members = JSON.parse(listed.content[0]?.text ?? "{}") as {
      members: { principal_id: string; role: string }[];
    };
    assert.equal(members.members.length, 1);
    assert.equal(members.members[0]?.principal_id, principal.id);
    assert.equal(members.members[0]?.role, "owner");
  });

  it("members_add unknown principal_id is isError 400", async () => {
    const { sessionId, sessions, catalog, wiki } = await memberContext();
    const result = await toolResult(
      await handleMcp(
        callTool(sessionId, "members_add", { principal_id: "Gruber" }),
        env,
        sessions,
        catalog,
        wiki,
      ),
    );
    assert.equal(result.isError, true);
    const payload = JSON.parse(result.content[0]?.text ?? "{}") as {
      status: number;
      error: string;
    };
    assert.equal(payload.status, 400);
    assert.equal(payload.error, "bad_request");
  });

  it("members_add existing principal then members_list includes them", async () => {
    const { sessionId, sessions, catalog, wiki, bundle } =
      await memberContext();
    const extra = await mintSession(sessions);
    const added = await toolResult(
      await handleMcp(
        callTool(sessionId, "members_add", {
          principal_id: extra.principal.id,
          role: "member",
        }),
        env,
        sessions,
        catalog,
        wiki,
      ),
    );
    assert.notEqual(added.isError, true);
    const payload = JSON.parse(added.content[0]?.text ?? "{}") as {
      member: { principal_id: string; role: string };
    };
    assert.equal(payload.member.principal_id, extra.principal.id);
    assert.equal(payload.member.role, "member");
    const listed = await toolResult(
      await handleMcp(
        callTool(sessionId, "members_list", {
          workspace_id: bundle.workspace.id,
        }),
        env,
        sessions,
        catalog,
        wiki,
      ),
    );
    const members = JSON.parse(listed.content[0]?.text ?? "{}") as {
      members: { principal_id: string }[];
    };
    assert.ok(
      members.members.some((row) => row.principal_id === extra.principal.id),
    );
  });

  it("members_set_role as member is isError 403", async () => {
    const { sessionId, sessions, catalog, wiki, principal } =
      await memberContext();
    const result = await toolResult(
      await handleMcp(
        callTool(sessionId, "members_set_role", {
          principal_id: principal.id,
          role: "owner",
        }),
        env,
        sessions,
        catalog,
        wiki,
      ),
    );
    assert.equal(result.isError, true);
    const payload = JSON.parse(result.content[0]?.text ?? "{}") as {
      status: number;
    };
    assert.equal(payload.status, 403);
  });

  it("owner members_set_role and members_remove; last owner is 400", async () => {
    const { sessionId, sessions, catalog, wiki, bundle, principal } =
      await memberContext();
    await catalog.updateMembershipRole(
      bundle.workspace.id,
      principal.id,
      "owner",
    );
    const extra = await mintSession(sessions);
    const added = await toolResult(
      await handleMcp(
        callTool(sessionId, "members_add", {
          principal_id: extra.principal.id,
          role: "member",
        }),
        env,
        sessions,
        catalog,
        wiki,
      ),
    );
    assert.notEqual(added.isError, true);
    const promoted = await toolResult(
      await handleMcp(
        callTool(sessionId, "members_set_role", {
          principal_id: extra.principal.id,
          role: "owner",
        }),
        env,
        sessions,
        catalog,
        wiki,
      ),
    );
    assert.notEqual(promoted.isError, true);
    const removed = await toolResult(
      await handleMcp(
        callTool(sessionId, "members_remove", {
          principal_id: extra.principal.id,
        }),
        env,
        sessions,
        catalog,
        wiki,
      ),
    );
    assert.notEqual(removed.isError, true);
    const last = await toolResult(
      await handleMcp(
        callTool(sessionId, "members_remove", {
          principal_id: principal.id,
        }),
        env,
        sessions,
        catalog,
        wiki,
      ),
    );
    assert.equal(last.isError, true);
    const payload = JSON.parse(last.content[0]?.text ?? "{}") as {
      status: number;
      error: string;
    };
    assert.equal(payload.status, 400);
    assert.equal(payload.error, "last_owner");
  });

  it("project_create, project_rename, project_reparent", async () => {
    const { sessionId, sessions, catalog, wiki, bundle } =
      await memberContext();
    const created = await toolResult(
      await handleMcp(
        callTool(sessionId, "project_create", {
          name: "Keep",
          parent_id: bundle.project.id,
        }),
        env,
        sessions,
        catalog,
        wiki,
      ),
    );
    assert.notEqual(created.isError, true);
    const createdPayload = JSON.parse(created.content[0]?.text ?? "{}") as {
      project: { id: string; name: string; parent_id: string | null };
    };
    assert.equal(createdPayload.project.name, "Keep");
    assert.equal(createdPayload.project.parent_id, bundle.project.id);
    const renamed = await toolResult(
      await handleMcp(
        callTool(sessionId, "project_rename", {
          project_id: createdPayload.project.id,
          name: "Palm",
        }),
        env,
        sessions,
        catalog,
        wiki,
      ),
    );
    const renamedPayload = JSON.parse(renamed.content[0]?.text ?? "{}") as {
      project: { name: string };
    };
    assert.equal(renamedPayload.project.name, "Palm");
    const cycle = await toolResult(
      await handleMcp(
        callTool(sessionId, "project_reparent", {
          project_id: bundle.project.id,
          parent_id: createdPayload.project.id,
        }),
        env,
        sessions,
        catalog,
        wiki,
      ),
    );
    assert.equal(cycle.isError, true);
    const cyclePayload = JSON.parse(cycle.content[0]?.text ?? "{}") as {
      status: number;
    };
    assert.equal(cyclePayload.status, 400);
    const reparented = await toolResult(
      await handleMcp(
        callTool(sessionId, "project_reparent", {
          project_id: createdPayload.project.id,
          parent_id: null,
        }),
        env,
        sessions,
        catalog,
        wiki,
      ),
    );
    const reparentedPayload = JSON.parse(
      reparented.content[0]?.text ?? "{}",
    ) as { project: { parent_id: string | null } };
    assert.equal(reparentedPayload.project.parent_id, null);
  });

  it("stages_replace relabels; extra key is 400", async () => {
    const { sessionId, sessions, catalog, wiki } = await memberContext();
    const ok = await toolResult(
      await handleMcp(
        callTool(sessionId, "stages_replace", {
          stages: [
            { key: "backlog", label: "Inbox", position: 0 },
            { key: "doing", label: "Doing", position: 1 },
            { key: "done", label: "Done", position: 2 },
          ],
        }),
        env,
        sessions,
        catalog,
        wiki,
      ),
    );
    assert.notEqual(ok.isError, true);
    const payload = JSON.parse(ok.content[0]?.text ?? "{}") as {
      stages: { key: string; label: string }[];
    };
    const backlog = payload.stages.find((row) => row.key === "backlog");
    assert.equal(backlog?.label, "Inbox");
    const bad = await toolResult(
      await handleMcp(
        callTool(sessionId, "stages_replace", {
          stages: [
            { key: "backlog", label: "Inbox", position: 0 },
            { key: "doing", label: "Doing", position: 1 },
            { key: "done", label: "Done", position: 2 },
            { key: "blocked", label: "Blocked", position: 3 },
          ],
        }),
        env,
        sessions,
        catalog,
        wiki,
      ),
    );
    assert.equal(bad.isError, true);
    const err = JSON.parse(bad.content[0]?.text ?? "{}") as {
      status: number;
    };
    assert.equal(err.status, 400);
  });

  it("notify_add returns secret once; list omits it; set and remove", async () => {
    const { sessionId, sessions, catalog, wiki, bundle, principal } =
      await memberContext();
    await catalog.updateMembershipRole(
      bundle.workspace.id,
      principal.id,
      "owner",
    );
    const notify = memoryNotifyStore();
    const envWithQueue = {
      ...env,
      NOTIFY: { async send() {} },
    };
    const added = await toolResult(
      await handleMcp(
        callTool(sessionId, "notify_add", {
          url: "https://bot.example/hook",
          kinds: ["node.created"],
        }),
        envWithQueue,
        sessions,
        catalog,
        wiki,
        undefined,
        notify,
      ),
    );
    assert.notEqual(added.isError, true);
    const addedPayload = JSON.parse(added.content[0]?.text ?? "{}") as {
      secret: string;
      subscription: { id: string; url: string; secret?: string };
    };
    assert.match(addedPayload.secret, /^whsec_/);
    assert.equal(addedPayload.subscription.url, "https://bot.example/hook");
    assert.equal("secret" in addedPayload.subscription, false);

    const listed = await toolResult(
      await handleMcp(
        callTool(sessionId, "notify_list", {}),
        envWithQueue,
        sessions,
        catalog,
        wiki,
        undefined,
        notify,
      ),
    );
    assert.notEqual(listed.isError, true);
    const listPayload = JSON.parse(listed.content[0]?.text ?? "{}") as {
      subscriptions: { id: string; enabled: boolean; secret?: string }[];
    };
    assert.equal(listPayload.subscriptions.length, 1);
    assert.equal("secret" in listPayload.subscriptions[0]!, false);

    const set = await toolResult(
      await handleMcp(
        callTool(sessionId, "notify_set", {
          subscription_id: addedPayload.subscription.id,
          enabled: false,
        }),
        envWithQueue,
        sessions,
        catalog,
        wiki,
        undefined,
        notify,
      ),
    );
    assert.notEqual(set.isError, true);
    const afterSet = await toolResult(
      await handleMcp(
        callTool(sessionId, "notify_list", {}),
        envWithQueue,
        sessions,
        catalog,
        wiki,
        undefined,
        notify,
      ),
    );
    const afterSetPayload = JSON.parse(afterSet.content[0]?.text ?? "{}") as {
      subscriptions: { enabled: boolean }[];
    };
    assert.equal(afterSetPayload.subscriptions[0]?.enabled, false);

    const removed = await toolResult(
      await handleMcp(
        callTool(sessionId, "notify_remove", {
          subscription_id: addedPayload.subscription.id,
        }),
        envWithQueue,
        sessions,
        catalog,
        wiki,
        undefined,
        notify,
      ),
    );
    assert.notEqual(removed.isError, true);
    const afterRemove = await toolResult(
      await handleMcp(
        callTool(sessionId, "notify_list", {}),
        envWithQueue,
        sessions,
        catalog,
        wiki,
        undefined,
        notify,
      ),
    );
    const afterRemovePayload = JSON.parse(
      afterRemove.content[0]?.text ?? "{}",
    ) as { subscriptions: unknown[] };
    assert.equal(afterRemovePayload.subscriptions.length, 0);
  });
});
