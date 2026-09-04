import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { handleAdmin } from "./admin.ts";
import {
  type CatalogStore,
  type TenantBundle,
} from "./catalog.ts";
import { COOKIE_NAME } from "../lib/cookies.ts";
import type { Env } from "./env.ts";
import {
  type Principal,
  type SessionRow,
  type SessionStore,
} from "./session.ts";
import { handleNotify } from "./notify-http.ts";
import { memoryNotifyStore } from "./notify.ts";

const ORIGIN = "http://127.0.0.1:8787";
const env = { APP_ORIGIN: ORIGIN } as Env;

function unused(): never {
  throw new Error("unused");
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
    async insertMembership(row) {
      const key = membershipKey(row.workspace_id, row.principal_id);
      if (memberships.has(key)) return "exists";
      memberships.set(key, { ...row });
      return "inserted";
    },
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
      memberships.set(
        membershipKey(b.membership.workspace_id, b.membership.principal_id),
        { ...b.membership },
      );
    },
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
  const setCookie = minted.headers.get("set-cookie");
  assert.ok(setCookie);
  const cookie = setCookie.split(";")[0]!;
  assert.match(cookie, new RegExp(`^${COOKIE_NAME}=`));
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

async function memberContext() {
  const sessions = memoryStore();
  const { principal, cookie } = await mintCookie(sessions);
  const catalog = memoryCatalog();
  const notify = memoryNotifyStore();
  const bundle = farmBundle(principal.id);
  await catalog.insertTenantBundle(bundle);
  return { cookie, catalog, notify, bundle, sessions };
}

const LIST = `${ORIGIN}/api/workspaces/ws-farm/notify-subscriptions`;

