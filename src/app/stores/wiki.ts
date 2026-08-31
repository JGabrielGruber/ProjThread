import { defineStore } from "pinia";
import { ref } from "vue";
import type {
  WikiCreate,
  WikiListNode,
  WikiNode,
  WikiStatus,
} from "../models/wiki.ts";
import { ApiError } from "../services/http.ts";
import {
  createNode as createNodeRequest,
  getNode,
  linkWorkItem as linkWorkItemRequest,
  listNodes,
  patchNode,
} from "../services/wiki.ts";

export type {
  WikiCreate,
  WikiListNode,
  WikiNode,
  WikiStatus,
} from "../models/wiki.ts";

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
      pinned: row.pinned,
    };
  }

  function fail(err: unknown): void {
    if (err instanceof ApiError && err.status === 401) {
      status.value = "no_session";
      return;
    }
    status.value = "error";
    error.value = "error";
  }

  async function loadList(nextWorkspaceId: string): Promise<void> {
    if (loading.value) return;
    loading.value = true;
    status.value = "loading";
    error.value = null;
    workspaceId.value = nextWorkspaceId;
    try {
      const body = await listNodes(nextWorkspaceId);
      nodes.value = body.nodes;
      status.value = "ready";
    } catch (err) {
      fail(err);
    } finally {
      loading.value = false;
    }
  }

  async function openNode(id: string): Promise<void> {
    status.value = "loading";
    error.value = null;
    try {
      const body = await getNode(id);
      node.value = body.node;
      workItemIds.value = body.work_item_ids;
      status.value = "ready";
    } catch (err) {
      fail(err);
    }
  }

  async function createNode(input: WikiCreate): Promise<void> {
    const ws = workspaceId.value;
    if (!ws) return;
    try {
      const body = await createNodeRequest(ws, input);
      node.value = body.node;
      workItemIds.value = body.work_item_ids;
      nodes.value = [toListRow(body.node), ...nodes.value];
      status.value = "ready";
    } catch (err) {
      fail(err);
    }
  }

  async function saveNode(): Promise<void> {
    const current = node.value;
    if (!current) return;
    try {
      const body = await patchNode(current.id, {
        title: current.title,
        type: current.type,
        content: current.content,
      });
      node.value = body.node;
      workItemIds.value = body.work_item_ids;
      nodes.value = nodes.value.map((row) =>
        row.id === body.node.id ? toListRow(body.node) : row,
      );
      status.value = "ready";
    } catch (err) {
      fail(err);
    }
  }

  async function linkWorkItem(workItemId: string): Promise<void> {
    const current = node.value;
    if (!current) return;
    try {
      const body = await linkWorkItemRequest(current.id, workItemId);
      node.value = body.node;
      workItemIds.value = body.work_item_ids;
      status.value = "ready";
    } catch (err) {
      fail(err);
    }
  }

  async function setPinned(id: string, pinned: boolean): Promise<void> {
    try {
      const body = await patchNode(id, { pinned });
      nodes.value = nodes.value.map((row) =>
        row.id === body.node.id ? toListRow(body.node) : row,
      );
      if (node.value?.id === body.node.id) {
        node.value = body.node;
        workItemIds.value = body.work_item_ids;
      }
      status.value = "ready";
    } catch (err) {
      fail(err);
    }
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
    setPinned,
  };
});
