import type {
  WikiCreate,
  WikiListNode,
  WikiNode,
} from "../models/wiki.ts";
import { apiJson } from "./http.ts";

type NodePayload = {
  node: WikiNode;
  work_item_ids: string[];
};

export function listNodes(
  workspaceId: string,
): Promise<{ nodes: WikiListNode[] }> {
  return apiJson(`/api/workspaces/${workspaceId}/nodes`);
}

export function getNode(id: string): Promise<NodePayload> {
  return apiJson(`/api/nodes/${id}`);
}

export function createNode(
  workspaceId: string,
  input: WikiCreate,
): Promise<NodePayload> {
  const payload: Record<string, string> = { title: input.title };
  if (input.content !== undefined) payload.content = input.content;
  if (input.type !== undefined) payload.type = input.type;
  if (input.work_item_id !== undefined) payload.work_item_id = input.work_item_id;
  return apiJson(`/api/workspaces/${workspaceId}/nodes`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function patchNode(
  id: string,
  body: Record<string, unknown>,
): Promise<NodePayload> {
  return apiJson(`/api/nodes/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function linkWorkItem(
  nodeId: string,
  workItemId: string,
): Promise<NodePayload> {
  return apiJson(`/api/nodes/${nodeId}/work-items`, {
    method: "POST",
    body: JSON.stringify({ work_item_id: workItemId }),
  });
}
