import type { CaptureApi } from "../../lib/capture.ts";
import { apiJson } from "./http.ts";

export function pwaCaptureApi(): CaptureApi {
  return {
    createNode: (workspaceId, body) =>
      apiJson(`/api/workspaces/${workspaceId}/nodes`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    includeNode: async (fromId, childId) => {
      await apiJson(`/api/nodes/${fromId}/includes`, {
        method: "POST",
        body: JSON.stringify({ child_id: childId }),
      });
    },
    linkProject: async (nodeId, projectId) => {
      await apiJson(`/api/nodes/${nodeId}/projects`, {
        method: "POST",
        body: JSON.stringify({ project_id: projectId }),
      });
    },
    refNode: async (fromId, toId) => {
      await apiJson(`/api/nodes/${fromId}/refs`, {
        method: "POST",
        body: JSON.stringify({ to_id: toId }),
      });
    },
    createBlobNode: (workspaceId, form) =>
      apiJson(`/api/workspaces/${workspaceId}/nodes`, {
        method: "POST",
        body: form,
      }),
  };
}
