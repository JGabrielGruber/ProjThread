import { defineStore } from "pinia";
import { ref } from "vue";

export type WikiListNode = {
  id: string;
  workspace_id: string;
  type: string;
  payload_kind: string;
  title: string;
  summary: string | null;
  created_at: string;
  updated_at: string;
};

export type WikiNode = WikiListNode & {
  organization_id: string;
  content: string | null;
};

export type WikiStatus = "loading" | "ready" | "error" | "no_session";

export type WikiCreate = {
  title: string;
  content?: string;
  type?: string;
  work_item_id?: string;
};

export const useWikiStore = defineStore("wiki", () => {
  const workspaceId = ref<string | null>(null);
  const nodes = ref<WikiListNode[]>([]);
  const node = ref<WikiNode | null>(null);
  const workItemIds = ref<string[]>([]);
  const status = ref<WikiStatus>("ready");
  const error = ref<string | null>(null);
  const loading = ref(false);

  function toListRow(row: WikiNode): WikiListNode {
    return {
      id: row.id,
      workspace_id: row.workspace_id,
      type: row.type,
      payload_kind: row.payload_kind,
      title: row.title,
      summary: row.summary,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  async function loadList(nextWorkspaceId: string): Promise<void> {
    if (loading.value) return;
    loading.value = true;
    status.value = "loading";
    error.value = null;
    workspaceId.value = nextWorkspaceId;
    try {
      const res = await fetch(`/api/workspaces/${nextWorkspaceId}/nodes`, {
        credentials: "include",
      });
      if (res.status === 401) {
        status.value = "no_session";
        return;
      }
      if (!res.ok) {
        status.value = "error";
        error.value = "error";
        return;
      }
      const body = (await res.json()) as { nodes: WikiListNode[] };
      nodes.value = body.nodes;
      status.value = "ready";
    } catch {
      status.value = "error";
      error.value = "error";
    } finally {
      loading.value = false;
    }
  }

  async function openNode(id: string): Promise<void> {
    status.value = "loading";
    error.value = null;
    try {
      const res = await fetch(`/api/nodes/${id}`, { credentials: "include" });
      if (res.status === 401) {
        status.value = "no_session";
        return;
      }
      if (!res.ok) {
        status.value = "error";
        error.value = "error";
        return;
      }
      const body = (await res.json()) as {
        node: WikiNode;
        work_item_ids: string[];
      };
      node.value = body.node;
      workItemIds.value = body.work_item_ids;
      status.value = "ready";
    } catch {
      status.value = "error";
      error.value = "error";
    }
  }

  async function createNode(input: WikiCreate): Promise<void> {
    const ws = workspaceId.value;
    if (!ws) return;
    const payload: Record<string, string> = { title: input.title };
    if (input.content !== undefined) payload.content = input.content;
    if (input.type !== undefined) payload.type = input.type;
    if (input.work_item_id !== undefined) payload.work_item_id = input.work_item_id;
    const res = await fetch(`/api/workspaces/${ws}/nodes`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      status.value = "error";
      error.value = "error";
      return;
    }
    const body = (await res.json()) as {
      node: WikiNode;
      work_item_ids: string[];
    };
    node.value = body.node;
    workItemIds.value = body.work_item_ids;
    nodes.value = [toListRow(body.node), ...nodes.value];
    status.value = "ready";
  }

  async function saveNode(): Promise<void> {
    const current = node.value;
    if (!current) return;
    const res = await fetch(`/api/nodes/${current.id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: current.title,
        type: current.type,
        content: current.content,
      }),
    });
    if (!res.ok) {
      status.value = "error";
      error.value = "error";
      return;
    }
    const body = (await res.json()) as {
      node: WikiNode;
      work_item_ids: string[];
    };
    node.value = body.node;
    workItemIds.value = body.work_item_ids;
    nodes.value = nodes.value.map((row) =>
      row.id === body.node.id ? toListRow(body.node) : row,
    );
    status.value = "ready";
  }

  async function linkWorkItem(workItemId: string): Promise<void> {
    const current = node.value;
    if (!current) return;
    const res = await fetch(`/api/nodes/${current.id}/work-items`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ work_item_id: workItemId }),
    });
    if (!res.ok) {
      status.value = "error";
      error.value = "error";
      return;
    }
    const body = (await res.json()) as {
      node: WikiNode;
      work_item_ids: string[];
    };
    node.value = body.node;
    workItemIds.value = body.work_item_ids;
    status.value = "ready";
  }

  return {
    workspaceId,
    nodes,
    node,
    workItemIds,
    status,
    error,
    loading,
    loadList,
    openNode,
    createNode,
    saveNode,
    linkWorkItem,
  };
});
