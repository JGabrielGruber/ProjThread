import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { handleAdmin } from "./admin.ts";
import { handleMe } from "./me.ts";
import type { Env } from "./env.ts";
import {
  type CatalogStore,
  type Membership,
} from "./catalog.ts";
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

function memoryCatalog(
  byPrincipal: Map<string, Membership[]> = new Map(),
): CatalogStore {
  return {
    async listMemberships(principalId) {
      return [...(byPrincipal.get(principalId) ?? [])];
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
    insertTenantBundle: unused,
    insertWorkspaceFor: unused,
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
      sessions.set(row.id, { ...row, workspace_id: row.workspace_id ?? null });
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
): Promise<{ principal: Principal; cookie: string; session: SessionRow }> {
  const catalog = memoryCatalog();
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
  const { session } = (await minted.json()) as { session: SessionRow };
  const setCookie = minted.headers.get("set-cookie");
  assert.ok(setCookie);
  const cookie = setCookie.split(";")[0]!;
  return { principal, cookie, session };
}

describe("handleMe", () => {
  it("returns 401 without a cookie", async () => {
    const store = memoryStore();
    const res = await handleMe(
      new Request(`${ORIGIN}/api/me`),
      env,
      store,
      memoryCatalog(),
    );
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: "unauthorized" });
  });

  it("returns 401 for an empty session cookie", async () => {
    const store = memoryStore();
    const res = await handleMe(
      new Request(`${ORIGIN}/api/me`, {
        headers: { cookie: `${COOKIE_NAME}=` },
      }),
      env,
      store,
      memoryCatalog(),
    );
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: "unauthorized" });
  });

  it("returns the principal and empty memberships for a live session cookie", async () => {
    const store = memoryStore();
    const { principal, cookie } = await mintCookie(store);
    const res = await handleMe(
      new Request(`${ORIGIN}/api/me`, { headers: { cookie } }),
      env,
      store,
      memoryCatalog(),
    );
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), {
      principal,
      memberships: [],
      workspace_id: null,
    });
  });

  it("returns the principal for a live Bearer session", async () => {
    const store = memoryStore();
    const { principal, session } = await mintCookie(store);
    const res = await handleMe(
      new Request(`${ORIGIN}/api/me`, {
        headers: { authorization: `Bearer ${session.id}` },
      }),
      env,
      store,
      memoryCatalog(),
    );
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), {
      principal,
      memberships: [],
      workspace_id: null,
    });
  });

  it("returns 401 for a bad Bearer even when the cookie is live", async () => {
    const store = memoryStore();
    const { cookie } = await mintCookie(store);
    const res = await handleMe(
      new Request(`${ORIGIN}/api/me`, {
        headers: { authorization: "Bearer", cookie },
      }),
      env,
      store,
      memoryCatalog(),
    );
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: "unauthorized" });
  });

  it("returns memberships for a principal with one membership", async () => {
    const store = memoryStore();
    const { principal, cookie } = await mintCookie(store);
    const membership: Membership = {
      organization_id: "org_1",
      organization_name: "Acme",
      workspace_id: "ws_1",
      workspace_name: "Default",
      role: "owner",
    };
    const catalog = memoryCatalog(
      new Map([[principal.id, [membership]]]),
    );
    const res = await handleMe(
      new Request(`${ORIGIN}/api/me`, { headers: { cookie } }),
      env,
      store,
      catalog,
    );
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), {
      principal,
      memberships: [membership],
      workspace_id: null,
    });
  });

  it("PATCH binds workspace_id when it is a membership of this principal", async () => {
    const store = memoryStore();
    const { principal, cookie } = await mintCookie(store);
    const membership: Membership = {
      organization_id: "org_1",
      organization_name: "Acme",
      workspace_id: "ws_1",
      workspace_name: "Default",
      role: "owner",
    };
    const catalog = memoryCatalog(new Map([[principal.id, [membership]]]));
    const patched = await handleMe(
      new Request(`${ORIGIN}/api/me`, {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ workspace_id: "ws_1" }),
      }),
      env,
      store,
      catalog,
    );
    assert.equal(patched.status, 200);
    assert.deepEqual(await patched.json(), {
      principal,
      memberships: [membership],
      workspace_id: "ws_1",
    });
    const later = await handleMe(
      new Request(`${ORIGIN}/api/me`, { headers: { cookie } }),
      env,
      store,
      catalog,
    );
    assert.equal(later.status, 200);
    assert.deepEqual(await later.json(), {
      principal,
      memberships: [membership],
      workspace_id: "ws_1",
    });
  });

  it("PATCH outsider workspace is 400; no session is 401", async () => {
    const store = memoryStore();
    const { principal, cookie } = await mintCookie(store);
    const membership: Membership = {
      organization_id: "org_1",
      organization_name: "Acme",
      workspace_id: "ws_1",
      workspace_name: "Default",
      role: "owner",
    };
    const catalog = memoryCatalog(new Map([[principal.id, [membership]]]));
    const outsider = await handleMe(
      new Request(`${ORIGIN}/api/me`, {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ workspace_id: "ws_other" }),
      }),
      env,
      store,
      catalog,
    );
    assert.equal(outsider.status, 400);
    const noSession = await handleMe(
      new Request(`${ORIGIN}/api/me`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspace_id: "ws_1" }),
      }),
      env,
      store,
      catalog,
    );
    assert.equal(noSession.status, 401);
  });

  it("returns 401 after the session is revoked", async () => {
    const store = memoryStore();
    const { cookie, session } = await mintCookie(store);

    const revoked = await handleAdmin(
      new Request(`${ORIGIN}/api/admin/sessions/${session.id}/revoke`, {
        method: "POST",
        headers: { cookie },
      }),
      env,
      store,
      memoryCatalog(),
    );
    assert.equal(revoked.status, 204);

    const res = await handleMe(
      new Request(`${ORIGIN}/api/me`, { headers: { cookie } }),
      env,
      store,
      memoryCatalog(),
    );
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: "unauthorized" });
  });
});
