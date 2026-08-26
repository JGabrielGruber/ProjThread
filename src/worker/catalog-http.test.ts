import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { handleAdmin } from "./admin.ts";
import { handleCatalog } from "./catalog-http.ts";
import {
  DEFAULT_STAGES,
  type CatalogStore,
  type ProjectRow,
  type StageRow,
  type TenantBundle,
  type WorkItemRow,
} from "./catalog.ts";
import type { Env } from "./env.ts";
import {
  type Principal,
  type SessionRow,
  type SessionStore,
} from "./session.ts";

const ORIGIN = "http://127.0.0.1:8787";
const env = { APP_ORIGIN: ORIGIN } as Env;

type MemoryCatalog = CatalogStore & {
  seedProject(row: ProjectRow & { created_at: string }): void;
};

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
  const stages = new Map<string, StageRow>();
  const projects = new Map<string, ProjectRow & { created_at: string }>();
  const workItems = new Map<string, WorkItemRow>();

  function membershipKey(workspaceId: string, principalId: string): string {
    return `${workspaceId}:${principalId}`;
  }

  return {
    async listMemberships() {
      throw new Error("unused");
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
    async listProjects(workspaceId) {
      return [...projects.values()]
        .filter((p) => p.workspace_id === workspaceId)
        .map(({ created_at: _createdAt, ...row }) => ({ ...row }));
    },
    async getProject(id) {
      const row = projects.get(id);
      return row ? { ...row } : null;
    },
    async listStages(workspaceId) {
      return [...stages.values()]
        .filter((s) => s.workspace_id === workspaceId)
        .sort((a, b) => a.position - b.position)
        .map((s) => ({ ...s }));
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
        { ...b.membership },
      );
    },
    async listOrganizations() {
      throw new Error("unused");
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
  };
}

async function mintCookie(
  store: SessionStore,
): Promise<{ principal: Principal; cookie: string }> {
  const created = await handleAdmin(
    new Request(`${ORIGIN}/api/admin/principals`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "human", display_name: "José" }),
    }),
    env,
    store,
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

async function memberContext(): Promise<{
  cookie: string;
  catalog: MemoryCatalog;
  bundle: TenantBundle;
  sessions: SessionStore;
}> {
  const sessions = memoryStore();
  const { principal, cookie } = await mintCookie(sessions);
  const catalog = memoryCatalog();
  const bundle = farmBundle(principal.id);
  await catalog.insertTenantBundle(bundle);
  return { cookie, catalog, bundle, sessions };
}

describe("handleCatalog", () => {
  it("returns 401 without a cookie", async () => {
    const res = await handleCatalog(
      new Request(`${ORIGIN}/api/workspaces/ws-farm/projects`),
      env,
      memoryStore(),
      memoryCatalog(),
    );
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: "unauthorized" });
  });

  it("returns 403 for another workspace", async () => {
    const { cookie, catalog, sessions } = await memberContext();
    const res = await handleCatalog(
      new Request(`${ORIGIN}/api/workspaces/ws-other/projects`, {
        headers: { cookie },
      }),
      env,
      sessions,
      catalog,
    );
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: "forbidden" });
  });

  it("POST creates a backlog item with null owner", async () => {
    const { cookie, catalog, bundle, sessions } = await memberContext();
    const res = await handleCatalog(
      new Request(
        `${ORIGIN}/api/workspaces/${bundle.workspace.id}/work-items`,
        {
          method: "POST",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({
            title: "  First card  ",
            project_id: bundle.project.id,
          }),
        },
      ),
      env,
      sessions,
      catalog,
    );
    assert.equal(res.status, 201);
    const item = (await res.json()) as WorkItemRow;
    assert.equal(item.title, "First card");
    assert.equal(item.stage_key, "backlog");
    assert.equal(item.owner_id, null);
    assert.equal(item.project_id, bundle.project.id);
    assert.equal(item.workspace_id, bundle.workspace.id);
    assert.equal(item.organization_id, bundle.organization.id);
    assert.equal(item.id.length, 26);
    assert.equal(await catalog.getWorkItem(item.id) !== null, true);
  });

  it("GET work-items includes a descendant project's item when filtering the parent", async () => {
    const { cookie, catalog, bundle, sessions } = await memberContext();
    catalog.seedProject({
      id: "proj-child",
      workspace_id: bundle.workspace.id,
      organization_id: bundle.organization.id,
      parent_id: bundle.project.id,
      name: "Barn",
      created_at: bundle.project.created_at,
    });
    const childItem: WorkItemRow = {
      id: "wi-child",
      project_id: "proj-child",
      workspace_id: bundle.workspace.id,
      organization_id: bundle.organization.id,
      title: "Milk",
      stage_key: "backlog",
      owner_id: null,
      created_at: "2026-01-02T00:00:00.000Z",
      updated_at: "2026-01-02T00:00:00.000Z",
    };
    await catalog.insertWorkItem(childItem);

    const res = await handleCatalog(
      new Request(
        `${ORIGIN}/api/workspaces/${bundle.workspace.id}/work-items?project_id=${bundle.project.id}`,
        { headers: { cookie } },
      ),
      env,
      sessions,
      catalog,
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as { work_items: WorkItemRow[] };
    assert.deepEqual(body.work_items, [childItem]);
  });

  it("PATCH updates title only", async () => {
    const { cookie, catalog, bundle, sessions } = await memberContext();
    await catalog.insertWorkItem({
      id: "wi-1",
      project_id: bundle.project.id,
      workspace_id: bundle.workspace.id,
      organization_id: bundle.organization.id,
      title: "Old title",
      stage_key: "backlog",
      owner_id: null,
      created_at: "2026-01-02T00:00:00.000Z",
      updated_at: "2026-01-02T00:00:00.000Z",
    });

    const res = await handleCatalog(
      new Request(`${ORIGIN}/api/work-items/wi-1`, {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ title: "  New title  " }),
      }),
      env,
      sessions,
      catalog,
    );
    assert.equal(res.status, 200);
    const item = (await res.json()) as WorkItemRow;
    assert.equal(item.title, "New title");
    assert.equal(item.stage_key, "backlog");
    assert.equal(item.owner_id, null);
    assert.ok(item.updated_at > "2026-01-02T00:00:00.000Z");
  });

  it("PATCH with stage_key is 400", async () => {
    const { cookie, catalog, bundle, sessions } = await memberContext();
    await catalog.insertWorkItem({
      id: "wi-1",
      project_id: bundle.project.id,
      workspace_id: bundle.workspace.id,
      organization_id: bundle.organization.id,
      title: "Old title",
      stage_key: "backlog",
      owner_id: null,
      created_at: "2026-01-02T00:00:00.000Z",
      updated_at: "2026-01-02T00:00:00.000Z",
    });

    const res = await handleCatalog(
      new Request(`${ORIGIN}/api/work-items/wi-1`, {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ title: "Nope", stage_key: "done" }),
      }),
      env,
      sessions,
      catalog,
    );
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: "bad_request" });
    const item = await catalog.getWorkItem("wi-1");
    assert.equal(item?.title, "Old title");
    assert.equal(item?.stage_key, "backlog");
  });

  it("POST empty title is 400", async () => {
    const { cookie, catalog, bundle, sessions } = await memberContext();
    const res = await handleCatalog(
      new Request(
        `${ORIGIN}/api/workspaces/${bundle.workspace.id}/work-items`,
        {
          method: "POST",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({ title: "   ", project_id: bundle.project.id }),
        },
      ),
      env,
      sessions,
      catalog,
    );
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: "bad_request" });
  });
});
