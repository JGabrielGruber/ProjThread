import { defineStore } from "pinia";
import { ref } from "vue";
import type { Membership, Principal } from "../models/session.ts";
import { getMe, patchMe } from "../services/session.ts";

export type { Membership, Principal } from "../models/session.ts";

export const useSessionStore = defineStore("session", () => {
  const principal = ref<Principal | null>(null);
  const memberships = ref<Membership[]>([]);
  const workspaceId = ref<string | null>(null);
  const loaded = ref(false);
  const loading = ref(false);

  async function loadMe(): Promise<void> {
    if (loading.value) return;
    loading.value = true;
    try {
      let body = await getMe();
      principal.value = body.principal;
      memberships.value = body.memberships ?? [];
      let bound = body.workspace_id;
      if (!bound && memberships.value[0]) {
        body = await patchMe({
          workspace_id: memberships.value[0].workspace_id,
        });
        principal.value = body.principal;
        memberships.value = body.memberships ?? [];
        bound = body.workspace_id;
      }
      workspaceId.value = bound;
    } catch {
      principal.value = null;
      memberships.value = [];
      workspaceId.value = null;
    } finally {
      loaded.value = true;
      loading.value = false;
    }
  }

  async function bindWorkspace(id: string): Promise<void> {
    const body = await patchMe({ workspace_id: id });
    principal.value = body.principal;
    memberships.value = body.memberships ?? [];
    workspaceId.value = body.workspace_id;
  }

  return {
    principal,
    memberships,
    workspaceId,
    loaded,
    loading,
    loadMe,
    bindWorkspace,
  };
});
