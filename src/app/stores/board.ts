import { defineStore } from "pinia";
import { ref } from "vue";
import type {
  BoardStatus,
  Project,
  Stage,
  WorkItem,
} from "../models/board.ts";
import {
  createWorkItem,
  listProjects,
  listStages,
  listWorkItems,
  postWorkItemEvent,
} from "../services/catalog.ts";

export type {
  BoardStatus,
  Project,
  Stage,
  WorkItem,
} from "../models/board.ts";

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
      const [projectsBody, stagesBody, itemsBody] = await Promise.all([
        listProjects(nextWorkspaceId),
        listStages(nextWorkspaceId),
        listWorkItems(nextWorkspaceId, nextProjectId),
      ]);
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
    try {
      const item = await createWorkItem(ws, { title, project_id: project });
      items.value = [...items.value, item];
    } catch {
      status.value = "error";
      error.value = "error";
    }
  }

  async function moveCard(
    itemId: string,
    to: string,
    body: string,
  ): Promise<void> {
    const item = items.value.find((row) => row.id === itemId);
    if (!item) return;
    const reason = body.trim();
    if (!reason) return;
    if (to === item.stage_key) return;
    try {
      const payload = await postWorkItemEvent(itemId, {
        type: "stage_changed",
        from: item.stage_key,
        to,
        body: reason,
      });
      items.value = items.value.map((row) =>
        row.id === itemId ? payload.work_item : row,
      );
    } catch {
      status.value = "error";
      error.value = "error";
    }
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
    moveCard,
  };
});
