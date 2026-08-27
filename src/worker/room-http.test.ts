import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { handleAdmin } from "./admin.ts";
import type { CatalogStore, WorkItemRow } from "./catalog.ts";
import type { Env, RoomNamespace } from "./env.ts";
import { handleRoom } from "./room-http.ts";
import {
  type Principal,
  type SessionRow,
  type SessionStore,
} from "./session.ts";

const ORIGIN = "http://127.0.0.1:8787";

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
  const env = { APP_ORIGIN: ORIGIN } as Env;
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

function memoryCatalog(opts: {
  item?: WorkItemRow;
  memberPrincipalId?: string;
}): CatalogStore {
  return {
    ...stubCatalog(),
    async getWorkItem(id) {
      return opts.item && opts.item.id === id ? { ...opts.item } : null;
    },
    async getMembership(workspaceId, principalId) {
      if (
        opts.item &&
        workspaceId === opts.item.workspace_id &&
        principalId === opts.memberPrincipalId
      ) {
        return {
          organization_id: opts.item.organization_id,
          organization_name: "Farm",
          workspace_id: opts.item.workspace_id,
          workspace_name: "Farm",
          role: "owner",
        };
      }
      return null;
    },
  };
}

function farmItem(): WorkItemRow {
  return {
    id: "wi-farm",
    project_id: "proj-farm",
    workspace_id: "ws-farm",
    organization_id: "org-farm",
    title: "Card",
    stage_key: "backlog",
    owner_id: null,
    created_at: "2026-01-02T00:00:00.000Z",
    updated_at: "2026-01-02T00:00:00.000Z",
  };
}

function fakeRoom(): {
  Room: RoomNamespace;
  names: string[];
  principals: string[];
} {
  const names: string[] = [];
  const principals: string[] = [];
  return {
    names,
    principals,
    Room: {
      getByName(name) {
        names.push(name);
        return {
          async fetch(input, init) {
            const req =
              input instanceof Request ? input : new Request(input, init);
            principals.push(req.headers.get("X-Pt-Principal") ?? "");
            return {
              status: 101,
              async text() {
                return "upgraded";
              },
            } as Response;
          },
          async appendSystem() {
            throw new Error("unused");
          },
        };
      },
    },
  };
}

async function memberEnv(): Promise<{
  env: Env;
  sessions: SessionStore;
  catalog: CatalogStore;
  cookie: string;
  principal: Principal;
  item: WorkItemRow;
  names: string[];
  principals: string[];
}> {
  const sessions = memoryStore();
  const { principal, cookie } = await mintCookie(sessions);
  const item = farmItem();
  const catalog = memoryCatalog({
    item,
    memberPrincipalId: principal.id,
  });
  const { Room, names, principals } = fakeRoom();
  const env = { APP_ORIGIN: ORIGIN, Room } as Env;
  return { env, sessions, catalog, cookie, principal, item, names, principals };
}

function upgradeHeaders(cookie?: string): HeadersInit {
  const headers: Record<string, string> = { Upgrade: "websocket" };
  if (cookie) headers.cookie = cookie;
  return headers;
}

describe("handleRoom", () => {
  it("no cookie + Upgrade is 401 and does not wake a DO", async () => {
    const { env, sessions, catalog, item, names } = await memberEnv();
    const res = await handleRoom(
      new Request(`${ORIGIN}/api/rooms/${item.id}`, {
        headers: { Upgrade: "websocket" },
      }),
      env,
      sessions,
      catalog,
    );
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: "unauthorized" });
    assert.deepEqual(names, []);
  });

  it("valid cookie, unknown item is 404 and does not wake a DO", async () => {
    const { env, sessions, catalog, cookie, names } = await memberEnv();
    const res = await handleRoom(
      new Request(`${ORIGIN}/api/rooms/wi-missing`, {
        headers: upgradeHeaders(cookie),
      }),
      env,
      sessions,
      catalog,
    );
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: "not_found" });
    assert.deepEqual(names, []);
  });

  it("valid cookie, item in other workspace is 403 and does not wake a DO", async () => {
    const sessions = memoryStore();
    const { principal, cookie } = await mintCookie(sessions);
    const item: WorkItemRow = {
      ...farmItem(),
      id: "wi-other",
      workspace_id: "ws-other",
    };
    const catalog = memoryCatalog({ item });
    const { Room, names } = fakeRoom();
    const env = { APP_ORIGIN: ORIGIN, Room } as Env;
    const res = await handleRoom(
      new Request(`${ORIGIN}/api/rooms/${item.id}`, {
        headers: upgradeHeaders(cookie),
      }),
      env,
      sessions,
      catalog,
    );
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: "forbidden" });
    assert.deepEqual(names, []);
    assert.equal(principal.id.length > 0, true);
  });

  it("valid member, no Upgrade header is 400 and does not wake a DO", async () => {
    const { env, sessions, catalog, cookie, item, names } = await memberEnv();
    const res = await handleRoom(
      new Request(`${ORIGIN}/api/rooms/${item.id}`, {
        headers: { cookie },
      }),
      env,
      sessions,
      catalog,
    );
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: "bad_request" });
    assert.deepEqual(names, []);
  });

  it("valid member, last_seq=nope is 400 and does not wake a DO", async () => {
    const { env, sessions, catalog, cookie, item, names } = await memberEnv();
    const res = await handleRoom(
      new Request(`${ORIGIN}/api/rooms/${item.id}?last_seq=nope`, {
        headers: upgradeHeaders(cookie),
      }),
      env,
      sessions,
      catalog,
    );
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: "bad_request" });
    assert.deepEqual(names, []);
  });

  it("valid member + Upgrade is 101, names[0] === item.id, header equals principal id", async () => {
    const {
      env,
      sessions,
      catalog,
      cookie,
      principal,
      item,
      names,
      principals,
    } = await memberEnv();
    const res = await handleRoom(
      new Request(`${ORIGIN}/api/rooms/${item.id}`, {
        headers: upgradeHeaders(cookie),
      }),
      env,
      sessions,
      catalog,
    );
    assert.equal(res.status, 101);
    assert.equal(await res.text(), "upgraded");
    assert.equal(names[0], item.id);
    assert.equal(principals[0], principal.id);
  });
});
