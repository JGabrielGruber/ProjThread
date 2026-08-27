import type { D1Database } from "./env.ts";

export type NodeType = "note" | "decision" | "process" | "research";
export type PayloadKind = "markdown" | "blob";

export type NodeRow = {
  id: string;
  workspace_id: string;
  organization_id: string;
  type: NodeType;
  payload_kind: PayloadKind;
  title: string;
  summary: string | null;
  content: string | null;
  blob_key: string | null;
  mime_type: string | null;
  byte_size: number | null;
  filename: string | null;
  created_at: string;
  updated_at: string;
};

export type NodeListRow = {
  id: string;
  workspace_id: string;
  organization_id: string;
  type: NodeType;
  payload_kind: PayloadKind;
  title: string;
  summary: string | null;
  created_at: string;
  updated_at: string;
};

export type NodePatch = {
  type?: NodeType;
  title?: string;
  summary?: string | null;
  content?: string | null;
  updated_at: string;
};

export type WikiStore = {
  listNodes(workspaceId: string): Promise<NodeListRow[]>;
  getNode(id: string): Promise<NodeRow | null>;
  insertNode(row: NodeRow): Promise<void>;
  updateNode(id: string, patch: NodePatch): Promise<boolean>;
  listNodeWorkItemIds(nodeId: string): Promise<string[]>;
  linkNodeWorkItem(
    nodeId: string,
    workItemId: string,
  ): Promise<"inserted" | "exists">;
};

const NODE_LIST_SELECT = `SELECT id, workspace_id, organization_id, type, payload_kind, title, summary, created_at, updated_at
FROM node`;

const NODE_SELECT = `SELECT id, workspace_id, organization_id, type, payload_kind, title, summary, content, blob_key, mime_type, byte_size, filename, created_at, updated_at
FROM node`;

function toListRow(row: NodeRow): NodeListRow {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    organization_id: row.organization_id,
    type: row.type,
    payload_kind: row.payload_kind,
    title: row.title,
    summary: row.summary,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function applyPatch(row: NodeRow, patch: NodePatch): NodeRow {
  return {
    ...row,
    ...(patch.type !== undefined ? { type: patch.type } : {}),
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.summary !== undefined ? { summary: patch.summary } : {}),
    ...(patch.content !== undefined ? { content: patch.content } : {}),
    updated_at: patch.updated_at,
  };
}

export function d1WikiStore(db: D1Database): WikiStore {
  return {
    async listNodes(workspaceId) {
      const { results } = await db
        .prepare(
          `${NODE_LIST_SELECT} WHERE workspace_id = ? ORDER BY updated_at DESC, id DESC`,
        )
        .bind(workspaceId)
        .all<NodeListRow>();
      return results;
    },
    async getNode(id) {
      return db.prepare(`${NODE_SELECT} WHERE id = ?`).bind(id).first<NodeRow>();
    },
    async insertNode(row) {
      await db
        .prepare(
          `INSERT INTO node (id, workspace_id, organization_id, type, payload_kind, title, summary, content, blob_key, mime_type, byte_size, filename, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          row.id,
          row.workspace_id,
          row.organization_id,
          row.type,
          row.payload_kind,
          row.title,
          row.summary,
          row.content,
          row.blob_key,
          row.mime_type,
          row.byte_size,
          row.filename,
          row.created_at,
          row.updated_at,
        )
        .run();
    },
    async updateNode(id, patch) {
      const sets: string[] = [];
      const values: unknown[] = [];
      if (patch.type !== undefined) {
        sets.push("type = ?");
        values.push(patch.type);
      }
      if (patch.title !== undefined) {
        sets.push("title = ?");
        values.push(patch.title);
      }
      if (patch.summary !== undefined) {
        sets.push("summary = ?");
        values.push(patch.summary);
      }
      if (patch.content !== undefined) {
        sets.push("content = ?");
        values.push(patch.content);
      }
      sets.push("updated_at = ?");
      values.push(patch.updated_at);
      const row = await db
        .prepare(
          `UPDATE node SET ${sets.join(", ")} WHERE id = ? RETURNING id`,
        )
        .bind(...values, id)
        .first<{ id: string }>();
      return row != null;
    },
    async listNodeWorkItemIds(nodeId) {
      const { results } = await db
        .prepare(
          "SELECT work_item_id FROM node_work_item WHERE node_id = ? ORDER BY work_item_id",
        )
        .bind(nodeId)
        .all<{ work_item_id: string }>();
      return results.map((r) => r.work_item_id);
    },
    async linkNodeWorkItem(nodeId, workItemId) {
      const row = await db
        .prepare(
          "INSERT OR IGNORE INTO node_work_item (node_id, work_item_id) VALUES (?, ?) RETURNING node_id",
        )
        .bind(nodeId, workItemId)
        .first<{ node_id: string }>();
      return row != null ? "inserted" : "exists";
    },
  };
}

export function memoryWikiStore(): WikiStore {
  const nodes = new Map<string, NodeRow>();
  const links = new Map<string, { node_id: string; work_item_id: string }>();

  function linkKey(nodeId: string, workItemId: string): string {
    return `${nodeId}:${workItemId}`;
  }

  return {
    async listNodes(workspaceId) {
      return [...nodes.values()]
        .filter((row) => row.workspace_id === workspaceId)
        .sort((a, b) => {
          if (a.updated_at > b.updated_at) return -1;
          if (a.updated_at < b.updated_at) return 1;
          if (a.id > b.id) return -1;
          if (a.id < b.id) return 1;
          return 0;
        })
        .map(toListRow);
    },
    async getNode(id) {
      const row = nodes.get(id);
      return row ? { ...row } : null;
    },
    async insertNode(row) {
      nodes.set(row.id, { ...row });
    },
    async updateNode(id, patch) {
      const row = nodes.get(id);
      if (!row) return false;
      nodes.set(id, applyPatch(row, patch));
      return true;
    },
    async listNodeWorkItemIds(nodeId) {
      return [...links.values()]
        .filter((row) => row.node_id === nodeId)
        .map((row) => row.work_item_id)
        .sort();
    },
    async linkNodeWorkItem(nodeId, workItemId) {
      const key = linkKey(nodeId, workItemId);
      if (links.has(key)) return "exists";
      links.set(key, { node_id: nodeId, work_item_id: workItemId });
      return "inserted";
    },
  };
}
