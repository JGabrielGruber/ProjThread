import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { handleAdmin } from "./admin.ts";
import {
  DEFAULT_STAGES,
  type CatalogStore,
  type Membership,
  type ProjectRow,
  type StageRow,
} from "./catalog.ts";
import type { Env } from "./env.ts";
import {
  type Principal,
  type SessionRow,
  type SessionStore,
} from "./session.ts";
import { COOKIE_NAME } from "../lib/cookies.ts";

const ORIGIN = "http://127.0.0.1:8787";
const env = { APP_ORIGIN: ORIGIN } as Env;

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

function memoryCatalog(): CatalogStore {
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
    insertWorkspaceFor: unused,
    async listOrganizations() {
      return [...organizations.values()].map((o) => ({
        id: o.id,
        name: o.name,
      }));
    },
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
    async updateSessionWorkspace(id, workspaceId) {
      const row = sessions.get(id);
      if (row) sessions.set(id, { ...row, workspace_id: workspaceId });
    },
  };
}

function adminRequest(
  path: string,
  init: RequestInit = {},
): Request {
  return new Request(`${ORIGIN}${path}`, init);
}

describe("handleAdmin", () => {
  it("POSTs a human principal and lists it", async () => {
    const store = memoryStore();
    const created = await handleAdmin(
      adminRequest("/api/admin/principals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "human", display_name: "José" }),
      }),
      env,
      store,
      stubCatalog(),
    );

    assert.equal(created.status, 201);
    const principal = (await created.json()) as Principal;
    assert.equal(principal.type, "human");
    assert.equal(principal.display_name, "José");
    assert.equal(typeof principal.id, "string");
    assert.ok(principal.id.length > 0);

    const listed = await handleAdmin(
      adminRequest("/api/admin/principals"),
      env,
      store,
      stubCatalog(),
    );
    assert.equal(listed.status, 200);
    const body = (await listed.json()) as { principals: Principal[] };
    assert.deepEqual(body.principals, [principal]);
  });

  it("rejects principal create with bad type or empty name", async () => {
    const store = memoryStore();
    const badType = await handleAdmin(
      adminRequest("/api/admin/principals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "bot", display_name: "x" }),
      }),
      env,
      store,
      stubCatalog(),
    );
    assert.equal(badType.status, 400);
    assert.deepEqual(await badType.json(), { error: "bad_request" });

    const emptyName = await handleAdmin(
      adminRequest("/api/admin/principals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "human", display_name: "  " }),
      }),
      env,
      store,
      stubCatalog(),
    );
    assert.equal(emptyName.status, 400);
    assert.deepEqual(await emptyName.json(), { error: "bad_request" });
  });

  it("mints a session with Set-Cookie pt_session and minted_by = principal", async () => {
    const store = memoryStore();
    const created = await handleAdmin(
      adminRequest("/api/admin/principals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "human", display_name: "José" }),
      }),
      env,
      store,
      stubCatalog(),
    );
    const principal = (await created.json()) as Principal;

    const minted = await handleAdmin(
      adminRequest("/api/admin/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ principal_id: principal.id }),
      }),
      env,
      store,
      stubCatalog(),
    );
    assert.equal(minted.status, 201);
    const setCookie = minted.headers.get("set-cookie");
    assert.ok(setCookie);
    assert.match(setCookie, new RegExp(`${COOKIE_NAME}=`));

    const body = (await minted.json()) as { session: SessionRow };
    assert.equal(body.session.principal_id, principal.id);
    assert.equal(body.session.minted_by, principal.id);
    assert.match(setCookie, new RegExp(`${COOKIE_NAME}=${body.session.id}`));
  });

  it("omits Set-Cookie when set_cookie is false", async () => {
    const store = memoryStore();
    const created = await handleAdmin(
      adminRequest("/api/admin/principals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "agent", display_name: "Grok Bot" }),
      }),
      env,
      store,
      stubCatalog(),
    );
    const principal = (await created.json()) as Principal;

    const minted = await handleAdmin(
      adminRequest("/api/admin/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          principal_id: principal.id,
          set_cookie: false,
        }),
      }),
      env,
      store,
      stubCatalog(),
    );
    assert.equal(minted.status, 201);
    assert.equal(minted.headers.get("set-cookie"), null);
    const body = (await minted.json()) as { session: SessionRow };
    assert.equal(body.session.principal_id, principal.id);
    assert.ok(body.session.id);
    assert.ok(body.session.expires_at);
  });

  it("returns 400 without principal_id and 404 if principal missing", async () => {
    const store = memoryStore();
    const missingBody = await handleAdmin(
      adminRequest("/api/admin/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
      env,
      store,
      stubCatalog(),
    );
    assert.equal(missingBody.status, 400);
    assert.deepEqual(await missingBody.json(), { error: "bad_request" });

    const missingPrincipal = await handleAdmin(
      adminRequest("/api/admin/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ principal_id: "01notfoundprincipal000000000" }),
      }),
      env,
      store,
      stubCatalog(),
    );
    assert.equal(missingPrincipal.status, 404);
    assert.deepEqual(await missingPrincipal.json(), { error: "not_found" });
  });

  it("revokes a session with 204 and clears the cookie when it matches", async () => {
    const store = memoryStore();
    const created = await handleAdmin(
      adminRequest("/api/admin/principals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "human", display_name: "José" }),
      }),
      env,
      store,
      stubCatalog(),
    );
    const principal = (await created.json()) as Principal;
    const minted = await handleAdmin(
      adminRequest("/api/admin/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ principal_id: principal.id }),
      }),
      env,
      store,
      stubCatalog(),
    );
    const { session } = (await minted.json()) as { session: SessionRow };

    const revoked = await handleAdmin(
      adminRequest(`/api/admin/sessions/${session.id}/revoke`, {
        method: "POST",
        headers: { cookie: `${COOKIE_NAME}=${session.id}` },
      }),
      env,
      store,
      stubCatalog(),
    );
    assert.equal(revoked.status, 204);
    const clear = revoked.headers.get("set-cookie");
    assert.ok(clear);
    assert.match(clear, new RegExp(`${COOKIE_NAME}=`));
    assert.match(clear, /Max-Age=0/);

    const stored = await store.getSession(session.id);
    assert.ok(stored?.revoked_at);
  });

  it("returns 404 for unknown admin API paths", async () => {
    const store = memoryStore();
    const res = await handleAdmin(
      adminRequest("/api/admin/nope"),
      env,
      store,
      stubCatalog(),
    );
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: "not_found" });
  });

  it("POSTs an organization tenant bundle and lists it", async () => {
    const store = memoryStore();
    const catalog = memoryCatalog();
    const created = await handleAdmin(
      adminRequest("/api/admin/organizations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Farm" }),
      }),
      env,
      store,
      catalog,
    );
    assert.equal(created.status, 201);
    const body = (await created.json()) as {
      organization: { id: string; name: string };
      workspace: { id: string; name: string };
      project: { id: string; name: string; parent_id: string | null };
      principal: { id: string; type: string; display_name: string };
    };
    assert.equal(body.organization.name, "Farm");
    assert.equal(body.workspace.name, "Farm");
    assert.equal(body.project.name, "Farm");
    assert.equal(body.project.parent_id, null);
    assert.equal(body.principal.type, "human");
    assert.equal(body.principal.display_name, "Farm");
    assert.ok(body.organization.id);
    assert.ok(body.workspace.id);
    assert.ok(body.project.id);
    assert.ok(body.principal.id);

    const memberships = await catalog.listMemberships(body.principal.id);
    assert.deepEqual(memberships, [
      {
        organization_id: body.organization.id,
        organization_name: "Farm",
        workspace_id: body.workspace.id,
        workspace_name: "Farm",
        role: "owner",
      },
    ]);

    const listed = await handleAdmin(
      adminRequest("/api/admin/organizations"),
      env,
      store,
      catalog,
    );
    assert.equal(listed.status, 200);
    const orgs = (await listed.json()) as {
      organizations: { id: string; name: string }[];
    };
    assert.deepEqual(orgs.organizations, [
      { id: body.organization.id, name: "Farm" },
    ]);
  });

  it("rejects organization create with empty name", async () => {
    const store = memoryStore();
    const catalog = memoryCatalog();
    const empty = await handleAdmin(
      adminRequest("/api/admin/organizations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "" }),
      }),
      env,
      store,
      catalog,
    );
    assert.equal(empty.status, 400);
    assert.deepEqual(await empty.json(), { error: "bad_request" });

    const whitespace = await handleAdmin(
      adminRequest("/api/admin/organizations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "  " }),
      }),
      env,
      store,
      catalog,
    );
    assert.equal(whitespace.status, 400);
    assert.deepEqual(await whitespace.json(), { error: "bad_request" });
  });
});
