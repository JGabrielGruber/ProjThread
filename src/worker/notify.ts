import type { NotifyKind } from "../lib/notify-kind.ts";
import { parseKindsJson } from "../lib/notify-kind.ts";
import type { D1Database } from "./env.ts";

export type NotifyMessage = {
  kind: NotifyKind;
  node_id: string;
  workspace_id: string;
};

export type NotifySubscriptionRow = {
  id: string;
  workspace_id: string;
  organization_id: string;
  url: string;
  secret: string;
  kinds: NotifyKind[];
  enabled: number;
  created_at: string;
  created_by: string;
};

export type NotifySubscriptionPublic = Omit<NotifySubscriptionRow, "secret">;

export type NotifyStore = {
  insertSubscription(row: NotifySubscriptionRow): Promise<void>;
  listSubscriptions(workspaceId: string): Promise<NotifySubscriptionPublic[]>;
  getSubscription(id: string): Promise<NotifySubscriptionRow | null>;
  listEnabledMatching(
    workspaceId: string,
    kind: NotifyKind,
  ): Promise<NotifySubscriptionRow[]>;
  hasEnabledKind(workspaceId: string, kind: NotifyKind): Promise<boolean>;
  updateSubscription(
    id: string,
    patch: { kinds?: NotifyKind[]; enabled?: number },
  ): Promise<void>;
  deleteSubscription(id: string): Promise<void>;
};

export type NotifyQueue = {
  send(body: NotifyMessage): Promise<void>;
};

function toPublic(row: NotifySubscriptionRow): NotifySubscriptionPublic {
  const { secret: _secret, ...pub } = row;
  return pub;
}

function matching(rows: NotifySubscriptionRow[], workspaceId: string, kind: NotifyKind) {
  return rows.filter(
    (row) =>
      row.workspace_id === workspaceId &&
      row.enabled === 1 &&
      row.kinds.includes(kind),
  );
}

export async function enqueueIfMatch(
  queue: NotifyQueue | undefined,
  notify: NotifyStore | null,
  kind: NotifyKind,
  node: { id: string; workspace_id: string },
): Promise<void> {
  if (!queue || !notify) return;
  if (!(await notify.hasEnabledKind(node.workspace_id, kind))) return;
  await queue.send({
    kind,
    node_id: node.id,
    workspace_id: node.workspace_id,
  });
}

export function memoryNotifyStore(): NotifyStore {
  const rows = new Map<string, NotifySubscriptionRow>();

  return {
    async insertSubscription(row) {
      rows.set(row.id, {
        ...row,
        kinds: [...row.kinds],
      });
    },
    async listSubscriptions(workspaceId) {
      return [...rows.values()]
        .filter((row) => row.workspace_id === workspaceId)
        .sort((a, b) => a.id.localeCompare(b.id))
        .map(toPublic);
    },
    async getSubscription(id) {
      const row = rows.get(id);
      return row ? { ...row, kinds: [...row.kinds] } : null;
    },
    async listEnabledMatching(workspaceId, kind) {
      return matching([...rows.values()], workspaceId, kind).map((row) => ({
        ...row,
        kinds: [...row.kinds],
      }));
    },
    async hasEnabledKind(workspaceId, kind) {
      return (await this.listEnabledMatching(workspaceId, kind)).length > 0;
    },
    async updateSubscription(id, patch) {
      const row = rows.get(id);
      if (!row) return;
      if (patch.kinds) row.kinds = [...patch.kinds];
      if (patch.enabled !== undefined) row.enabled = patch.enabled;
    },
    async deleteSubscription(id) {
      rows.delete(id);
    },
  };
}

type NotifySqlRow = {
  id: string;
  workspace_id: string;
  organization_id: string;
  url: string;
  secret: string;
  kinds: string;
  enabled: number;
  created_at: string;
  created_by: string;
};

function fromSql(row: NotifySqlRow): NotifySubscriptionRow | null {
  const kinds = parseKindsJson(row.kinds);
  if (!kinds) return null;
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    organization_id: row.organization_id,
    url: row.url,
    secret: row.secret,
    kinds,
    enabled: row.enabled,
    created_at: row.created_at,
    created_by: row.created_by,
  };
}

export function d1NotifyStore(db: D1Database): NotifyStore {
  return {
    async insertSubscription(row) {
      await db
        .prepare(
          `INSERT INTO notify_subscription (
            id, workspace_id, organization_id, url, secret, kinds, enabled, created_at, created_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          row.id,
          row.workspace_id,
          row.organization_id,
          row.url,
          row.secret,
          JSON.stringify(row.kinds),
          row.enabled,
          row.created_at,
          row.created_by,
        )
        .run();
    },
    async listSubscriptions(workspaceId) {
      const { results } = await db
        .prepare(
          `SELECT * FROM notify_subscription WHERE workspace_id = ? ORDER BY id`,
        )
        .bind(workspaceId)
        .all<NotifySqlRow>();
      return results
        .map(fromSql)
        .filter((row): row is NotifySubscriptionRow => row != null)
        .map(toPublic);
    },
    async getSubscription(id) {
      const row = await db
        .prepare(`SELECT * FROM notify_subscription WHERE id = ?`)
        .bind(id)
        .first<NotifySqlRow>();
      return row ? fromSql(row) : null;
    },
    async listEnabledMatching(workspaceId, kind) {
      const { results } = await db
        .prepare(
          `SELECT * FROM notify_subscription WHERE workspace_id = ? AND enabled = 1`,
        )
        .bind(workspaceId)
        .all<NotifySqlRow>();
      return results
        .map(fromSql)
        .filter((row): row is NotifySubscriptionRow => row != null)
        .filter((row) => row.kinds.includes(kind));
    },
    async hasEnabledKind(workspaceId, kind) {
      return (await this.listEnabledMatching(workspaceId, kind)).length > 0;
    },
    async updateSubscription(id, patch) {
      const current = await this.getSubscription(id);
      if (!current) return;
      const kinds = patch.kinds ?? current.kinds;
      const enabled = patch.enabled ?? current.enabled;
      await db
        .prepare(
          `UPDATE notify_subscription SET kinds = ?, enabled = ? WHERE id = ?`,
        )
        .bind(JSON.stringify(kinds), enabled, id)
        .run();
    },
    async deleteSubscription(id) {
      await db
        .prepare(`DELETE FROM notify_subscription WHERE id = ?`)
        .bind(id)
        .run();
    },
  };
}
