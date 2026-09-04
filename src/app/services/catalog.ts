import type { Project, Stage, WorkItem } from "../models/board.ts";
import type {
  ConfigMember,
  ConfigProject,
  ConfigStage,
  ConfigSubscription,
} from "../models/config.ts";
import { apiJson } from "./http.ts";

export function listProjects(
  workspaceId: string,
): Promise<{ projects: Project[] }> {
  return apiJson(`/api/workspaces/${workspaceId}/projects`);
}

export function listStages(
  workspaceId: string,
): Promise<{ stages: Stage[] }> {
  return apiJson(`/api/workspaces/${workspaceId}/stages`);
}

export function listWorkItems(
  workspaceId: string,
  projectId: string,
): Promise<{ work_items: WorkItem[] }> {
  return apiJson(
    `/api/workspaces/${workspaceId}/work-items?project_id=${projectId}`,
  );
}

export function createWorkItem(
  workspaceId: string,
  body: { title: string; project_id: string },
): Promise<WorkItem> {
  return apiJson(`/api/workspaces/${workspaceId}/work-items`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function postWorkItemEvent(
  itemId: string,
  body: Record<string, unknown>,
): Promise<{ work_item: WorkItem }> {
  return apiJson(`/api/work-items/${itemId}/events`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function listMembers(
  workspaceId: string,
): Promise<{ members: ConfigMember[] }> {
  return apiJson(`/api/workspaces/${workspaceId}/members`);
}

export function addMember(
  workspaceId: string,
  body: { principal_id: string; role?: "owner" | "member" },
): Promise<{ member: ConfigMember }> {
  return apiJson(`/api/workspaces/${workspaceId}/members`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function createProject(
  workspaceId: string,
  body: { name: string; parent_id: string | null },
): Promise<{ project: ConfigProject }> {
  return apiJson(`/api/workspaces/${workspaceId}/projects`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function patchProject(
  id: string,
  body: { name?: string; parent_id?: string | null },
): Promise<{ project: ConfigProject }> {
  return apiJson(`/api/projects/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function patchMember(
  workspaceId: string,
  principalId: string,
  role: "owner" | "member",
): Promise<{ member: ConfigMember }> {
  return apiJson(`/api/workspaces/${workspaceId}/members/${principalId}`, {
    method: "PATCH",
    body: JSON.stringify({ role }),
  });
}

export function deleteMember(
  workspaceId: string,
  principalId: string,
): Promise<void> {
  return apiJson(`/api/workspaces/${workspaceId}/members/${principalId}`, {
    method: "DELETE",
  });
}

export function createOrganization(
  name: string,
): Promise<{
  organization: { id: string; name: string };
  workspace: { id: string; name: string };
  project: { id: string; name: string; parent_id: null };
}> {
  return apiJson("/api/organizations", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function patchStages(
  workspaceId: string,
  stages: ConfigStage[],
): Promise<{ stages: ConfigStage[] }> {
  return apiJson(`/api/workspaces/${workspaceId}/stages`, {
    method: "PATCH",
    body: JSON.stringify({ stages }),
  });
}

export function listNotifySubscriptions(
  workspaceId: string,
): Promise<{ subscriptions: ConfigSubscription[] }> {
  return apiJson(`/api/workspaces/${workspaceId}/notify-subscriptions`);
}

export function addNotifySubscription(
  workspaceId: string,
  body: { url: string; kinds: string[]; enabled?: boolean },
): Promise<{ subscription: ConfigSubscription; secret: string }> {
  return apiJson(`/api/workspaces/${workspaceId}/notify-subscriptions`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function patchNotifySubscription(
  workspaceId: string,
  id: string,
  body: { kinds?: string[]; enabled?: boolean },
): Promise<{ subscription: ConfigSubscription }> {
  return apiJson(`/api/workspaces/${workspaceId}/notify-subscriptions/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function deleteNotifySubscription(
  workspaceId: string,
  id: string,
): Promise<void> {
  return apiJson(`/api/workspaces/${workspaceId}/notify-subscriptions/${id}`, {
    method: "DELETE",
  });
}
