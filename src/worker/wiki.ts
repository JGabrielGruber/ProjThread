import type { IncludeEdge } from "../lib/node-rel.ts";
import type { D1Database } from "./env.ts";

export type NodeType = "note" | "decision" | "process" | "research";
export type PayloadKind = "markdown" | "json" | "blob";

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
  pinned: number;
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
  pinned: number;
};

export type NodePatch = {
  type?: NodeType;
  title?: string;
  summary?: string | null;
  content?: string | null;
  pinned?: number;
  updated_at: string;
};

export type RelKind = "includes" | "ref";
export type IncludeRow = { id: string; title: string; position: number };
export type RefRow = { id: string; title: string };

export type WikiStore = {
  listNodes(workspaceId: string, projectIds?: string[]): Promise<NodeListRow[]>;
  listNodeProjectIds(nodeId: string): Promise<string[]>;
  getNode(id: string): Promise<NodeRow | null>;
  insertNode(row: NodeRow): Promise<void>;
  updateNode(id: string, patch: NodePatch): Promise<boolean>;
  listNodeWorkItemIds(nodeId: string): Promise<string[]>;
  linkNodeWorkItem(
    nodeId: string,
    workItemId: string,
  ): Promise<"inserted" | "exists">;
  listNodesForWorkItem(
    workItemId: string,
  ): Promise<{ id: string; title: string; type: NodeType; summary: string | null }[]>;
  listIncludes(fromId: string): Promise<IncludeRow[]>;
  listRefs(fromId: string): Promise<RefRow[]>;
  listIncludeEdges(workspaceId: string): Promise<IncludeEdge[]>;
  includeNode(
    fromId: string,
    toId: string,
    position: number,
  ): Promise<"inserted" | "exists">;
  refNode(fromId: string, toId: string): Promise<"inserted" | "exists">;
};

const NODE_LIST_SELECT = `SELECT id, workspace_id, organization_id, type, payload_kind, title, summary, created_at, updated_at, pinned
FROM node`;

const NODE_SELECT = `SELECT id, workspace_id, organization_id, type, payload_kind, title, summary, content, blob_key, mime_type, byte_size, filename, created_at, updated_at, pinned
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
    pinned: row.pinned,
  };
}

function applyPatch(row: NodeRow, patch: NodePatch): NodeRow {
  return {
    ...row,
    ...(patch.type !== undefined ? { type: patch.type } : {}),
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.summary !== undefined ? { summary: patch.summary } : {}),
    ...(patch.content !== undefined ? { content: patch.content } : {}),
    ...(patch.pinned !== undefined ? { pinned: patch.pinned } : {}),
    updated_at: patch.updated_at,
  };
}

export function d1WikiStore(db: D1Database): WikiStore {
  return {
    async listNodes(workspaceId, projectIds) {
      if (!projectIds?.length) {
        const { results } = await db
          .prepare(
            `${NODE_LIST_SELECT} WHERE workspace_id = ? ORDER BY updated_at DESC, id DESC`,
          )
          .bind(workspaceId)
          .all<NodeListRow>();
        return results;
      }
      const placeholders = projectIds.map(() => "?").join(", ");
      const { results } = await db
        .prepare(
          `${NODE_LIST_SELECT}
