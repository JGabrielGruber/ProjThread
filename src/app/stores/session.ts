import { defineStore } from "pinia";
import { ref } from "vue";
import type { Membership, Principal } from "../models/session.ts";
import { getMe } from "../services/session.ts";

export type { Membership, Principal } from "../models/session.ts";

export const useSessionStore = defineStore("session", () => {
  const principal = ref<Principal | null>(null);
  const memberships = ref<Membership[]>([]);
  const loaded = ref(false);
  const loading = ref(false);

  async function loadMe(): Promise<void> {
    if (loading.value) return;
    loading.value = true;
    try {
      const body = await getMe();
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