describe("handleNotify", () => {
  it("GET list without cookie is 401", async () => {
    const res = await handleNotify(
      new Request(LIST),
      env,
      memoryStore(),
      memoryCatalog(),
      memoryNotifyStore(),
    );
    assert.equal(res.status, 401);
  });

  it("GET list outsider is 403", async () => {
    const sessions = memoryStore();
    const { cookie } = await mintCookie(sessions);
    const res = await handleNotify(
      new Request(LIST, { headers: { cookie } }),
      env,
      sessions,
      memoryCatalog(),
      memoryNotifyStore(),
    );
    assert.equal(res.status, 403);
  });

  it("owner POST 201 returns secret once; GET omits secret", async () => {
    const { cookie, catalog, notify, sessions } = await memberContext();
    const created = await handleNotify(
      new Request(LIST, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          url: "https://bot.example/hook",
          kinds: ["node.created"],
        }),
      }),
      env,
      sessions,
      catalog,
      notify,
    );
    assert.equal(created.status, 201);
    const payload = (await created.json()) as {
      subscription: {
        id: string;
        workspace_id: string;
        organization_id: string;
        url: string;
        kinds: string[];
        enabled: boolean;
        created_at: string;
        created_by: string;
        secret?: string;
      };
      secret: string;
    };
    assert.match(payload.secret, /^whsec_/);
    assert.equal("secret" in payload.subscription, false);
    assert.equal(payload.subscription.url, "https://bot.example/hook");
    assert.deepEqual(payload.subscription.kinds, ["node.created"]);
    assert.equal(payload.subscription.enabled, true);
    assert.equal(payload.subscription.workspace_id, "ws-farm");
    assert.equal(payload.subscription.organization_id, "org-farm");

    const listed = await handleNotify(
      new Request(LIST, { headers: { cookie } }),
      env,
      sessions,
      catalog,
      notify,
    );
    assert.equal(listed.status, 200);
    const body = (await listed.json()) as {
      subscriptions: { id: string; secret?: string }[];
    };
    assert.equal(body.subscriptions.length, 1);
    assert.equal(body.subscriptions[0]?.id, payload.subscription.id);
    assert.equal("secret" in body.subscriptions[0]!, false);
  });

  it("member POST is 403; member GET is 200", async () => {
    const { catalog, notify, bundle, sessions } = await memberContext();
    const extra = await mintCookie(sessions);
    await catalog.insertMembership({
      workspace_id: bundle.workspace.id,
      principal_id: extra.principal.id,
      role: "member",
    });
    const posted = await handleNotify(
      new Request(LIST, {
        method: "POST",
        headers: { cookie: extra.cookie, "content-type": "application/json" },
        body: JSON.stringify({
          url: "https://bot.example/hook",
          kinds: ["node.created"],
        }),
      }),
      env,
      sessions,
      catalog,
      notify,
    );
    assert.equal(posted.status, 403);
    const listed = await handleNotify(
      new Request(LIST, { headers: { cookie: extra.cookie } }),
      env,
      sessions,
      catalog,
      notify,
    );
    assert.equal(listed.status, 200);
  });

  it("POST bad url or empty kinds is 400", async () => {
    const { cookie, catalog, notify, sessions } = await memberContext();
    for (const body of [
      { url: "not-a-url", kinds: ["node.created"] },
      { url: "javascript:alert(1)", kinds: ["node.created"] },
      { url: "ftp://x", kinds: ["node.created"] },
      { url: "https://bot.example/hook", kinds: [] },
    ]) {
      const res = await handleNotify(
        new Request(LIST, {
          method: "POST",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
        env,
        sessions,
        catalog,
        notify,
      );
      assert.equal(res.status, 400);
      assert.deepEqual(await res.json(), { error: "bad_request" });
    }
  });

  it("PATCH kinds/enabled owner 200; DELETE 204", async () => {
    const { cookie, catalog, notify, sessions } = await memberContext();
    const created = await handleNotify(
      new Request(LIST, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          url: "https://bot.example/hook",
          kinds: ["node.created"],
        }),
      }),
      env,
      sessions,
      catalog,
      notify,
    );
    const payload = (await created.json()) as { subscription: { id: string } };
    const item = `${LIST}/${payload.subscription.id}`;
    const patched = await handleNotify(
      new Request(item, {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ kinds: ["node.cited"], enabled: false }),
      }),
      env,
      sessions,
      catalog,
      notify,
    );
    assert.equal(patched.status, 200);
    const patchedBody = (await patched.json()) as {
      subscription: { kinds: string[]; enabled: boolean; secret?: string };
    };
    assert.deepEqual(patchedBody.subscription.kinds, ["node.cited"]);
    assert.equal(patchedBody.subscription.enabled, false);
    assert.equal("secret" in patchedBody.subscription, false);
    const deleted = await handleNotify(
      new Request(item, { method: "DELETE", headers: { cookie } }),
      env,
      sessions,
      catalog,
      notify,
    );
    assert.equal(deleted.status, 204);
    assert.equal(await deleted.text(), "");
    const listed = await handleNotify(
      new Request(LIST, { headers: { cookie } }),
      env,
      sessions,
      catalog,
      notify,
    );
    const after = (await listed.json()) as { subscriptions: unknown[] };
    assert.equal(after.subscriptions.length, 0);
  });

  it("member PATCH/DELETE is 403", async () => {
    const { cookie, catalog, notify, bundle, sessions } = await memberContext();
    const created = await handleNotify(
      new Request(LIST, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          url: "https://bot.example/hook",
          kinds: ["node.created"],
        }),
      }),
      env,
      sessions,
      catalog,
      notify,
    );
    const payload = (await created.json()) as { subscription: { id: string } };
    const extra = await mintCookie(sessions);
    await catalog.insertMembership({
      workspace_id: bundle.workspace.id,
      principal_id: extra.principal.id,
      role: "member",
    });
    const item = `${LIST}/${payload.subscription.id}`;
    const patched = await handleNotify(
      new Request(item, {
        method: "PATCH",
        headers: { cookie: extra.cookie, "content-type": "application/json" },
        body: JSON.stringify({ enabled: false }),
      }),
      env,
      sessions,
      catalog,
      notify,
    );
    assert.equal(patched.status, 403);
    const deleted = await handleNotify(
      new Request(item, {
        method: "DELETE",
        headers: { cookie: extra.cookie },
      }),
      env,
      sessions,
      catalog,
      notify,
    );
    assert.equal(deleted.status, 403);
  });
});
