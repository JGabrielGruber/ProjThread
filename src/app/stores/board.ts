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
  const filterProjectId = ref<string | null>(null);

  async function loadBoard(
    nextWorkspaceId: string,
    nextProjectId?: string,
  ): Promise<void> {
    if (loading.value) return;
    loading.value = true;
    status.value = "loading";
    error.value = null;
    workspaceId.value = nextWorkspaceId;
    try {
      const [projectsBody, stagesBody] = await Promise.all([
        listProjects(nextWorkspaceId),
        listStages(nextWorkspaceId),
      ]);
      projects.value = projectsBody.projects;
      stages.value = stagesBody.stages;
      const root = projectsBody.projects.find((p) => p.parent_id == null);
      if (nextProjectId !== undefined) {
        filterProjectId.value = nextProjectId;
      }
      const filterId = filterProjectId.value ?? root?.id ?? null;
      projectId.value = filterId;
      if (filterId) {
        const itemsBody = await listWorkItems(nextWorkspaceId, filterId);
        items.value = itemsBody.work_items;
      } else {
        items.value = [];
      }
      status.value = "ready";
    } catch {
      status.value = "error";
      error.value = "error";
    } finally {
      loading.value = false;
    }
  }

  async function setFilter(id: string | null): Promise<void> {
    filterProjectId.value = id;
    const ws = workspaceId.value;
    const root = projects.value.find((p) => p.parent_id == null);
    const filterId = id ?? root?.id ?? null;
    projectId.value = filterId;
    if (!ws || !filterId) {
      items.value = [];
      return;
    }
    try {
      const itemsBody = await listWorkItems(ws, filterId);
      items.value = itemsBody.work_items;
    } catch {
      status.value = "error";
      error.value = "error";
    }
  }

  async function createCard(title: string): Promise<void> {
    const ws = workspaceId.value;
    const root = projects.value.find((p) => p.parent_id == null);
    const project = filterProjectId.value ?? projectId.value ?? root?.id;
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
    filterProjectId,
    loadBoard,
    setFilter,
    createCard,
    moveCard,
  };
});
