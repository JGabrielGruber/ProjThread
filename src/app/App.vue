<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import KanbanBoard from "./KanbanBoard.vue";
import { useSessionStore, type Membership } from "./stores/session.ts";
import type { Project } from "./stores/board.ts";

type ThemeMode = "system" | "dark" | "light";
const THEME_ORDER: ThemeMode[] = ["system", "dark", "light"];

const RoomView = defineAsyncComponent(() => import("./RoomView.vue"));
const WikiView = defineAsyncComponent(() => import("./WikiView.vue"));
const ConfigView = defineAsyncComponent(() => import("./ConfigView.vue"));

const session = useSessionStore();
const route = useRoute();
const router = useRouter();

const themeMode = ref<ThemeMode>("system");

function readTheme(): ThemeMode {
  try {
    const stored = localStorage.getItem("pt-theme");
    if (stored === "dark" || stored === "light") return stored;
  } catch {
    /* ignore */
  }
  return "system";
}

function applyTheme(mode: ThemeMode): void {
  themeMode.value = mode;
  try {
    if (mode === "system") {
      localStorage.removeItem("pt-theme");
      delete document.documentElement.dataset.theme;
    } else {
      localStorage.setItem("pt-theme", mode);
      document.documentElement.dataset.theme = mode;
    }
  } catch {
    /* ignore */
  }
}

function cycleTheme(): void {
  const i = THEME_ORDER.indexOf(themeMode.value);
  applyTheme(THEME_ORDER[(i + 1) % THEME_ORDER.length]);
}

onMounted(() => {
  themeMode.value = readTheme();
  void session.loadMe();
});

function queryString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

const workspaceQuery = computed(() => queryString(route.query.workspace));
const projectQuery = computed(() => queryString(route.query.project));
const itemQuery = computed(() => queryString(route.query.item));
const wikiQuery = computed(
  () =>
    queryString(route.query.wiki) === "1" ||
    Boolean(queryString(route.query.node)),
);
const configQuery = computed(
  () => queryString(route.query.config) === "1",
);
const hasBoardQuery = computed(
  () => Boolean(workspaceQuery.value) && Boolean(projectQuery.value),
);

async function openWiki(): Promise<void> {
  const query: Record<string, string> = { wiki: "1" };
  if (workspaceQuery.value) query.workspace = workspaceQuery.value;
  if (projectQuery.value) query.project = projectQuery.value;
  await router.replace({ query });
}

async function openConfig(): Promise<void> {
  const query: Record<string, string> = { config: "1" };
  if (workspaceQuery.value) query.workspace = workspaceQuery.value;
  if (projectQuery.value) query.project = projectQuery.value;
  await router.replace({ query });
}

async function fillMissingQuery(memberships: Membership[]): Promise<void> {
  const workspaceMissing = !workspaceQuery.value;
  const projectMissing = !projectQuery.value;
  if (!workspaceMissing && !projectMissing) return;
  if (memberships.length === 0) return;

  const workspaceId = workspaceQuery.value ?? memberships[0].workspace_id;
  let projectId = projectQuery.value;
  if (!projectId) {
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/projects`, {
        credentials: "include",
      });
      if (!res.ok) return;
      const body = (await res.json()) as { projects: Project[] };
      const root = body.projects.find((p) => p.parent_id == null);
      if (!root) return;
      projectId = root.id;
    } catch {
      return;
    }
  }

  const query = { ...route.query };
  if (workspaceMissing) query.workspace = workspaceId;
  if (projectMissing) query.project = projectId;
  if (
    query.workspace === route.query.workspace &&
    query.project === route.query.project
  ) {
    return;
  }
  await router.replace({ query });
}

watch(
  () => [
    session.loaded,
    session.principal,
    session.memberships,
    workspaceQuery.value,
    projectQuery.value,
  ],
  () => {
    if (!session.loaded || !session.principal || session.memberships.length === 0) {
      return;
    }
    void fillMissingQuery(session.memberships);
  },
  { immediate: true },
);
</script>

<template>
  <main v-if="session.loaded">
    <h1 v-if="!session.principal">No session</h1>
    <h1 v-else-if="session.memberships.length === 0">No workspace</h1>
    <section v-else>
      <header>
        <p class="who">{{ session.principal.display_name }}</p>
        <button type="button" class="wiki-nav" @click="openWiki">Wiki</button>
        <button type="button" class="wiki-nav" @click="openConfig">Config</button>
        <button type="button" class="wiki-nav" @click="cycleTheme">
          {{ themeMode }}
        </button>
      </header>
      <RoomView v-if="itemQuery" />
      <WikiView v-else-if="wikiQuery" />
      <ConfigView v-else-if="configQuery" />
      <KanbanBoard v-else-if="hasBoardQuery" />
    </section>
  </main>
</template>

<style scoped>
main {
  padding: 1.5rem;
  color: var(--fg);
  background: var(--bg);
  font-family: var(--font);
}

h1 {
  margin: 0;
  font-size: 1.5rem;
}

header {
  display: flex;
  gap: 1rem;
  align-items: baseline;
  margin-bottom: 1rem;
}

.wiki-nav {
  font: inherit;
  color: var(--accent);
  background: var(--bg);
  border: 1px solid var(--muted);
  border-radius: var(--radius);
  padding: 0.35rem 0.5rem;
  cursor: pointer;
}

.who {
  margin: 0;
  font-size: 0.9rem;
  color: var(--muted);
}
</style>
