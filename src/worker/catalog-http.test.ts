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
  type WorkItemEventRow,
  type WorkItemRow,
  type WorkspaceMemberRow,
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
  const events = new Map<string, WorkItemEventRow>();
  const principals = new Map<
    string,
    { id: string; type: "human" | "agent" | "service"; display_name: string }
  >();

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
    async insertMembership(row) {
      const key = membershipKey(row.workspace_id, row.principal_id);
      if (memberships.has(key)) return "exists";
      memberships.set(key, { ...row });
      return "inserted";
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
        { ...b.membership },
      );
    },
    async listOrganizations() {
      throw new Error("unused");
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
    seedProject(row) {
      projects.set(row.id, { ...row });
    },
  };
}

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

  it("GET work-item snapshot returns the row", async () => {
    const { cookie, catalog, bundle, sessions } = await memberContext();
    const row: WorkItemRow = {
      id: "wi-snap",
      project_id: bundle.project.id,
      workspace_id: bundle.workspace.id,
      organization_id: bundle.organization.id,
      title: "Snapshot card",
      stage_key: "backlog",
      owner_id: null,
      created_at: "2026-01-02T00:00:00.000Z",
      updated_at: "2026-01-02T00:00:00.000Z",
    };
    await catalog.insertWorkItem(row);

    const res = await handleCatalog(
      new Request(`${ORIGIN}/api/work-items/wi-snap`, { headers: { cookie } }),
      env,
      sessions,
      catalog,
    );
    assert.equal(res.status, 200);
    const item = (await res.json()) as WorkItemRow;
    assert.equal(item.id, "wi-snap");
    assert.equal(item.title, "Snapshot card");
    assert.equal(item.stage_key, "backlog");
    assert.deepEqual(item, row);
  });

  it("GET work-item without cookie is 401", async () => {
    const res = await handleCatalog(
      new Request(`${ORIGIN}/api/work-items/wi-snap`),
      env,
      memoryStore(),
      memoryCatalog(),
    );
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: "unauthorized" });
  });

  it("GET work-item in another workspace is 403", async () => {
    const { cookie, catalog, sessions } = await memberContext();
    await catalog.insertWorkItem({
      id: "wi-other",
      project_id: "proj-other",
      workspace_id: "ws-other",
      organization_id: "org-other",
      title: "Other",
      stage_key: "backlog",
      owner_id: null,
      created_at: "2026-01-02T00:00:00.000Z",
      updated_at: "2026-01-02T00:00:00.000Z",
    });

    const res = await handleCatalog(
      new Request(`${ORIGIN}/api/work-items/wi-other`, { headers: { cookie } }),
      env,
      sessions,
      catalog,
    );
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: "forbidden" });
  });

  it("GET unknown work-item is 404", async () => {
    const { cookie, catalog, sessions } = await memberContext();
    const res = await handleCatalog(
      new Request(`${ORIGIN}/api/work-items/wi-missing`, {
        headers: { cookie },
      }),
      env,
      sessions,
      catalog,
    );
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: "not_found" });
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

function roomEnv(append: (event_id: string) => Promise<unknown>): Env {
  return {
    APP_ORIGIN: ORIGIN,
    Room: {
      getByName: () => ({
        fetch: async () => new Response(null, { status: 500 }),
        appendSystem: async ({ event_id }) => append(event_id) as never,
      }),
    },
  } as Env;
}

