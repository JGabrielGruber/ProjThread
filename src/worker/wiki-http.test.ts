import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { handleAdmin } from "./admin.ts";
import {
  type CatalogStore,
  type TenantBundle,
  type WorkItemRow,
} from "./catalog.ts";
import type { Env } from "./env.ts";
import {
  type Principal,
  type SessionRow,
  type SessionStore,
} from "./session.ts";
import { handleWiki } from "./wiki-http.ts";
import { memoryWikiStore, type WikiStore } from "./wiki.ts";

const ORIGIN = "http://127.0.0.1:8787";
const env = { APP_ORIGIN: ORIGIN } as Env;

type MemoryCatalog = CatalogStore & {
  seedWorkItem(row: WorkItemRow): void;
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
    insertTenantBundle: unused,
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
    listProjects: unused,
    getProject: unused,
    insertProject: unused,
    updateProjectName: unused,
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
      memberships.set(
        membershipKey(b.membership.workspace_id, b.membership.principal_id),
        { ...b.membership },
      );
    },
    listOrganizations: unused,
    listWorkItemEvents: unused,
    commitWorkItemEvent: unused,
    seedWorkItem(row) {
      workItems.set(row.id, { ...row });
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
    };
    assert.equal(body.node.content, "# Hi");
    assert.deepEqual(body.work_item_ids, []);
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
});
