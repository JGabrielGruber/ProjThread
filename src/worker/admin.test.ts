import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { handleAdmin } from "./admin.ts";
import type { Env } from "./env.ts";
import {
  type Principal,
  type SessionRow,
  type SessionStore,
} from "./session.ts";
import { COOKIE_NAME } from "../lib/cookies.ts";

const ORIGIN = "http://127.0.0.1:8787";
const env = { APP_ORIGIN: ORIGIN } as Env;

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
    );
    const { session } = (await minted.json()) as { session: SessionRow };

    const revoked = await handleAdmin(
      adminRequest(`/api/admin/sessions/${session.id}/revoke`, {
        method: "POST",
        headers: { cookie: `${COOKIE_NAME}=${session.id}` },
      }),
      env,
      store,
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
    );
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: "not_found" });
  });
});