async function seedCard(
  catalog: MemoryCatalog,
  bundle: TenantBundle,
  id = "wi-1",
): Promise<WorkItemRow> {
  const row: WorkItemRow = {
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
  await catalog.insertWorkItem(row);
  return row;
}

describe("handleCatalog events", () => {
  it("GET events without cookie is 401", async () => {
    const res = await handleCatalog(
      new Request(`${ORIGIN}/api/work-items/wi-1/events`),
      env,
      memoryStore(),
      memoryCatalog(),
    );
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: "unauthorized" });
  });

  it("GET events in another workspace is 403", async () => {
    const { cookie, catalog, sessions } = await memberContext();
    await catalog.insertWorkItem({
      id: "wi-other",
      project_id: "proj-other",
      workspace_id: "ws-other",
      organization_id: "org-other",
      title: "Other",
      stage_key: "backlog",
      owner_id: null,
      created_at: "2026-01-02T00:00:00.000Z",
      updated_at: "2026-01-02T00:00:00.000Z",
    });
    const res = await handleCatalog(
      new Request(`${ORIGIN}/api/work-items/wi-other/events`, {
        headers: { cookie },
      }),
      env,
      sessions,
      catalog,
    );
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: "forbidden" });
  });

  it("GET events for a missing item is 404", async () => {
    const { cookie, catalog, sessions } = await memberContext();
    const res = await handleCatalog(
      new Request(`${ORIGIN}/api/work-items/wi-missing/events`, {
        headers: { cookie },
      }),
      env,
      sessions,
      catalog,
    );
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: "not_found" });
  });

  it("GET events on a real item is 200 empty list", async () => {
    const { cookie, catalog, bundle, sessions } = await memberContext();
    await seedCard(catalog, bundle);
    const res = await handleCatalog(
      new Request(`${ORIGIN}/api/work-items/wi-1/events`, {
        headers: { cookie },
      }),
      env,
      sessions,
      catalog,
    );
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { events: [] });
  });

  it("POST note stores body as sent and calls appendSystem once", async () => {
    const { cookie, catalog, bundle, sessions } = await memberContext();
    await seedCard(catalog, bundle);
    const ids: string[] = [];
    const res = await handleCatalog(
      new Request(`${ORIGIN}/api/work-items/wi-1/events`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ type: "note", body: "  hi  " }),
      }),
      roomEnv(async (event_id) => {
        ids.push(event_id);
      }),
      sessions,
      catalog,
    );
    assert.equal(res.status, 201);
    const payload = (await res.json()) as {
      event: WorkItemEventRow;
      work_item: WorkItemRow;
    };
    assert.equal(payload.event.body, "  hi  ");
    assert.equal(payload.event.type, "note");
    assert.deepEqual(ids, [payload.event.id]);
    const listed = await handleCatalog(
      new Request(`${ORIGIN}/api/work-items/wi-1/events`, {
        headers: { cookie },
      }),
      env,
      sessions,
      catalog,
    );
    const body = (await listed.json()) as { events: WorkItemEventRow[] };
    assert.equal(body.events.length, 1);
  });

  it("POST stage_changed updates snapshot stage_key", async () => {
    const { cookie, catalog, bundle, sessions } = await memberContext();
    await seedCard(catalog, bundle);
    const res = await handleCatalog(
      new Request(`${ORIGIN}/api/work-items/wi-1/events`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          type: "stage_changed",
          from: "backlog",
          to: "doing",
          body: "start",
        }),
      }),
      roomEnv(async () => {}),
      sessions,
      catalog,
    );
    assert.equal(res.status, 201);
    const payload = (await res.json()) as { work_item: WorkItemRow };
    assert.equal(payload.work_item.stage_key, "doing");
    const snap = await handleCatalog(
      new Request(`${ORIGIN}/api/work-items/wi-1`, { headers: { cookie } }),
      env,
      sessions,
      catalog,
    );
    const item = (await snap.json()) as WorkItemRow;
    assert.equal(item.stage_key, "doing");
  });

  it("POST stage_changed empty body is 400 and does not append", async () => {
    const { cookie, catalog, bundle, sessions } = await memberContext();
    await seedCard(catalog, bundle);
    let calls = 0;
    const res = await handleCatalog(
      new Request(`${ORIGIN}/api/work-items/wi-1/events`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          type: "stage_changed",
          from: "backlog",
          to: "doing",
          body: "",
        }),
      }),
      roomEnv(async () => {
        calls += 1;
      }),
      sessions,
      catalog,
    );
    assert.equal(res.status, 400);
    assert.equal(calls, 0);
    const item = await catalog.getWorkItem("wi-1");
    assert.equal(item?.stage_key, "backlog");
  });

  it("POST stage_changed with wrong from is 400", async () => {
    const { cookie, catalog, bundle, sessions } = await memberContext();
    await seedCard(catalog, bundle);
    const res = await handleCatalog(
      new Request(`${ORIGIN}/api/work-items/wi-1/events`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          type: "stage_changed",
          from: "doing",
          to: "done",
          body: "skip",
        }),
      }),
      roomEnv(async () => {}),
      sessions,
      catalog,
    );
    assert.equal(res.status, 400);
  });

  it("POST stage_changed to unknown stage is 400", async () => {
    const { cookie, catalog, bundle, sessions } = await memberContext();
    await seedCard(catalog, bundle);
    const res = await handleCatalog(
      new Request(`${ORIGIN}/api/work-items/wi-1/events`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          type: "stage_changed",
          from: "backlog",
          to: "nope",
          body: "bad",
        }),
      }),
      roomEnv(async () => {}),
      sessions,
      catalog,
    );
    assert.equal(res.status, 400);
  });

  it("PATCH with stage_key is still 400", async () => {
    const { cookie, catalog, bundle, sessions } = await memberContext();
    await seedCard(catalog, bundle);
    const res = await handleCatalog(
      new Request(`${ORIGIN}/api/work-items/wi-1`, {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ title: "Nope", stage_key: "doing" }),
      }),
      env,
      sessions,
      catalog,
    );
    assert.equal(res.status, 400);
  });

  it("POST decision empty body is 400", async () => {
    const { cookie, catalog, bundle, sessions } = await memberContext();
    await seedCard(catalog, bundle);
    const res = await handleCatalog(
      new Request(`${ORIGIN}/api/work-items/wi-1/events`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ type: "decision", body: "" }),
      }),
      roomEnv(async () => {}),
      sessions,
      catalog,
    );
    assert.equal(res.status, 400);
  });

  it("POST owner_changed assigns a workspace member", async () => {
    const { cookie, catalog, bundle, sessions } = await memberContext();
    await seedCard(catalog, bundle);
    const res = await handleCatalog(
      new Request(`${ORIGIN}/api/work-items/wi-1/events`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          type: "owner_changed",
          from: null,
          to: bundle.principal.id,
        }),
      }),
      roomEnv(async () => {}),
      sessions,
      catalog,
    );
    assert.equal(res.status, 201);
    const payload = (await res.json()) as { work_item: WorkItemRow };
    assert.equal(payload.work_item.owner_id, bundle.principal.id);
  });

  it("POST owner_changed to an outsider is 400", async () => {
    const { cookie, catalog, bundle, sessions } = await memberContext();
    await seedCard(catalog, bundle);
    const res = await handleCatalog(
      new Request(`${ORIGIN}/api/work-items/wi-1/events`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          type: "owner_changed",
          from: null,
          to: "prin-outsider",
        }),
      }),
      roomEnv(async () => {}),
      sessions,
      catalog,
    );
    assert.equal(res.status, 400);
  });

  it("appendSystem first throw then success still 201", async () => {
    const { cookie, catalog, bundle, sessions } = await memberContext();
    await seedCard(catalog, bundle);
    let calls = 0;
    const res = await handleCatalog(
      new Request(`${ORIGIN}/api/work-items/wi-1/events`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ type: "note", body: "retry" }),
      }),
      roomEnv(async () => {
        calls += 1;
        if (calls === 1) throw new Error("fail");
      }),
      sessions,
      catalog,
    );
    assert.equal(res.status, 201);
    assert.equal(calls, 2);
    const listed = await catalog.listWorkItemEvents("wi-1");
    assert.equal(listed.length, 1);
  });

  it("appendSystem both throws still 201 and lists the D1 event", async () => {
    const { cookie, catalog, bundle, sessions } = await memberContext();
    await seedCard(catalog, bundle);
    let calls = 0;
    const res = await handleCatalog(
      new Request(`${ORIGIN}/api/work-items/wi-1/events`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ type: "note", body: "keep" }),
      }),
      roomEnv(async () => {
        calls += 1;
        throw new Error("fail");
      }),
      sessions,
      catalog,
    );
    assert.equal(res.status, 201);
    assert.equal(calls, 2);
    const listed = await catalog.listWorkItemEvents("wi-1");
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.body, "keep");
  });
});