WHERE workspace_id = ?
AND (
  EXISTS (
    SELECT 1 FROM node_project np
    WHERE np.node_id = node.id AND np.project_id IN (${placeholders})
  )
  OR EXISTS (
    SELECT 1 FROM node_work_item nwi
    INNER JOIN work_item wi ON wi.id = nwi.work_item_id
    WHERE nwi.node_id = node.id AND wi.project_id IN (${placeholders})
  )
)
ORDER BY updated_at DESC, id DESC`,
        )
        .bind(workspaceId, ...projectIds, ...projectIds)
        .all<NodeListRow>();
      return results;
    },
    async listNodeProjectIds(nodeId) {
      const { results } = await db
        .prepare(
          "SELECT project_id FROM node_project WHERE node_id = ? ORDER BY project_id",
        )
        .bind(nodeId)
        .all<{ project_id: string }>();
      return results.map((r) => r.project_id);
    },
    async getNode(id) {
      return db.prepare(`${NODE_SELECT} WHERE id = ?`).bind(id).first<NodeRow>();
    },
    async insertNode(row) {
      await db
        .prepare(
          `INSERT INTO node (id, workspace_id, organization_id, type, payload_kind, title, summary, content, blob_key, mime_type, byte_size, filename, created_at, updated_at, pinned)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          row.pinned,
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
      if (patch.pinned !== undefined) {
        sets.push("pinned = ?");
        values.push(patch.pinned);
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
    async listNodesForWorkItem(workItemId) {
      const { results } = await db
        .prepare(
          `SELECT n.id, n.title, n.type, n.summary
FROM node_work_item l
JOIN node n ON n.id = l.node_id
WHERE l.work_item_id = ?
ORDER BY n.title, n.id`,
        )
        .bind(workItemId)
        .all<{
          id: string;
          title: string;
          type: NodeType;
          summary: string | null;
        }>();
      return results;
    },
    async listIncludes(fromId) {
      const { results } = await db
        .prepare(
          `SELECT n.id, n.title, r.position
FROM node_rel r
JOIN node n ON n.id = r.to_id
WHERE r.from_id = ? AND r.kind = 'includes'
ORDER BY r.position, r.to_id`,
        )
        .bind(fromId)
        .all<IncludeRow>();
      return results;
    },
    async listRefs(fromId) {
      const { results } = await db
        .prepare(
          `SELECT n.id, n.title
FROM node_rel r
JOIN node n ON n.id = r.to_id
WHERE r.from_id = ? AND r.kind = 'ref'
ORDER BY n.title, n.id`,
        )
        .bind(fromId)
        .all<RefRow>();
      return results;
    },
    async listIncludeEdges(workspaceId) {
      const { results } = await db
        .prepare(
          `SELECT r.from_id, r.to_id
FROM node_rel r
JOIN node f ON f.id = r.from_id
JOIN node t ON t.id = r.to_id
WHERE r.kind = 'includes' AND f.workspace_id = ? AND t.workspace_id = ?`,
        )
        .bind(workspaceId, workspaceId)
        .all<IncludeEdge>();
      return results;
    },
    async includeNode(fromId, toId, position) {
      const existing = await db
        .prepare(
          `SELECT to_id FROM node_rel
WHERE from_id = ? AND to_id = ? AND kind = 'includes'`,
        )
        .bind(fromId, toId)
        .first<{ to_id: string }>();
      await db
        .prepare(
          `INSERT OR REPLACE INTO node_rel (from_id, to_id, kind, position)
VALUES (?, ?, 'includes', ?)`,
        )
        .bind(fromId, toId, position)
        .run();
      return existing != null ? "exists" : "inserted";
    },
    async refNode(fromId, toId) {
      const row = await db
        .prepare(
          `INSERT OR IGNORE INTO node_rel (from_id, to_id, kind, position)
VALUES (?, ?, 'ref', NULL) RETURNING to_id`,
        )
        .bind(fromId, toId)
        .first<{ to_id: string }>();
      return row != null ? "inserted" : "exists";
    },
  };
}

export function memoryWikiStore(): WikiStore {
  const nodes = new Map<string, NodeRow>();
  const links = new Map<string, { node_id: string; work_item_id: string }>();
  const nodeProjects = new Map<string, { node_id: string; project_id: string }>();
  const rels = new Map<
    string,
    { from_id: string; to_id: string; kind: RelKind; position: number | null }
  >();

  function linkKey(nodeId: string, workItemId: string): string {
    return `${nodeId}:${workItemId}`;
  }

  function relKey(fromId: string, toId: string, kind: RelKind): string {
    return `${fromId}:${toId}:${kind}`;
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
    async listNodeProjectIds(nodeId) {
      return [...nodeProjects.values()]
        .filter((row) => row.node_id === nodeId)
        .map((row) => row.project_id)
        .sort();
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
    async listNodesForWorkItem(workItemId) {
      return [...links.values()]
        .filter((row) => row.work_item_id === workItemId)
        .map((row) => {
          const node = nodes.get(row.node_id);
          return {
            id: row.node_id,
            title: node?.title ?? "",
            type: node?.type ?? "note",
            summary: node?.summary ?? null,
          };
        })
        .sort((a, b) => {
          if (a.title < b.title) return -1;
          if (a.title > b.title) return 1;
          if (a.id < b.id) return -1;
          if (a.id > b.id) return 1;
          return 0;
        });
    },
    async listIncludes(fromId) {
      return [...rels.values()]
        .filter((row) => row.from_id === fromId && row.kind === "includes")
        .map((row) => {
          const node = nodes.get(row.to_id);
          return {
            id: row.to_id,
            title: node?.title ?? "",
            position: row.position ?? 0,
          };
        })
        .sort((a, b) => {
          if (a.position !== b.position) return a.position - b.position;
          return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
        });
    },
    async listRefs(fromId) {
      return [...rels.values()]
        .filter((row) => row.from_id === fromId && row.kind === "ref")
        .map((row) => {
          const node = nodes.get(row.to_id);
          return { id: row.to_id, title: node?.title ?? "" };
        })
        .sort((a, b) => {
          if (a.title !== b.title) return a.title < b.title ? -1 : 1;
          return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
        });
    },
    async listIncludeEdges(workspaceId) {
      return [...rels.values()]
        .filter((row) => row.kind === "includes")
        .filter((row) => {
          const from = nodes.get(row.from_id);
          const to = nodes.get(row.to_id);
          return (
            from?.workspace_id === workspaceId &&
            to?.workspace_id === workspaceId
          );
        })
        .map((row) => ({ from_id: row.from_id, to_id: row.to_id }));
    },
    async includeNode(fromId, toId, position) {
      const key = relKey(fromId, toId, "includes");
      const existed = rels.has(key);
      rels.set(key, {
        from_id: fromId,
        to_id: toId,
        kind: "includes",
        position,
      });
      return existed ? "exists" : "inserted";
    },
    async refNode(fromId, toId) {
      const key = relKey(fromId, toId, "ref");
      if (rels.has(key)) return "exists";
      rels.set(key, {
        from_id: fromId,
        to_id: toId,
        kind: "ref",
        position: null,
      });
      return "inserted";
    },
  };
}
