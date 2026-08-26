import { newId as generateId } from "../lib/id.ts";
import type { D1Database } from "./env.ts";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_TTL_DAYS = 30;

export type Principal = {
  id: string;
  type: "human" | "agent" | "service";
  display_name: string;
};

export type SessionRow = {
  id: string;
  principal_id: string;
  minted_by: string;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
};

export type SessionStore = {
  getPrincipal(id: string): Promise<Principal | null>;
  insertPrincipal(p: Principal & { created_at: string }): Promise<void>;
  listPrincipals(): Promise<Principal[]>;
  insertSession(row: SessionRow): Promise<void>;
  getSession(id: string): Promise<SessionRow | null>;
  revokeSession(id: string, at: string): Promise<void>;
};

export async function mintSession(
  store: SessionStore,
  principalId: string,
  opts: {
    now?: () => Date;
    mintedBy?: string;
    ttlDays?: number;
    newId?: () => string;
  } = {},
): Promise<SessionRow> {
  const principal = await store.getPrincipal(principalId);
  if (!principal) throw new Error("principal not found");

  const now = (opts.now ?? (() => new Date()))();
  const ttlDays = opts.ttlDays ?? DEFAULT_TTL_DAYS;
  const createdAt = now.toISOString();
  const row: SessionRow = {
    id: (opts.newId ?? generateId)(),
    principal_id: principalId,
    minted_by: opts.mintedBy ?? principalId,
    expires_at: new Date(now.getTime() + ttlDays * MS_PER_DAY).toISOString(),
    revoked_at: null,
    created_at: createdAt,
  };
  await store.insertSession(row);
  return row;
}

export async function resolveSession(
  store: SessionStore,
  sessionId: string,
  opts: { now?: () => Date } = {},
): Promise<Principal | null> {
  if (!sessionId) return null;

  const row = await store.getSession(sessionId);
  if (!row) return null;
  if (row.revoked_at != null) return null;

  const now = (opts.now ?? (() => new Date()))();
  if (row.expires_at <= now.toISOString()) return null;

  return store.getPrincipal(row.principal_id);
}

export async function revokeSession(
  store: SessionStore,
  sessionId: string,
  opts: { now?: () => Date } = {},
): Promise<void> {
  const now = (opts.now ?? (() => new Date()))();
  await store.revokeSession(sessionId, now.toISOString());
}

export function d1SessionStore(db: D1Database): SessionStore {
  return {
    async getPrincipal(id) {
      return db
        .prepare("SELECT id, type, display_name FROM principal WHERE id = ?")
        .bind(id)
        .first<Principal>();
    },
    async insertPrincipal(p) {
      await db
        .prepare(
          "INSERT INTO principal (id, type, display_name, created_at) VALUES (?, ?, ?, ?)",
        )
        .bind(p.id, p.type, p.display_name, p.created_at)
        .run();
    },
    async listPrincipals() {
      const { results } = await db
        .prepare(
          "SELECT id, type, display_name FROM principal ORDER BY created_at",
        )
        .all<Principal>();
      return results;
    },
    async insertSession(row) {
      await db
        .prepare(
          "INSERT INTO session (id, principal_id, minted_by, expires_at, revoked_at, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(
          row.id,
          row.principal_id,
          row.minted_by,
          row.expires_at,
          row.revoked_at,
          row.created_at,
        )
        .run();
    },
    async getSession(id) {
      return db
        .prepare(
          "SELECT id, principal_id, minted_by, expires_at, revoked_at, created_at FROM session WHERE id = ?",
        )
        .bind(id)
        .first<SessionRow>();
    },
    async revokeSession(id, at) {
      await db
        .prepare("UPDATE session SET revoked_at = ? WHERE id = ?")
        .bind(at, id)
        .run();
    },
  };
}