describe("handleCatalog config", () => {
  it("GET members no cookie is 401", async () => {
    const res = await handleCatalog(
      new Request(`${ORIGIN}/api/workspaces/ws-farm/members`),
      env,
      memoryStore(),
      memoryCatalog(),
    );
    assert.equal(res.status, 401);
  });

  it("outsider cookie GET members is 403", async () => {
    const { catalog, bundle, sessions } = await memberContext();
    const outsider = await mintCookie(sessions);
    const res = await handleCatalog(
      new Request(`${ORIGIN}/api/workspaces/${bundle.workspace.id}/members`, {
        headers: { cookie: outsider.cookie },
      }),
      env,
      sessions,
      catalog,
    );
    assert.equal(res.status, 403);
  });

  it("member GET members is 200 and includes seeded owner principal_id", async () => {
    const { cookie, catalog, bundle, sessions } = await memberContext();
    const res = await handleCatalog(
      new Request(`${ORIGIN}/api/workspaces/${bundle.workspace.id}/members`, {
        headers: { cookie },
      }),
      env,
      sessions,
      catalog,
    );
    assert.equal(res.status, 200);
    const payload = (await res.json()) as { members: { principal_id: string }[] };
    assert.ok(payload.members.some((m) => m.principal_id === bundle.principal.id));
  });

  it("POST members of an existing non-member principal is 201 with role member", async () => {
    const { cookie, catalog, bundle, sessions } = await memberContext();
    const extra = await mintCookie(sessions);
    const before = await handleCatalog(
      new Request(`${ORIGIN}/api/workspaces/${bundle.workspace.id}/members`, {
        headers: { cookie },
      }),
      env,
      sessions,
      catalog,
    );
    const beforePayload = (await before.json()) as { members: unknown[] };
    const res = await handleCatalog(
      new Request(`${ORIGIN}/api/workspaces/${bundle.workspace.id}/members`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ principal_id: extra.principal.id }),
      }),
      env,
      sessions,
      catalog,
    );
    assert.equal(res.status, 201);
    const payload = (await res.json()) as {
      member: { principal_id: string; role: string };
    };
    assert.equal(payload.member.principal_id, extra.principal.id);
    assert.equal(payload.member.role, "member");
    const listed = await handleCatalog(
      new Request(`${ORIGIN}/api/workspaces/${bundle.workspace.id}/members`, {
        headers: { cookie },
      }),
      env,
      sessions,
      catalog,
    );
    const after = (await listed.json()) as { members: unknown[] };
    assert.equal(after.members.length, beforePayload.members.length + 1);
  });

  it("POST members again is 200 and does not add a row", async () => {
    const { cookie, catalog, bundle, sessions } = await memberContext();
    const extra = await mintCookie(sessions);
    const body = JSON.stringify({ principal_id: extra.principal.id });
    const first = await handleCatalog(
      new Request(`${ORIGIN}/api/workspaces/${bundle.workspace.id}/members`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body,
      }),
      env,
      sessions,
      catalog,
    );
    assert.equal(first.status, 201);
    const second = await handleCatalog(
      new Request(`${ORIGIN}/api/workspaces/${bundle.workspace.id}/members`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body,
      }),
      env,
      sessions,
      catalog,
    );
    assert.equal(second.status, 200);
    const listed = await handleCatalog(
      new Request(`${ORIGIN}/api/workspaces/${bundle.workspace.id}/members`, {
        headers: { cookie },
      }),
      env,
      sessions,
      catalog,
    );
    const after = (await listed.json()) as { members: unknown[] };
    assert.equal(after.members.length, 2);
  });

  it("POST members unknown principal is 400", async () => {
    const { cookie, catalog, bundle, sessions } = await memberContext();
    const res = await handleCatalog(
      new Request(`${ORIGIN}/api/workspaces/${bundle.workspace.id}/members`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ principal_id: "missing" }),
      }),
      env,
      sessions,
      catalog,
    );
    assert.equal(res.status, 400);
  });

  it("POST members with role nope is 400", async () => {
    const { cookie, catalog, bundle, sessions } = await memberContext();
    const extra = await mintCookie(sessions);
    const res = await handleCatalog(
      new Request(`${ORIGIN}/api/workspaces/${bundle.workspace.id}/members`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          principal_id: extra.principal.id,
          role: "nope",
        }),
      }),
      env,
      sessions,
      catalog,
    );
    assert.equal(res.status, 400);
  });

  it("POST projects with parent_id of seeded root is 201", async () => {
    const { cookie, catalog, bundle, sessions } = await memberContext();
    const res = await handleCatalog(
      new Request(`${ORIGIN}/api/workspaces/${bundle.workspace.id}/projects`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ name: "Barn", parent_id: bundle.project.id }),
      }),
      env,
      sessions,
      catalog,
    );
    assert.equal(res.status, 201);
    const payload = (await res.json()) as {
      project: { parent_id: string | null; name: string };
    };
    assert.equal(payload.project.name, "Barn");
    assert.equal(payload.project.parent_id, bundle.project.id);
  });

  it("POST projects blank name is 400", async () => {
    const { cookie, catalog, bundle, sessions } = await memberContext();
    const res = await handleCatalog(
      new Request(`${ORIGIN}/api/workspaces/${bundle.workspace.id}/projects`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ name: "   " }),
      }),
      env,
      sessions,
      catalog,
    );
    assert.equal(res.status, 400);
  });

  it("POST projects with parent in another workspace is 400", async () => {
    const { cookie, catalog, bundle, sessions } = await memberContext();
    catalog.seedProject({
      id: "proj-other",
      workspace_id: "ws-other",
      organization_id: "org-other",
      parent_id: null,
      name: "Other",
      created_at: "2026-01-01T00:00:00.000Z",
    });
    const res = await handleCatalog(
      new Request(`${ORIGIN}/api/workspaces/${bundle.workspace.id}/projects`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ name: "X", parent_id: "proj-other" }),
      }),
      env,
      sessions,
      catalog,
    );
    assert.equal(res.status, 400);
  });

  it("PATCH project name is 200", async () => {
    const { cookie, catalog, bundle, sessions } = await memberContext();
    const res = await handleCatalog(
      new Request(`${ORIGIN}/api/projects/${bundle.project.id}`, {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ name: "Farm" }),
      }),
      env,
      sessions,
      catalog,
    );
    assert.equal(res.status, 200);
    const payload = (await res.json()) as { project: { name: string } };
    assert.equal(payload.project.name, "Farm");
  });

  it("PATCH project with parent_id is 400 and name unchanged", async () => {
    const { cookie, catalog, bundle, sessions } = await memberContext();
    const res = await handleCatalog(
      new Request(`${ORIGIN}/api/projects/${bundle.project.id}`, {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ name: "Farm", parent_id: null }),
      }),
      env,
      sessions,
      catalog,
    );
    assert.equal(res.status, 400);
    const project = await catalog.getProject(bundle.project.id);
    assert.equal(project?.name, "Farm");
  });

  it("PATCH stages full key set swaps labels and positions", async () => {
    const { cookie, catalog, bundle, sessions } = await memberContext();
    const res = await handleCatalog(
      new Request(`${ORIGIN}/api/workspaces/${bundle.workspace.id}/stages`, {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          stages: [
            { key: "doing", label: "Now", position: 0 },
            { key: "backlog", label: "Backlog", position: 1 },
            { key: "done", label: "Done", position: 2 },
          ],
        }),
      }),
      env,
      sessions,
      catalog,
    );
    assert.equal(res.status, 200);
    const get = await handleCatalog(
      new Request(`${ORIGIN}/api/workspaces/${bundle.workspace.id}/stages`, {
        headers: { cookie },
      }),
      env,
      sessions,
      catalog,
    );
    const payload = (await get.json()) as {
      stages: { key: string; label: string; position: number }[];
    };
    assert.deepEqual(payload.stages, [
      {
        workspace_id: bundle.workspace.id,
        key: "doing",
        label: "Now",
        position: 0,
      },
      {
        workspace_id: bundle.workspace.id,
        key: "backlog",
        label: "Backlog",
        position: 1,
      },
      {
        workspace_id: bundle.workspace.id,
        key: "done",
        label: "Done",
        position: 2,
      },
    ]);
    assert.equal(res.status, 200);
  });

  it("PATCH stages missing a key is 400", async () => {
    const { cookie, catalog, bundle, sessions } = await memberContext();
    const res = await handleCatalog(
      new Request(`${ORIGIN}/api/workspaces/${bundle.workspace.id}/stages`, {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          stages: [
            { key: "doing", label: "Now", position: 0 },
            { key: "backlog", label: "Backlog", position: 1 },
          ],
        }),
      }),
      env,
      sessions,
      catalog,
    );
    assert.equal(res.status, 400);
  });
});
