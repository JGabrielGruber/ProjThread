import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { handleAdmin } from "./admin.ts";
import {
  type CatalogStore,
  type ProjectRow,
  type TenantBundle,
  type WorkItemRow,
} from "./catalog.ts";
import type { Env } from "./env.ts";
import {
  type Principal,
  type SessionRow,
  type SessionStore,
} from "./session.ts";
import { COOKIE_NAME } from "../lib/cookies.ts";
import { handleWiki } from "./wiki-http.ts";
import {
  memoryNotifyStore,
  type NotifyMessage,
  type NotifyStore,
} from "./notify.ts";
import { memoryWikiStore, type WikiStore } from "./wiki.ts";

const ORIGIN = "http://127.0.0.1:8787";
const env = { APP_ORIGIN: ORIGIN } as Env;

type MemoryCatalog = CatalogStore & {
  seedWorkItem(row: WorkItemRow): void;
  seedProject(row: ProjectRow & { created_at: string }): void;
};

function unused(): never {
  throw new Error("unused");
}

function stubCatalog(): CatalogStore {
  return {
    listMemberships: unused,
    getMembership: unused,
    listMembers: unused,
    insertMembership: unused,
    updateMembershipRole: unused,
    deleteMembership: unused,
    countOwners: unused,
    listProjects: unused,
    getProject: unused,
    insertProject: unused,
    updateProjectName: unused,
    updateProjectParent: unused,
    listStages: unused,
    replaceStages: unused,
    listWorkItems: unused,
    getWorkItem: unused,
    insertWorkItem: unused,
    updateWorkItemTitle: unused,
    insertTenantBundle: unused,
    insertWorkspaceFor: unused,
    listOrganizations: unused,
    listWorkItemEvents: unused,
    commitWorkItemEvent: unused,
  };
}

function memoryCatalog(): MemoryCatalog {
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
  const workItems = new Map<string, WorkItemRow>();
  const projects = new Map<string, ProjectRow & { created_at: string }>();

  function membershipKey(workspaceId: string, principalId: string): string {
    return `${workspaceId}:${principalId}`;
  }

  return {
    listMemberships: unused,
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
    updateMembershipRole: unused,
    deleteMembership: unused,
    countOwners: unused,
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
    updateProjectName: unused,
    updateProjectParent: unused,
    listStages: unused,
    replaceStages: unused,
    listWorkItems: unused,
    async getWorkItem(id) {
      const row = workItems.get(id);
      return row ? { ...row } : null;
    },
    insertWorkItem: unused,
    updateWorkItemTitle: unused,
    async insertTenantBundle(b) {
      organizations.set(b.organization.id, { ...b.organization });
      workspaces.set(b.workspace.id, { ...b.workspace });
      projects.set(b.project.id, { ...b.project });
      memberships.set(
        membershipKey(b.membership.workspace_id, b.membership.principal_id),
        { ...b.membership },
      );
    },
    insertWorkspaceFor: unused,
    listOrganizations: unused,
    listWorkItemEvents: unused,
    commitWorkItemEvent: unused,
    seedWorkItem(row) {
      workItems.set(row.id, { ...row });
    },
    seedProject(row) {
      projects.set(row.id, { ...row });
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

async function mintCookie(
  store: SessionStore,
): Promise<{ principal: Principal; cookie: string }> {
  const catalog = stubCatalog();
  const created = await handleAdmin(
    new Request(`${ORIGIN}/api/admin/principals`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "human", display_name: "José" }),
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
      body: JSON.stringify({ principal_id: principal.id }),
    }),
    env,
    store,
    catalog,
  );
  const setCookie = minted.headers.get("set-cookie");
  assert.ok(setCookie);
  const cookie = setCookie.split(";")[0]!;
  return { principal, cookie };
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
      type: "human",
      display_name: "Farm",
      created_at: now,
    },
    membership: {
      workspace_id: "ws-farm",
      principal_id: principalId,
      role: "owner",
    },
  };
}

function farmWorkItem(bundle: TenantBundle, id: string): WorkItemRow {
  return {
    id,
    project_id: bundle.project.id,
    workspace_id: bundle.workspace.id,
    organization_id: bundle.organization.id,
    title: "Card",
    stage_key: "backlog",
    owner_id: null,
    created_at: "2026-01-02T00:00:00.000Z",
    updated_at: "2026-01-02T00:00:00.000Z",
  };
}

async function memberContext(): Promise<{
  cookie: string;
  catalog: MemoryCatalog;
  wiki: WikiStore;
  bundle: TenantBundle;
  sessions: SessionStore;
}> {
  const sessions = memoryStore();
  const { principal, cookie } = await mintCookie(sessions);
  const catalog = memoryCatalog();
  const wiki = memoryWikiStore();
  const bundle = farmBundle(principal.id);
  await catalog.insertTenantBundle(bundle);
  return { cookie, catalog, wiki, bundle, sessions };
}

