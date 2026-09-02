import type {
  WikiCreate,
  WikiListNode,
  WikiNode,
} from "../models/wiki.ts";
import { apiJson } from "./http.ts";

export type WikiRel = { id: string; title: string; position?: number };

type NodePayload = {
  node: WikiNode;
  work_item_ids: string[];
  includes?: WikiRel[];
  refs?: WikiRel[];
};

export function listNodes(
  workspaceId: string,
  projectId?: string | null,
): Promise<{ nodes: WikiListNode[] }> {
  const query = projectId
    ? `?project_id=${encodeURIComponent(projectId)}`
    : "";
  return apiJson(`/api/workspaces/${workspaceId}/nodes${query}`);
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

export function includeNode(
  nodeId: string,
  childId: string,
): Promise<NodePayload> {
  return apiJson(`/api/nodes/${nodeId}/includes`, {
    method: "POST",
    body: JSON.stringify({ child_id: childId }),
  });
}

export function refNode(nodeId: string, toId: string): Promise<NodePayload> {
  return apiJson(`/api/nodes/${nodeId}/refs`, {
    method: "POST",
    body: JSON.stringify({ to_id: toId }),
  });
}

export function listWorkItemNodes(
  workItemId: string,
): Promise<{ nodes: { id: string; title: string; type: string; summary: string | null }[] }> {
  return apiJson(`/api/work-items/${workItemId}/nodes`);
}

export function attachWorkItemNode(
  workItemId: string,
  nodeId: string,
): Promise<{ nodes: { id: string; title: string; type: string; summary: string | null }[] }> {
  return apiJson(`/api/work-items/${workItemId}/nodes`, {
    method: "POST",
    body: JSON.stringify({ node_id: nodeId }),
  });
}
