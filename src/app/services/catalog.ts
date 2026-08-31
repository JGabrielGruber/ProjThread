import type { Project, Stage, WorkItem } from "../models/board.ts";
import type {
  ConfigMember,
  ConfigProject,
  ConfigStage,
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
  body: { name: string },
): Promise<{ project: ConfigProject }> {
  return apiJson(`/api/projects/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
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