describe("handleWiki", () => {
  it("GET workspace nodes without cookie is 401", async () => {
    const res = await handleWiki(
      new Request(`${ORIGIN}/api/workspaces/ws-farm/nodes`),
      env,
      memoryStore(),
      memoryCatalog(),
      memoryWikiStore(),
    );
    assert.equal(res.status, 401);
  });

  it("outsider cookie is 403", async () => {
    const sessions = memoryStore();
    const { cookie } = await mintCookie(sessions);
    const res = await handleWiki(
      new Request(`${ORIGIN}/api/workspaces/ws-farm/nodes`, {
        headers: { cookie },
      }),
      env,
      sessions,
      memoryCatalog(),
      memoryWikiStore(),
    );
    assert.equal(res.status, 403);
  });

  it("GET /api/nodes/missing is 404", async () => {
    const { cookie, catalog, wiki, sessions } = await memberContext();
    const res = await handleWiki(
      new Request(`${ORIGIN}/api/nodes/missing`, { headers: { cookie } }),
      env,
      sessions,
      catalog,
      wiki,
    );
    assert.equal(res.status, 404);
  });

  it("GET list member is 200 empty nodes", async () => {
    const { cookie, catalog, wiki, bundle, sessions } = await memberContext();
    const res = await handleWiki(
      new Request(`${ORIGIN}/api/workspaces/${bundle.workspace.id}/nodes`, {
        headers: { cookie },
      }),
      env,
      sessions,
      catalog,
      wiki,
    );
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { nodes: [] });
  });

  it("GET list member accepts a live Bearer session", async () => {
    const { cookie, catalog, wiki, bundle, sessions } = await memberContext();
    const sessionId = cookie.slice(`${COOKIE_NAME}=`.length);
    const res = await handleWiki(
      new Request(`${ORIGIN}/api/workspaces/${bundle.workspace.id}/nodes`, {
        headers: { authorization: `Bearer ${sessionId}` },
      }),
      env,
      sessions,
      catalog,
      wiki,
    );
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { nodes: [] });
  });

  it("POST strips b tags, list omits content", async () => {
    const { cookie, catalog, wiki, bundle, sessions } = await memberContext();
    const created = await handleWiki(
      new Request(`${ORIGIN}/api/workspaces/${bundle.workspace.id}/nodes`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ title: "Egg", content: "<b>x</b>" }),
      }),
      env,
      sessions,
      catalog,
      wiki,
    );
    assert.equal(created.status, 201);
    const body = (await created.json()) as {
      node: { title: string; content: string; payload_kind: string };
    };
    assert.equal(body.node.title, "Egg");
    assert.equal(body.node.content, "x");
    assert.equal(body.node.payload_kind, "markdown");

    const listed = await handleWiki(
      new Request(`${ORIGIN}/api/workspaces/${bundle.workspace.id}/nodes`, {
        headers: { cookie },
      }),
      env,
      sessions,
      catalog,
      wiki,
    );
    assert.equal(listed.status, 200);
    const listBody = (await listed.json()) as { nodes: Record<string, unknown>[] };
    assert.equal(listBody.nodes.length, 1);
    assert.equal("content" in (listBody.nodes[0] ?? {}), false);
  });

  it("GET node has content and empty work_item_ids", async () => {
    const { cookie, catalog, wiki, bundle, sessions } = await memberContext();
    const created = await handleWiki(
      new Request(`${ORIGIN}/api/workspaces/${bundle.workspace.id}/nodes`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ title: "Egg", content: "# Hi" }),
      }),
      env,
      sessions,
      catalog,
      wiki,
    );
    const { node } = (await created.json()) as { node: { id: string; content: string } };
    const res = await handleWiki(
      new Request(`${ORIGIN}/api/nodes/${node.id}`, { headers: { cookie } }),
      env,
      sessions,
      catalog,
      wiki,
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      node: { content: string };
      work_item_ids: string[];
      project_ids: string[];
      includes: unknown[];
      refs: unknown[];
    };
    assert.equal(body.node.content, "# Hi");
    assert.deepEqual(body.work_item_ids, []);
    assert.deepEqual(body.project_ids, []);
    assert.deepEqual(body.includes, []);
    assert.deepEqual(body.refs, []);
  });

  it("POST empty title is 400", async () => {
    const { cookie, catalog, wiki, bundle, sessions } = await memberContext();
    const res = await handleWiki(
      new Request(`${ORIGIN}/api/workspaces/${bundle.workspace.id}/nodes`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ title: "  " }),
      }),
      env,
      sessions,
      catalog,
      wiki,
    );
    assert.equal(res.status, 400);
  });

  it("POST payload_kind blob is 400", async () => {
    const { cookie, catalog, wiki, bundle, sessions } = await memberContext();
    const res = await handleWiki(
      new Request(`${ORIGIN}/api/workspaces/${bundle.workspace.id}/nodes`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ title: "Egg", payload_kind: "blob" }),
      }),
      env,
      sessions,
      catalog,
      wiki,
    );
    assert.equal(res.status, 400);
  });

  it("POST payload_kind json stores canonical object", async () => {
    const { cookie, catalog, wiki, bundle, sessions } = await memberContext();
    const created = await handleWiki(
      new Request(`${ORIGIN}/api/workspaces/${bundle.workspace.id}/nodes`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          title: "Meta",
          payload_kind: "json",
          content: '{"url":"https://example.com"}',
        }),
      }),
      env,
      sessions,
      catalog,
      wiki,
    );
    assert.equal(created.status, 201);
    const body = (await created.json()) as {
      node: { payload_kind: string; content: string };
    };
    assert.equal(body.node.payload_kind, "json");
    assert.equal(body.node.content, '{"url":"https://example.com"}');
  });

  it("POST json invalid content is 400 and does not list", async () => {
    const { cookie, catalog, wiki, bundle, sessions } = await memberContext();
    const res = await handleWiki(
      new Request(`${ORIGIN}/api/workspaces/${bundle.workspace.id}/nodes`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          title: "Meta",
          payload_kind: "json",
          content: "{",
        }),
      }),
      env,
      sessions,
      catalog,
      wiki,
    );
    assert.equal(res.status, 400);
    const listed = await handleWiki(
      new Request(`${ORIGIN}/api/workspaces/${bundle.workspace.id}/nodes`, {
        headers: { cookie },
      }),
      env,
      sessions,
      catalog,
      wiki,
    );
    const listBody = (await listed.json()) as { nodes: unknown[] };
    assert.equal(listBody.nodes.length, 0);
  });

  it("POST json null content is 400", async () => {
    const { cookie, catalog, wiki, bundle, sessions } = await memberContext();
    const res = await handleWiki(
      new Request(`${ORIGIN}/api/workspaces/${bundle.workspace.id}/nodes`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          title: "Meta",
          payload_kind: "json",
          content: "null",
        }),
      }),
      env,
      sessions,
      catalog,
      wiki,
    );
    assert.equal(res.status, 400);
  });

  it("PATCH json node content canonicalizes", async () => {
    const { cookie, catalog, wiki, bundle, sessions } = await memberContext();
    const created = await handleWiki(
      new Request(`${ORIGIN}/api/workspaces/${bundle.workspace.id}/nodes`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          title: "Meta",
          payload_kind: "json",
          content: '{"url":"https://example.com"}',
        }),
      }),
      env,
      sessions,
      catalog,
      wiki,
    );
    const { node } = (await created.json()) as { node: { id: string } };
    const res = await handleWiki(
      new Request(`${ORIGIN}/api/nodes/${node.id}`, {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ content: '{ "k" : 1 }' }),
      }),
      env,
      sessions,
      catalog,
      wiki,
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as { node: { content: string } };
    assert.equal(body.node.content, '{"k":1}');
  });

  it("PATCH json node primitive content is 400", async () => {
    const { cookie, catalog, wiki, bundle, sessions } = await memberContext();
    const created = await handleWiki(
      new Request(`${ORIGIN}/api/workspaces/${bundle.workspace.id}/nodes`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          title: "Meta",
          payload_kind: "json",
          content: '{"k":1}',
        }),
      }),
      env,
      sessions,
      catalog,
      wiki,
    );
    const { node } = (await created.json()) as { node: { id: string } };
    const res = await handleWiki(
      new Request(`${ORIGIN}/api/nodes/${node.id}`, {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ content: "1" }),
      }),
      env,
      sessions,
      catalog,
      wiki,
    );
    assert.equal(res.status, 400);
  });

  it("PATCH payload_kind on markdown node is 400", async () => {
    const { cookie, catalog, wiki, bundle, sessions } = await memberContext();
    const created = await handleWiki(
      new Request(`${ORIGIN}/api/workspaces/${bundle.workspace.id}/nodes`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ title: "Egg" }),
      }),
      env,
      sessions,
      catalog,
      wiki,
    );
    const { node } = (await created.json()) as {
      node: { id: string; payload_kind: string };
    };
    const res = await handleWiki(
      new Request(`${ORIGIN}/api/nodes/${node.id}`, {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ payload_kind: "json" }),
      }),
      env,
      sessions,
      catalog,
      wiki,
    );
    assert.equal(res.status, 400);
    const got = await handleWiki(
      new Request(`${ORIGIN}/api/nodes/${node.id}`, { headers: { cookie } }),
      env,
      sessions,
      catalog,
      wiki,
    );
    const body = (await got.json()) as { node: { payload_kind: string } };
    assert.equal(body.node.payload_kind, "markdown");
  });

  it("POST type nope is 400", async () => {
    const { cookie, catalog, wiki, bundle, sessions } = await memberContext();
    const res = await handleWiki(
      new Request(`${ORIGIN}/api/workspaces/${bundle.workspace.id}/nodes`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ title: "Egg", type: "nope" }),
      }),
      env,
      sessions,
      catalog,
      wiki,
    );
    assert.equal(res.status, 400);
  });

  it("PATCH title and content is 200", async () => {
    const { cookie, catalog, wiki, bundle, sessions } = await memberContext();
    const created = await handleWiki(
      new Request(`${ORIGIN}/api/workspaces/${bundle.workspace.id}/nodes`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ title: "Egg", content: "# Hi" }),
      }),
      env,
      sessions,
      catalog,
      wiki,
    );
    const { node } = (await created.json()) as { node: { id: string } };
    const res = await handleWiki(
      new Request(`${ORIGIN}/api/nodes/${node.id}`, {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ title: "Hen", content: "# Ho" }),
      }),
      env,
      sessions,
      catalog,
      wiki,
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      node: { title: string; content: string };
    };
    assert.equal(body.node.title, "Hen");
    assert.equal(body.node.content, "# Ho");
  });

  it("PATCH pinned true is 200; outsider 403; pin-only body is enough", async () => {
    const { cookie, catalog, wiki, bundle, sessions } = await memberContext();
    const created = await handleWiki(
      new Request(`${ORIGIN}/api/workspaces/${bundle.workspace.id}/nodes`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ title: "Egg", content: "# Hi" }),
      }),
      env,
      sessions,
      catalog,
      wiki,
    );
    const { node } = (await created.json()) as { node: { id: string } };

    const outsiderSessions = memoryStore();
    const outsider = await mintCookie(outsiderSessions);
    const forbidden = await handleWiki(
      new Request(`${ORIGIN}/api/nodes/${node.id}`, {
        method: "PATCH",
        headers: {
          cookie: outsider.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({ pinned: true }),
      }),
      env,
      outsiderSessions,
      catalog,
      wiki,
    );
    assert.equal(forbidden.status, 403);

    const res = await handleWiki(
      new Request(`${ORIGIN}/api/nodes/${node.id}`, {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ pinned: true }),
      }),
      env,
      sessions,
      catalog,
      wiki,
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as { node: { pinned: number } };
    assert.equal(body.node.pinned, 1);
  });

  it("POST with same-workspace work_item_id links it", async () => {
    const { cookie, catalog, wiki, bundle, sessions } = await memberContext();
    catalog.seedWorkItem(farmWorkItem(bundle, "wi-1"));
    const res = await handleWiki(
      new Request(`${ORIGIN}/api/workspaces/${bundle.workspace.id}/nodes`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          title: "Egg",
          work_item_id: "wi-1",
        }),
      }),
      env,
      sessions,
      catalog,
      wiki,
    );
    assert.equal(res.status, 201);
    const body = (await res.json()) as { work_item_ids: string[] };
    assert.equal(body.work_item_ids.length, 1);
    assert.equal(body.work_item_ids[0], "wi-1");
  });

  it("missing or other-workspace work_item_id is 400 with no extra node", async () => {
    const { cookie, catalog, wiki, bundle, sessions } = await memberContext();
    catalog.seedWorkItem({
      ...farmWorkItem(bundle, "wi-other"),
      workspace_id: "ws-other",
    });

    const missing = await handleWiki(
      new Request(`${ORIGIN}/api/workspaces/${bundle.workspace.id}/nodes`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ title: "Egg", work_item_id: "missing" }),
      }),
      env,
      sessions,
      catalog,
      wiki,
    );
    assert.equal(missing.status, 400);

    const other = await handleWiki(
      new Request(`${ORIGIN}/api/workspaces/${bundle.workspace.id}/nodes`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ title: "Egg", work_item_id: "wi-other" }),
      }),
      env,
      sessions,
      catalog,
      wiki,
    );
    assert.equal(other.status, 400);

    const listed = await handleWiki(
      new Request(`${ORIGIN}/api/workspaces/${bundle.workspace.id}/nodes`, {
        headers: { cookie },
      }),
      env,
      sessions,
      catalog,
      wiki,
    );
    const listBody = (await listed.json()) as { nodes: unknown[] };
    assert.equal(listBody.nodes.length, 0);
  });

  it("POST work-items is 201 then 200 with one id", async () => {
    const { cookie, catalog, wiki, bundle, sessions } = await memberContext();
    catalog.seedWorkItem(farmWorkItem(bundle, "wi-1"));
    const created = await handleWiki(
      new Request(`${ORIGIN}/api/workspaces/${bundle.workspace.id}/nodes`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ title: "Egg" }),
      }),
      env,
      sessions,
      catalog,
      wiki,
    );
    const { node } = (await created.json()) as { node: { id: string } };

    const first = await handleWiki(
      new Request(`${ORIGIN}/api/nodes/${node.id}/work-items`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ work_item_id: "wi-1" }),
      }),
      env,
      sessions,
      catalog,
      wiki,
    );
    assert.equal(first.status, 201);

    const second = await handleWiki(
      new Request(`${ORIGIN}/api/nodes/${node.id}/work-items`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ work_item_id: "wi-1" }),
      }),
      env,
      sessions,
      catalog,
      wiki,
    );
    assert.equal(second.status, 200);
    const body = (await second.json()) as { work_item_ids: string[] };
    assert.deepEqual(body.work_item_ids, ["wi-1"]);
  });

  it("POST projects is 201 then 200 with one id", async () => {
    const { cookie, catalog, wiki, bundle, sessions } = await memberContext();
    const created = await handleWiki(
      new Request(`${ORIGIN}/api/workspaces/${bundle.workspace.id}/nodes`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ title: "Report" }),
      }),
      env,
      sessions,
      catalog,
      wiki,
    );
    const { node } = (await created.json()) as { node: { id: string } };

    const first = await handleWiki(
      new Request(`${ORIGIN}/api/nodes/${node.id}/projects`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ project_id: bundle.project.id }),
      }),
      env,
      sessions,
      catalog,
      wiki,
    );
    assert.equal(first.status, 201);

    const second = await handleWiki(
      new Request(`${ORIGIN}/api/nodes/${node.id}/projects`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ project_id: bundle.project.id }),
      }),
      env,
      sessions,
      catalog,
      wiki,
    );
    assert.equal(second.status, 200);
    const body = (await second.json()) as {
      project_ids: string[];
      work_item_ids: string[];
    };
    assert.deepEqual(body.project_ids, [bundle.project.id]);
    assert.deepEqual(body.work_item_ids, []);
  });

  it("POST projects foreign workspace is 400", async () => {
    const { cookie, catalog, wiki, bundle, sessions } = await memberContext();
    catalog.seedProject({
      id: "proj-other",
      workspace_id: "ws-other",
      organization_id: bundle.organization.id,
      parent_id: null,
      name: "Other",
      created_at: "2026-01-01T00:00:00.000Z",
    });
    const created = await handleWiki(
      new Request(`${ORIGIN}/api/workspaces/${bundle.workspace.id}/nodes`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ title: "Report" }),
      }),
      env,
      sessions,
      catalog,
      wiki,
    );
    const { node } = (await created.json()) as { node: { id: string } };
    const res = await handleWiki(
      new Request(`${ORIGIN}/api/nodes/${node.id}/projects`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ project_id: "proj-other" }),
      }),
      env,
      sessions,
      catalog,
      wiki,
    );
    assert.equal(res.status, 400);
  });

  it("GET nodes ?project_id= matches node_project without a card", async () => {
    const { cookie, catalog, wiki, bundle, sessions } = await memberContext();
    const created = await handleWiki(
      new Request(`${ORIGIN}/api/workspaces/${bundle.workspace.id}/nodes`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ title: "Pointed" }),
      }),
      env,
      sessions,
      catalog,
      wiki,
    );
    const { node } = (await created.json()) as { node: { id: string } };
    const linked = await handleWiki(
      new Request(`${ORIGIN}/api/nodes/${node.id}/projects`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ project_id: bundle.project.id }),
      }),
      env,
      sessions,
      catalog,
      wiki,
    );
    assert.equal(linked.status, 201);

    const filtered = await handleWiki(
      new Request(
        `${ORIGIN}/api/workspaces/${bundle.workspace.id}/nodes?project_id=${bundle.project.id}`,
        { headers: { cookie } },
      ),
      env,
      sessions,
      catalog,
      wiki,
    );
    const body = (await filtered.json()) as { nodes: { title: string }[] };
    assert.ok(body.nodes.some((n) => n.title === "Pointed"));
    assert.equal("project_ids" in (body.nodes[0] ?? {}), false);
  });

  it("GET fresh node has empty includes and refs", async () => {
    const { cookie, catalog, wiki, bundle, sessions } = await memberContext();
    const created = await handleWiki(
      new Request(`${ORIGIN}/api/workspaces/${bundle.workspace.id}/nodes`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ title: "Plan" }),
      }),
      env,
      sessions,
      catalog,
      wiki,
    );
    const { node, includes, refs, work_item_ids } = (await created.json()) as {
      node: { id: string };
      includes: unknown[];
      refs: unknown[];
      work_item_ids: string[];
    };
    assert.deepEqual(includes, []);
    assert.deepEqual(refs, []);
    assert.deepEqual(work_item_ids, []);

    const res = await handleWiki(
      new Request(`${ORIGIN}/api/nodes/${node.id}`, { headers: { cookie } }),
      env,
      sessions,
      catalog,
      wiki,
    );
    const got = (await res.json()) as {
      includes: unknown[];
      refs: unknown[];
      work_item_ids: string[];
    };
    assert.deepEqual(got.includes, []);
    assert.deepEqual(got.refs, []);
    assert.deepEqual(got.work_item_ids, []);
  });

  it("POST includes then GET splits content off the outline", async () => {
    const { cookie, catalog, wiki, bundle, sessions } = await memberContext();
    const parent = await postNode(
      cookie,
      catalog,
      wiki,
      bundle,
      sessions,
      { title: "Plan" },
    );
    const child = await postNode(
      cookie,
      catalog,
      wiki,
      bundle,
      sessions,
      { title: "Requirements", content: "# Body" },
    );

    const included = await handleWiki(
      new Request(`${ORIGIN}/api/nodes/${parent.id}/includes`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ child_id: child.id }),
      }),
      env,
      sessions,
      catalog,
      wiki,
    );
    assert.equal(included.status, 201);
    const includedBody = (await included.json()) as {
      includes: Record<string, unknown>[];
    };
    assert.equal(includedBody.includes[0]?.title, "Requirements");
    assert.equal("content" in (includedBody.includes[0] ?? {}), false);

    const childGet = await handleWiki(
      new Request(`${ORIGIN}/api/nodes/${child.id}`, { headers: { cookie } }),
      env,
      sessions,
      catalog,
      wiki,
    );
    const childBody = (await childGet.json()) as { includes: unknown[] };
    assert.deepEqual(childBody.includes, []);

    const again = await handleWiki(
      new Request(`${ORIGIN}/api/nodes/${parent.id}/includes`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ child_id: child.id }),
      }),
      env,
      sessions,
      catalog,
      wiki,
    );
    assert.equal(again.status, 200);
    const againBody = (await again.json()) as { includes: unknown[] };
    assert.equal(againBody.includes.length, 1);
  });

  it("POST refs cites without becoming an include; reverse ref is 201", async () => {
    const { cookie, catalog, wiki, bundle, sessions } = await memberContext();
    const plan = await postNode(
      cookie,
      catalog,
      wiki,
      bundle,
      sessions,
      { title: "Plan" },
    );
    const other = await postNode(
      cookie,
      catalog,
      wiki,
      bundle,
      sessions,
      { title: "Other plan" },
    );
    const req = await postNode(
      cookie,
      catalog,
      wiki,
      bundle,
      sessions,
      { title: "Requirements" },
    );
    await handleWiki(
      new Request(`${ORIGIN}/api/nodes/${plan.id}/includes`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ child_id: req.id }),
      }),
      env,
      sessions,
      catalog,
      wiki,
    );

    const cited = await handleWiki(
      new Request(`${ORIGIN}/api/nodes/${plan.id}/refs`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ to_id: other.id }),
      }),
      env,
      sessions,
      catalog,
      wiki,
    );
    assert.equal(cited.status, 201);
    const citedBody = (await cited.json()) as {
      refs: { id: string }[];
      includes: { id: string }[];
    };
    assert.equal(citedBody.refs[0]?.id, other.id);
    assert.equal(citedBody.includes.length, 1);
    assert.equal(citedBody.includes[0]?.id, req.id);

    const reverse = await handleWiki(
      new Request(`${ORIGIN}/api/nodes/${other.id}/refs`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ to_id: plan.id }),
      }),
      env,
      sessions,
      catalog,
      wiki,
    );
    assert.equal(reverse.status, 201);
  });

  it("POST includes that would cycle is 400", async () => {
    const { cookie, catalog, wiki, bundle, sessions } = await memberContext();
    const parent = await postNode(
      cookie,
      catalog,
      wiki,
      bundle,
      sessions,
      { title: "Plan" },
    );
    const child = await postNode(
      cookie,
      catalog,
      wiki,
      bundle,
      sessions,
      { title: "Part" },
    );
    await handleWiki(
      new Request(`${ORIGIN}/api/nodes/${parent.id}/includes`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ child_id: child.id }),
      }),
      env,
      sessions,
      catalog,
      wiki,
    );

    const cycle = await handleWiki(
      new Request(`${ORIGIN}/api/nodes/${child.id}/includes`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ child_id: parent.id }),
      }),
      env,
      sessions,
      catalog,
      wiki,
    );
    assert.equal(cycle.status, 400);

    const got = await handleWiki(
      new Request(`${ORIGIN}/api/nodes/${parent.id}`, { headers: { cookie } }),
      env,
      sessions,
      catalog,
      wiki,
    );
    const body = (await got.json()) as { includes: unknown[] };
    assert.equal(body.includes.length, 1);
  });

  it("POST includes other-workspace child is 400", async () => {
    const { cookie, catalog, wiki, bundle, sessions } = await memberContext();
    const parent = await postNode(
      cookie,
      catalog,
      wiki,
      bundle,
      sessions,
      { title: "Plan" },
    );
    await wiki.insertNode({
      id: "n-other",
      workspace_id: "ws-other",
      organization_id: bundle.organization.id,
      type: "note",
      payload_kind: "markdown",
      title: "Other ws",
      summary: null,
      content: null,
      blob_key: null,
      mime_type: null,
      byte_size: null,
      filename: null,
      created_at: "2026-01-02T00:00:00.000Z",
      updated_at: "2026-01-02T00:00:00.000Z",
      pinned: 0,
    });

    const res = await handleWiki(
      new Request(`${ORIGIN}/api/nodes/${parent.id}/includes`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ child_id: "n-other" }),
      }),
      env,
      sessions,
      catalog,
      wiki,
    );
    assert.equal(res.status, 400);
  });

  it("POST refs with position is 400", async () => {
    const { cookie, catalog, wiki, bundle, sessions } = await memberContext();
    const plan = await postNode(
      cookie,
      catalog,
      wiki,
      bundle,
      sessions,
      { title: "Plan" },
    );
    const other = await postNode(
      cookie,
      catalog,
      wiki,
      bundle,
      sessions,
      { title: "Other" },
    );
    const res = await handleWiki(
      new Request(`${ORIGIN}/api/nodes/${plan.id}/refs`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ to_id: other.id, position: 0 }),
      }),
      env,
      sessions,
      catalog,
      wiki,
    );
    assert.equal(res.status, 400);
  });

  it("POST includes then work-items neither clobbers", async () => {
    const { cookie, catalog, wiki, bundle, sessions } = await memberContext();
    catalog.seedWorkItem(farmWorkItem(bundle, "wi-1"));
    const plan = await postNode(
      cookie,
      catalog,
      wiki,
      bundle,
      sessions,
      { title: "Plan" },
    );
    const child = await postNode(
      cookie,
      catalog,
      wiki,
      bundle,
      sessions,
      { title: "Part" },
    );
    await handleWiki(
      new Request(`${ORIGIN}/api/nodes/${plan.id}/includes`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ child_id: child.id }),
      }),
      env,
      sessions,
      catalog,
      wiki,
    );
    const linked = await handleWiki(
      new Request(`${ORIGIN}/api/nodes/${plan.id}/work-items`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ work_item_id: "wi-1" }),
      }),
      env,
      sessions,
      catalog,
      wiki,
    );
    assert.equal(linked.status, 201);
    const body = (await linked.json()) as {
      includes: { id: string }[];
      work_item_ids: string[];
    };
    assert.deepEqual(body.work_item_ids, ["wi-1"]);
    assert.equal(body.includes[0]?.id, child.id);
  });

  it("POST includes outsider 403, missing 404, no cookie 401", async () => {
    const { cookie, catalog, wiki, bundle, sessions } = await memberContext();
    const plan = await postNode(
      cookie,
      catalog,
      wiki,
      bundle,
      sessions,
      { title: "Plan" },
    );
    const child = await postNode(
      cookie,
      catalog,
      wiki,
      bundle,
      sessions,
      { title: "Part" },
    );

    const unauth = await handleWiki(
      new Request(`${ORIGIN}/api/nodes/${plan.id}/includes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ child_id: child.id }),
      }),
      env,
      memoryStore(),
      catalog,
      wiki,
    );
    assert.equal(unauth.status, 401);

    const missing = await handleWiki(
      new Request(`${ORIGIN}/api/nodes/missing/includes`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ child_id: child.id }),
      }),
      env,
      sessions,
      catalog,
      wiki,
    );
    assert.equal(missing.status, 404);

    const outsiderSessions = memoryStore();
    const outsider = await mintCookie(outsiderSessions);
    const forbidden = await handleWiki(
      new Request(`${ORIGIN}/api/nodes/${plan.id}/includes`, {
        method: "POST",
        headers: {
          cookie: outsider.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({ child_id: child.id }),
      }),
      env,
      outsiderSessions,
      catalog,
      wiki,
    );
    assert.equal(forbidden.status, 403);
  });

  it("GET work-item nodes is empty then includes attached node", async () => {
    const { cookie, catalog, wiki, bundle, sessions } = await memberContext();
    catalog.seedWorkItem(farmWorkItem(bundle, "wi-1"));
    const empty = await handleWiki(
      new Request(`${ORIGIN}/api/work-items/wi-1/nodes`, {
        headers: { cookie },
      }),
      env,
      sessions,
      catalog,
      wiki,
    );
    assert.equal(empty.status, 200);
    assert.deepEqual(await empty.json(), { nodes: [] });

    const created = await handleWiki(
      new Request(`${ORIGIN}/api/workspaces/${bundle.workspace.id}/nodes`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ title: "Egg", type: "note", summary: "shell" }),
      }),
      env,
      sessions,
      catalog,
      wiki,
    );
    const { node } = (await created.json()) as {
      node: { id: string; title: string; type: string; summary: string | null };
    };
    await handleWiki(
      new Request(`${ORIGIN}/api/nodes/${node.id}/work-items`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ work_item_id: "wi-1" }),
      }),
      env,
      sessions,
      catalog,
      wiki,
    );
    const listed = await handleWiki(
      new Request(`${ORIGIN}/api/work-items/wi-1/nodes`, {
        headers: { cookie },
      }),
      env,
      sessions,
      catalog,
      wiki,
    );
    assert.equal(listed.status, 200);
    assert.deepEqual(await listed.json(), {
      nodes: [
        {
          id: node.id,
          title: "Egg",
          type: "note",
          summary: "shell",
        },
      ],
    });
  });

  it("POST work-item nodes is 201 then 200; other-workspace node 400; no session 401", async () => {
    const { cookie, catalog, wiki, bundle, sessions } = await memberContext();
    catalog.seedWorkItem(farmWorkItem(bundle, "wi-1"));
    const created = await handleWiki(
      new Request(`${ORIGIN}/api/workspaces/${bundle.workspace.id}/nodes`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ title: "Egg" }),
      }),
      env,
      sessions,
      catalog,
      wiki,
    );
    const { node } = (await created.json()) as { node: { id: string } };

    const first = await handleWiki(
      new Request(`${ORIGIN}/api/work-items/wi-1/nodes`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ node_id: node.id }),
      }),
      env,
      sessions,
      catalog,
      wiki,
    );
    assert.equal(first.status, 201);
    const second = await handleWiki(
      new Request(`${ORIGIN}/api/work-items/wi-1/nodes`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ node_id: node.id }),
      }),
      env,
      sessions,
      catalog,
      wiki,
    );
    assert.equal(second.status, 200);

    await wiki.insertNode({
      id: "n-other",
      workspace_id: "ws-other",
      organization_id: "org-other",
      type: "note",
      payload_kind: "markdown",
      title: "Away",
      summary: null,
      content: "",
      blob_key: null,
      mime_type: null,
      byte_size: null,
      filename: null,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      pinned: 0,
    });
    const other = await handleWiki(
      new Request(`${ORIGIN}/api/work-items/wi-1/nodes`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ node_id: "n-other" }),
      }),
      env,
      sessions,
      catalog,
      wiki,
    );
    assert.equal(other.status, 400);

    const noSession = await handleWiki(
      new Request(`${ORIGIN}/api/work-items/wi-1/nodes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ node_id: node.id }),
      }),
      env,
      memoryStore(),
      catalog,
      wiki,
    );
    assert.equal(noSession.status, 401);
  });

  it("unfiltered GET list still returns a node with no links", async () => {
    const { cookie, catalog, wiki, bundle, sessions } = await memberContext();
    await handleWiki(
      new Request(`${ORIGIN}/api/workspaces/${bundle.workspace.id}/nodes`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ title: "Loose" }),
      }),
      env,
      sessions,
      catalog,
      wiki,
    );
    const listed = await handleWiki(
      new Request(`${ORIGIN}/api/workspaces/${bundle.workspace.id}/nodes`, {
        headers: { cookie },
      }),
      env,
      sessions,
      catalog,
      wiki,
    );
    const body = (await listed.json()) as { nodes: { title: string }[] };
    assert.ok(body.nodes.some((n) => n.title === "Loose"));
  });

  it("GET nodes ?project_id= child omits root-linked and includes child-linked", async () => {
    const { cookie, catalog, wiki, bundle, sessions } = await memberContext();
    catalog.seedWorkItem(farmWorkItem(bundle, "wi-root"));
    catalog.seedProject({
      id: "proj-child",
      workspace_id: bundle.workspace.id,
      organization_id: bundle.organization.id,
      parent_id: bundle.project.id,
      name: "Barn",
      created_at: "2026-01-01T00:00:00.000Z",
    });
    catalog.seedWorkItem({
      ...farmWorkItem(bundle, "wi-child"),
      project_id: "proj-child",
    });

    const rootNode = await handleWiki(
      new Request(`${ORIGIN}/api/workspaces/${bundle.workspace.id}/nodes`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ title: "Root note", work_item_id: "wi-root" }),
      }),
      env,
      sessions,
      catalog,
      wiki,
    );
    assert.equal(rootNode.status, 201);
    const childNode = await handleWiki(
      new Request(`${ORIGIN}/api/workspaces/${bundle.workspace.id}/nodes`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          title: "Child note",
          work_item_id: "wi-child",
        }),
      }),
      env,
      sessions,
      catalog,
      wiki,
    );
    assert.equal(childNode.status, 201);

    const filtered = await handleWiki(
      new Request(
        `${ORIGIN}/api/workspaces/${bundle.workspace.id}/nodes?project_id=proj-child`,
        { headers: { cookie } },
      ),
      env,
      sessions,
      catalog,
      wiki,
    );
    assert.equal(filtered.status, 200);
    const body = (await filtered.json()) as { nodes: { title: string }[] };
    assert.deepEqual(
      body.nodes.map((n) => n.title).sort(),
      ["Child note"],
    );
  });

  async function seedNotify(
    bundle: TenantBundle,
    kinds: NotifyMessage["kind"][] = [
      "node.created",
      "node.updated",
      "node.included",
      "node.cited",
    ],
  ): Promise<{
    notify: NotifyStore;
    sent: NotifyMessage[];
    envWithQueue: Env;
  }> {
    const notify = memoryNotifyStore();
    await notify.insertSubscription({
      id: "sub1",
      workspace_id: bundle.workspace.id,
      organization_id: bundle.organization.id,
      url: "https://bot.example/hook",
      secret: "whsec_dGVzdA==",
      kinds,
      enabled: 1,
      created_at: bundle.workspace.created_at,
      created_by: bundle.membership.principal_id,
    });
    const sent: NotifyMessage[] = [];
    const envWithQueue = {
      ...env,
      NOTIFY: {
        async send(body: NotifyMessage) {
          sent.push(body);
        },
      },
    };
    return { notify, sent, envWithQueue };
  }

  it("POST node enqueues node.created", async () => {
    const { cookie, catalog, wiki, bundle, sessions } = await memberContext();
    const { notify, sent, envWithQueue } = await seedNotify(bundle);
    const created = await handleWiki(
      new Request(`${ORIGIN}/api/workspaces/${bundle.workspace.id}/nodes`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ title: "Egg" }),
      }),
      envWithQueue,
      sessions,
      catalog,
      wiki,
      notify,
    );
    assert.equal(created.status, 201);
    const { node } = (await created.json()) as { node: { id: string } };
    assert.deepEqual(sent, [
      {
        kind: "node.created",
        node_id: node.id,
        workspace_id: "ws-farm",
      },
    ]);
  });

  it("PATCH title enqueues node.updated", async () => {
    const { cookie, catalog, wiki, bundle, sessions } = await memberContext();
    const { notify, sent, envWithQueue } = await seedNotify(bundle);
    const created = await handleWiki(
      new Request(`${ORIGIN}/api/workspaces/${bundle.workspace.id}/nodes`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ title: "Egg" }),
      }),
      env,
      sessions,
      catalog,
      wiki,
    );
    const { node } = (await created.json()) as { node: { id: string } };
    const patched = await handleWiki(
      new Request(`${ORIGIN}/api/nodes/${node.id}`, {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ title: "Hen" }),
      }),
      envWithQueue,
      sessions,
      catalog,
      wiki,
      notify,
    );
    assert.equal(patched.status, 200);
    assert.deepEqual(sent, [
      {
        kind: "node.updated",
        node_id: node.id,
        workspace_id: "ws-farm",
      },
    ]);
  });

  it("POST includes 201 enqueues node.included; 200 does not", async () => {
    const { cookie, catalog, wiki, bundle, sessions } = await memberContext();
    const { notify, sent, envWithQueue } = await seedNotify(bundle);
    const parent = await postNode(
      cookie,
      catalog,
      wiki,
      bundle,
      sessions,
      { title: "Plan" },
    );
    const child = await postNode(
      cookie,
      catalog,
      wiki,
      bundle,
      sessions,
      { title: "Req" },
    );
    const first = await handleWiki(
      new Request(`${ORIGIN}/api/nodes/${parent.id}/includes`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ child_id: child.id }),
      }),
      envWithQueue,
      sessions,
      catalog,
      wiki,
      notify,
    );
    assert.equal(first.status, 201);
    const second = await handleWiki(
      new Request(`${ORIGIN}/api/nodes/${parent.id}/includes`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ child_id: child.id }),
      }),
      envWithQueue,
      sessions,
      catalog,
      wiki,
      notify,
    );
    assert.equal(second.status, 200);
    assert.deepEqual(sent, [
      {
        kind: "node.included",
        node_id: parent.id,
        workspace_id: "ws-farm",
      },
    ]);
  });

  it("POST refs 201 enqueues node.cited; 200 does not", async () => {
    const { cookie, catalog, wiki, bundle, sessions } = await memberContext();
    const { notify, sent, envWithQueue } = await seedNotify(bundle);
    const from = await postNode(
      cookie,
      catalog,
      wiki,
      bundle,
      sessions,
      { title: "Plan" },
    );
    const to = await postNode(
      cookie,
      catalog,
      wiki,
      bundle,
      sessions,
      { title: "Other" },
    );
    const first = await handleWiki(
      new Request(`${ORIGIN}/api/nodes/${from.id}/refs`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ to_id: to.id }),
      }),
      envWithQueue,
      sessions,
      catalog,
      wiki,
      notify,
    );
    assert.equal(first.status, 201);
    const second = await handleWiki(
      new Request(`${ORIGIN}/api/nodes/${from.id}/refs`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ to_id: to.id }),
      }),
      envWithQueue,
      sessions,
      catalog,
      wiki,
      notify,
    );
    assert.equal(second.status, 200);
    assert.deepEqual(sent, [
      {
        kind: "node.cited",
        node_id: from.id,
        workspace_id: "ws-farm",
      },
    ]);
  });

  it("subscription kinds only node.cited does not enqueue create", async () => {
    const { cookie, catalog, wiki, bundle, sessions } = await memberContext();
    const { notify, sent, envWithQueue } = await seedNotify(bundle, [
      "node.cited",
    ]);
    const created = await handleWiki(
      new Request(`${ORIGIN}/api/workspaces/${bundle.workspace.id}/nodes`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ title: "Egg" }),
      }),
      envWithQueue,
      sessions,
      catalog,
      wiki,
      notify,
    );
    assert.equal(created.status, 201);
    assert.equal(sent.length, 0);
  });

  it("env without NOTIFY does not throw on POST node", async () => {
    const { cookie, catalog, wiki, bundle, sessions } = await memberContext();
    const { notify } = await seedNotify(bundle);
    const created = await handleWiki(
      new Request(`${ORIGIN}/api/workspaces/${bundle.workspace.id}/nodes`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ title: "Egg" }),
      }),
      env,
      sessions,
      catalog,
      wiki,
      notify,
    );
    assert.equal(created.status, 201);
  });

  it("POST work-items and projects attach do not enqueue", async () => {
    const { cookie, catalog, wiki, bundle, sessions } = await memberContext();
    const { notify, sent, envWithQueue } = await seedNotify(bundle);
    catalog.seedWorkItem(farmWorkItem(bundle, "wi-1"));
    const created = await handleWiki(
      new Request(`${ORIGIN}/api/workspaces/${bundle.workspace.id}/nodes`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ title: "Egg" }),
      }),
      env,
      sessions,
      catalog,
      wiki,
    );
    const { node } = (await created.json()) as { node: { id: string } };
    const work = await handleWiki(
      new Request(`${ORIGIN}/api/nodes/${node.id}/work-items`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ work_item_id: "wi-1" }),
      }),
      envWithQueue,
      sessions,
      catalog,
      wiki,
      notify,
    );
    assert.equal(work.status, 201);
    const project = await handleWiki(
      new Request(`${ORIGIN}/api/nodes/${node.id}/projects`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ project_id: bundle.project.id }),
      }),
      envWithQueue,
      sessions,
      catalog,
      wiki,
      notify,
    );
    assert.equal(project.status, 201);
    assert.equal(sent.length, 0);
  });
});

async function postNode(
  cookie: string,
  catalog: CatalogStore,
  wiki: WikiStore,
  bundle: TenantBundle,
  sessions: SessionStore,
  body: { title: string; content?: string },
): Promise<{ id: string; title: string }> {
  const res = await handleWiki(
    new Request(`${ORIGIN}/api/workspaces/${bundle.workspace.id}/nodes`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    env,
    sessions,
    catalog,
    wiki,
  );
  assert.equal(res.status, 201);
  const payload = (await res.json()) as {
    node: { id: string; title: string };
  };
  return payload.node;
}
