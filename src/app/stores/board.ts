import { defineStore } from "pinia";
import { ref } from "vue";

export type Project = {
  id: string;
  parent_id: string | null;
  name: string;
};

export type Stage = {
  key: string;
  label: string;
  position: number;
};

export type WorkItem = {
  id: string;
  project_id: string;
  workspace_id: string;
  organization_id: string;
  title: string;
  stage_key: string;
  owner_id: string | null;
  created_at: string;
  updated_at: string;
};

export type BoardStatus = "loading" | "ready" | "error";

export const useBoardStore = defineStore("board", () => {
  const projects = ref<Project[]>([]);
  const stages = ref<Stage[]>([]);
  const items = ref<WorkItem[]>([]);
  const status = ref<BoardStatus>("ready");
  const error = ref<string | null>(null);
  const loading = ref(false);
  const workspaceId = ref<string | null>(null);
  const projectId = ref<string | null>(null);

  async function loadBoard(nextWorkspaceId: string, nextProjectId: string): Promise<void> {
    if (loading.value) return;
    loading.value = true;
    status.value = "loading";
    error.value = null;
    workspaceId.value = nextWorkspaceId;
    projectId.value = nextProjectId;
    try {
      const [projectsRes, stagesRes, itemsRes] = await Promise.all([
        fetch(`/api/workspaces/${nextWorkspaceId}/projects`, {
          credentials: "include",
        }),
        fetch(`/api/workspaces/${nextWorkspaceId}/stages`, {
          credentials: "include",
        }),
        fetch(
          `/api/workspaces/${nextWorkspaceId}/work-items?project_id=${nextProjectId}`,
          { credentials: "include" },
        ),
      ]);
      if (!projectsRes.ok || !stagesRes.ok || !itemsRes.ok) {
        status.value = "error";
        error.value = "error";
        return;
      }
      const projectsBody = (await projectsRes.json()) as { projects: Project[] };
      const stagesBody = (await stagesRes.json()) as { stages: Stage[] };
      const itemsBody = (await itemsRes.json()) as { work_items: WorkItem[] };
      projects.value = projectsBody.projects;
      stages.value = stagesBody.stages;
      items.value = itemsBody.work_items;
      status.value = "ready";
    } catch {
      status.value = "error";
      error.value = "error";
    } finally {
      loading.value = false;
    }
  }

  async function createCard(title: string): Promise<void> {
    const ws = workspaceId.value;
    const project = projectId.value;
    if (!ws || !project) return;
    const res = await fetch(`/api/workspaces/${ws}/work-items`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, project_id: project }),
    });
    if (!res.ok) {
      status.value = "error";
      error.value = "error";
      return;
    }
    const item = (await res.json()) as WorkItem;
    items.value = [...items.value, item];
  }

  return {
    projects,
    stages,
    items,
    status,
    error,
    loading,
    workspaceId,
    projectId,
    loadBoard,
    createCard,
  };
});
