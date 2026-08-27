import { defineStore } from "pinia";
import { ref } from "vue";

export type ConfigMember = {
  principal_id: string;
  display_name: string;
  type: string;
  role: "owner" | "member";
};

export type ConfigProject = {
  id: string;
  parent_id: string | null;
  name: string;
};

export type ConfigStage = {
  key: string;
  label: string;
  position: number;
};

export type ConfigStatus = "loading" | "ready" | "error" | "no_session";

export const useConfigStore = defineStore("config", () => {
  const workspaceId = ref<string | null>(null);
  const members = ref<ConfigMember[]>([]);
  const projects = ref<ConfigProject[]>([]);
  const stages = ref<ConfigStage[]>([]);
  const status = ref<ConfigStatus>("ready");
  const error = ref<string | null>(null);
  const loading = ref(false);

  async function load(nextWorkspaceId: string): Promise<void> {
    if (loading.value) return;
    loading.value = true;
    status.value = "loading";
    error.value = null;
    workspaceId.value = nextWorkspaceId;
    const prefix = `/api/workspaces/${nextWorkspaceId}`;
    try {
      const [membersRes, projectsRes, stagesRes] = await Promise.all([
        fetch(`${prefix}/members`, { credentials: "include" }),
        fetch(`${prefix}/projects`, { credentials: "include" }),
        fetch(`${prefix}/stages`, { credentials: "include" }),
      ]);
      if (
        membersRes.status === 401 ||
        projectsRes.status === 401 ||
        stagesRes.status === 401
      ) {
        status.value = "no_session";
        return;
      }
      if (!membersRes.ok || !projectsRes.ok || !stagesRes.ok) {
        status.value = "error";
        error.value = "error";
        return;
      }
      const membersBody = (await membersRes.json()) as { members: ConfigMember[] };
      const projectsBody = (await projectsRes.json()) as {
        projects: ConfigProject[];
      };
      const stagesBody = (await stagesRes.json()) as { stages: ConfigStage[] };
      members.value = membersBody.members;
      projects.value = projectsBody.projects;
      stages.value = stagesBody.stages;
      status.value = "ready";
    } catch {
      status.value = "error";
      error.value = "error";
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
    const res = await fetch(`/api/workspaces/${ws}/members`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.status !== 200 && res.status !== 201) {
      status.value = "error";
      error.value = "error";
      return;
    }
    const body = (await res.json()) as { member: ConfigMember };
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
  }

  async function createProject(input: {
    name: string;
    parent_id: string | null;
  }): Promise<void> {
    const ws = workspaceId.value;
    if (!ws) return;
    const res = await fetch(`/api/workspaces/${ws}/projects`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: input.name,
        parent_id: input.parent_id,
      }),
    });
    if (res.status !== 201) {
      status.value = "error";
      error.value = "error";
      return;
    }
    const body = (await res.json()) as { project: ConfigProject };
    projects.value = [...projects.value, body.project];
    status.value = "ready";
  }

  async function renameProject(id: string, name: string): Promise<void> {
    const res = await fetch(`/api/projects/${id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      status.value = "error";
      error.value = "error";
      return;
    }
    const body = (await res.json()) as { project: ConfigProject };
    projects.value = projects.value.map((p) =>
      p.id === id ? { ...p, name: body.project.name } : p,
    );
    status.value = "ready";
  }

  async function saveStages(next: ConfigStage[]): Promise<void> {
    const ws = workspaceId.value;
    if (!ws) return;
    const res = await fetch(`/api/workspaces/${ws}/stages`, {
      method: "PATCH",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stages: next }),
    });
    if (!res.ok) {
      status.value = "error";
      error.value = "error";
      return;
    }
    const body = (await res.json()) as { stages: ConfigStage[] };
    stages.value = body.stages;
    status.value = "ready";
  }

  return {
    workspaceId,
    members,
    projects,
    stages,
    status,
    error,
    loading,
    load,
    addMember,
    createProject,
    renameProject,
    saveStages,
  };
});
