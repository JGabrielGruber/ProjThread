import { defineStore } from "pinia";
import { ref } from "vue";

export type Principal = {
  id: string;
  type: string;
  display_name: string;
};

export type Membership = {
  organization_id: string;
  organization_name: string;
  workspace_id: string;
  workspace_name: string;
  role: string;
};

export const useSessionStore = defineStore("session", () => {
  const principal = ref<Principal | null>(null);
  const memberships = ref<Membership[]>([]);
  const loaded = ref(false);
  const loading = ref(false);

  async function loadMe(): Promise<void> {
    if (loading.value) return;
    loading.value = true;
    try {
      const res = await fetch("/api/me", { credentials: "include" });
      if (res.status === 401 || !res.ok) {
        principal.value = null;
        memberships.value = [];
        return;
      }
      const body = (await res.json()) as {
        principal: Principal;
        memberships?: Membership[];
      };
      principal.value = body.principal;
      memberships.value = body.memberships ?? [];
    } catch {
      principal.value = null;
      memberships.value = [];
    } finally {
      loaded.value = true;
      loading.value = false;
    }
  }

  return { principal, memberships, loaded, loading, loadMe };
});
