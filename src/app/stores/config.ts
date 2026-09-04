import { defineStore } from "pinia";
import { ref } from "vue";
import type {
  ConfigMember,
  ConfigProject,
  ConfigStage,
  ConfigStatus,
  ConfigSubscription,
} from "../models/config.ts";
import {
  addMember as addMemberRequest,
  addNotifySubscription,
  createOrganization,
  createProject as createProjectRequest,
  deleteMember as deleteMemberRequest,
  deleteNotifySubscription,
  listMembers,
  listNotifySubscriptions,
  listProjects,
  listStages,
  patchMember,
  patchNotifySubscription,
  patchProject,
  patchStages,
} from "../services/catalog.ts";
import { ApiError } from "../services/http.ts";
import { useSessionStore } from "./session.ts";

export type {
  ConfigMember,
  ConfigProject,
  ConfigStage,
  ConfigStatus,
  ConfigSubscription,
} from "../models/config.ts";

export const useConfigStore = defineStore("config", () => {
  const workspaceId = ref<string | null>(null);
  const members = ref<ConfigMember[]>([]);
  const projects = ref<ConfigProject[]>([]);
  const stages = ref<ConfigStage[]>([]);
  const subscriptions = ref<ConfigSubscription[]>([]);
  const lastSecret = ref<string | null>(null);
  const status = ref<ConfigStatus>("ready");
  const error = ref<string | null>(null);
  const loading = ref(false);

  function fail(err: unknown): void {
    if (err instanceof ApiError && err.status === 401) {
      status.value = "no_session";
      return;
    }
    status.value = "error";
    error.value = "error";
  }

  async function load(nextWorkspaceId: string): Promise<void> {
    if (loading.value) return;
    loading.value = true;
    status.value = "loading";
    error.value = null;
    workspaceId.value = nextWorkspaceId;
    try {
      const [membersBody, projectsBody, stagesBody, notifyBody] =
        await Promise.all([
          listMembers(nextWorkspaceId),
          listProjects(nextWorkspaceId),
          listStages(nextWorkspaceId),
          listNotifySubscriptions(nextWorkspaceId),
        ]);
      members.value = membersBody.members;
      projects.value = projectsBody.projects;
      stages.value = stagesBody.stages;
      subscriptions.value = notifyBody.subscriptions;
      status.value = "ready";
    } catch (err) {
      fail(err);
    } finally {
      loading.value = false;
    }
  }

  async function addMember(input: {
    principal_id: string;
    role?: "owner" | "member";
  }): Promise<void> {
    const ws = workspaceId.value;
    if (!ws) return;
    const payload: { principal_id: string; role?: "owner" | "member" } = {
      principal_id: input.principal_id,
    };
    if (input.role !== undefined) payload.role = input.role;
    try {
      const body = await addMemberRequest(ws, payload);
      const idx = members.value.findIndex(
        (m) => m.principal_id === body.member.principal_id,
      );
      if (idx === -1) members.value = [...members.value, body.member];
      else {
        const next = [...members.value];
        next[idx] = body.member;
        members.value = next;
      }
      status.value = "ready";
    } catch (err) {
      fail(err);
    }
  }

  async function createProject(input: {
    name: string;
    parent_id: string | null;
  }): Promise<void> {
    const ws = workspaceId.value;
    if (!ws) return;
    try {
      const body = await createProjectRequest(ws, {
        name: input.name,
        parent_id: input.parent_id,
      });
      projects.value = [...projects.value, body.project];
      status.value = "ready";
    } catch (err) {
      fail(err);
    }
  }

  async function renameProject(id: string, name: string): Promise<void> {
    try {
      const body = await patchProject(id, { name });
      projects.value = projects.value.map((p) =>
        p.id === id ? { ...p, name: body.project.name } : p,
      );
      status.value = "ready";
    } catch (err) {
      fail(err);
    }
  }

  async function reparentProject(
    id: string,
    parentId: string | null,
  ): Promise<void> {
    try {
      const body = await patchProject(id, { parent_id: parentId });
      projects.value = projects.value.map((p) =>
        p.id === id ? { ...p, parent_id: body.project.parent_id } : p,
      );
      status.value = "ready";
    } catch (err) {
      fail(err);
    }
  }

  async function setRole(
    principalId: string,
    role: "owner" | "member",
  ): Promise<void> {
    const ws = workspaceId.value;
    if (!ws) return;
    try {
      const body = await patchMember(ws, principalId, role);
      members.value = members.value.map((m) =>
        m.principal_id === principalId ? { ...m, ...body.member } : m,
      );
      status.value = "ready";
    } catch (err) {
      fail(err);
    }
  }

  async function removeMember(principalId: string): Promise<void> {
    const ws = workspaceId.value;
    if (!ws) return;
    try {
      await deleteMemberRequest(ws, principalId);
      members.value = members.value.filter(
        (m) => m.principal_id !== principalId,
      );
      status.value = "ready";
    } catch (err) {
      fail(err);
    }
  }

  async function createWorkspace(name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      const created = await createOrganization(trimmed);
      const session = useSessionStore();
      await session.bindWorkspace(created.workspace.id);
      await session.loadMe();
      await load(created.workspace.id);
    } catch (err) {
      fail(err);
    }
  }

  async function addSubscription(input: {
    url: string;
    kinds: string[];
    enabled?: boolean;
  }): Promise<void> {
    const ws = workspaceId.value;
    if (!ws) return;
    try {
      const body = await addNotifySubscription(ws, input);
      subscriptions.value = [...subscriptions.value, body.subscription];
      lastSecret.value = body.secret;
      status.value = "ready";
    } catch (err) {
      fail(err);
    }
  }

  function clearLastSecret(): void {
    lastSecret.value = null;
  }

  async function removeSubscription(id: string): Promise<void> {
    const ws = workspaceId.value;
    if (!ws) return;
    try {
      await deleteNotifySubscription(ws, id);
      subscriptions.value = subscriptions.value.filter((s) => s.id !== id);
      status.value = "ready";
    } catch (err) {
      fail(err);
    }
  }

  async function setSubscriptionEnabled(
    id: string,
    enabled: boolean,
  ): Promise<void> {
    const ws = workspaceId.value;
    if (!ws) return;
    try {
      const body = await patchNotifySubscription(ws, id, { enabled });
      subscriptions.value = subscriptions.value.map((s) =>
        s.id === id ? { ...s, ...body.subscription } : s,
      );
      status.value = "ready";
    } catch (err) {
      fail(err);
    }
  }

  async function saveStages(next: ConfigStage[]): Promise<void> {
    const ws = workspaceId.value;
    if (!ws) return;
    try {
      const body = await patchStages(ws, next);
      stages.value = body.stages;
      status.value = "ready";
    } catch (err) {
      fail(err);
    }
  }

  return {
    workspaceId,
    members,
    projects,
    stages,
    subscriptions,
    lastSecret,
    status,
    error,
    loading,
    load,
    addMember,
    createProject,
    renameProject,
    reparentProject,
    setRole,
    removeMember,
    createWorkspace,
    saveStages,
    addSubscription,
    clearLastSecret,
    removeSubscription,
    setSubscriptionEnabled,
  };
});
