import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { handleAdmin } from "./admin.ts";
import { handleMe } from "./me.ts";
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

async function mintCookie(
  store: SessionStore,
): Promise<{ principal: Principal; cookie: string; session: SessionRow }> {
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
    );
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: "unauthorized" });
  });

  it("returns the principal for a live session cookie", async () => {
    const store = memoryStore();
    const { principal, cookie } = await mintCookie(store);
    const res = await handleMe(
      new Request(`${ORIGIN}/api/me`, { headers: { cookie } }),
      env,
      store,
    );
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { principal });
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
    );
    assert.equal(revoked.status, 204);

    const res = await handleMe(
      new Request(`${ORIGIN}/api/me`, { headers: { cookie } }),
      env,
      store,
    );
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: "unauthorized" });
  });
});
