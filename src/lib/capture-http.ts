import type { CaptureApi } from "./capture.ts";

export class CaptureHttpError extends Error {
  readonly status: number;
  constructor(status: number) {
    super("error");
    this.status = status;
  }
}

export type CaptureCreds = { origin: string; token: string };

export type MeBody = {
  principal: { id: string; type: string; display_name: string };
  memberships?: {
    workspace_id: string;
    workspace_name: string;
    role: string;
  }[];
  workspace_id: string | null;
};

export type CaptureClient = CaptureApi & {
  getMe(): Promise<MeBody>;
  patchMe(workspaceId: string): Promise<MeBody>;
  listProjects(workspaceId: string): Promise<{
    projects: { id: string; parent_id: string | null; name: string }[];
  }>;
  createProject(
    workspaceId: string,
    body: { name: string; parent_id: string | null },
  ): Promise<{ project: { id: string; parent_id: string | null; name: string } }>;
  createBlobNode(
    workspaceId: string,
    form: FormData,
  ): Promise<{ node: { id: string } }>;
};

async function apiJson<T>(
  creds: CaptureCreds,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${creds.token}`);
  if (
    init.body != null &&
    !headers.has("content-type") &&
    !(typeof FormData !== "undefined" && init.body instanceof FormData)
  ) {
    headers.set("content-type", "application/json");
  }
  const res = await fetch(`${creds.origin}${path}`, { ...init, headers });
  if (!res.ok) throw new CaptureHttpError(res.status);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function captureApi(creds: CaptureCreds): CaptureClient {
  return {
    getMe: () => apiJson(creds, "/api/me"),
    patchMe: (workspaceId) =>
      apiJson(creds, "/api/me", {
        method: "PATCH",
        body: JSON.stringify({ workspace_id: workspaceId }),
      }),
    listProjects: (workspaceId) =>
      apiJson(creds, `/api/workspaces/${workspaceId}/projects`),
    createProject: (workspaceId, body) =>
      apiJson(creds, `/api/workspaces/${workspaceId}/projects`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    createNode: (workspaceId, body) =>
      apiJson(creds, `/api/workspaces/${workspaceId}/nodes`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    createBlobNode: (workspaceId, form) =>
      apiJson(creds, `/api/workspaces/${workspaceId}/nodes`, {
        method: "POST",
        body: form,
      }),
    includeNode: async (fromId, childId) => {
      await apiJson(creds, `/api/nodes/${fromId}/includes`, {
        method: "POST",
        body: JSON.stringify({ child_id: childId }),
      });
    },
    linkProject: async (nodeId, projectId) => {
      await apiJson(creds, `/api/nodes/${nodeId}/projects`, {
        method: "POST",
        body: JSON.stringify({ project_id: projectId }),
      });
    },
    refNode: async (fromId, toId) => {
      await apiJson(creds, `/api/nodes/${fromId}/refs`, {
        method: "POST",
        body: JSON.stringify({ to_id: toId }),
      });
    },
  };
}
