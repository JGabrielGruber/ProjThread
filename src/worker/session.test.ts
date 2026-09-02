import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { newId } from "../lib/id.ts";
import {
  mintSession,
  resolveSession,
  revokeSession,
  type Principal,
  type SessionRow,
  type SessionStore,
} from "./session.ts";

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

async function seedHuman(store: SessionStore): Promise<Principal> {
  const principal: Principal = {
    id: newId(),
    type: "human",
    display_name: "José",
  };
  await store.insertPrincipal({
    ...principal,
    created_at: new Date("2026-01-01T00:00:00.000Z").toISOString(),
  });
  return principal;
}

describe("mintSession", () => {
  it("throws if principal missing", async () => {
    const store = memoryStore();
    await assert.rejects(() => mintSession(store, newId()), /principal/i);
  });

  it("inserts a row with expires_at 30 days from now", async () => {
    const store = memoryStore();
    const principal = await seedHuman(store);
    const now = () => new Date("2026-01-15T12:00:00.000Z");
    const sessionId = newId();

    const row = await mintSession(store, principal.id, {
      now,
      newId: () => sessionId,
    });

    assert.equal(row.id, sessionId);
    assert.equal(row.principal_id, principal.id);
    assert.equal(row.minted_by, principal.id);
    assert.equal(row.created_at, "2026-01-15T12:00:00.000Z");
    assert.equal(row.expires_at, "2026-02-14T12:00:00.000Z");
    assert.equal(row.revoked_at, null);
    assert.deepEqual(await store.getSession(sessionId), row);
  });
});

describe("resolveSession", () => {
  it("returns the principal for a live row", async () => {
    const store = memoryStore();
    const principal = await seedHuman(store);
    const now = () => new Date("2026-01-15T12:00:00.000Z");
    const row = await mintSession(store, principal.id, { now });

    const resolved = await resolveSession(store, row.id, { now });
    assert.deepEqual(resolved, principal);
  });

  it("returns null if expired, revoked, or missing", async () => {
    const store = memoryStore();
    const principal = await seedHuman(store);
    const mintedAt = () => new Date("2026-01-15T12:00:00.000Z");
    const live = await mintSession(store, principal.id, { now: mintedAt });

    const afterExpiry = () => new Date("2026-02-14T12:00:00.000Z");
    assert.equal(await resolveSession(store, live.id, { now: afterExpiry }), null);

    const stillLive = await mintSession(store, principal.id, { now: mintedAt });
    await store.revokeSession(stillLive.id, mintedAt().toISOString());
    assert.equal(
      await resolveSession(store, stillLive.id, { now: mintedAt }),
      null,
    );

    assert.equal(await resolveSession(store, newId(), { now: mintedAt }), null);
    assert.equal(await resolveSession(store, "", { now: mintedAt }), null);
  });
});

describe("revokeSession", () => {
  it("sets revoked_at; later resolve is null", async () => {
    const store = memoryStore();
    const principal = await seedHuman(store);
    const now = () => new Date("2026-01-15T12:00:00.000Z");
    const row = await mintSession(store, principal.id, { now });

    const revokedAt = () => new Date("2026-01-16T00:00:00.000Z");
    await revokeSession(store, row.id, { now: revokedAt });

    const stored = await store.getSession(row.id);
    assert.equal(stored?.revoked_at, "2026-01-16T00:00:00.000Z");
    assert.equal(await resolveSession(store, row.id, { now: revokedAt }), null);
  });
});
