<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import Toast from "./components/Toast.vue";
import { listProjects } from "./services/catalog.ts";
import { useBoardStore } from "./stores/board.ts";
import { useConfigStore } from "./stores/config.ts";
import { useRoomStore } from "./stores/room.ts";
import { useSessionStore, type Membership } from "./stores/session.ts";
import { useWikiStore } from "./stores/wiki.ts";

type ThemeMode = "system" | "dark" | "light";
const THEME_ORDER: ThemeMode[] = ["system", "dark", "light"];

const session = useSessionStore();
const board = useBoardStore();
const room = useRoomStore();
const wiki = useWikiStore();
const config = useConfigStore();
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
const hasBoardQuery = computed(
  () => Boolean(workspaceQuery.value) && Boolean(projectQuery.value),
);

const place = computed(() => {
  const query: Record<string, string> = {};
  if (workspaceQuery.value) query.workspace = workspaceQuery.value;
  if (projectQuery.value) query.project = projectQuery.value;
  return query;
});

const kanbanNav = computed(() => route.name === "kanban");
const wikiNav = computed(() => route.name === "wiki");
const configNav = computed(() => route.name === "config");

const toast = computed(() => {
  if (route.name === "room") {
    if (room.status === "loading") return { message: "Connecting", tone: "info" as const };
    if (room.status === "error") {
      return { message: "Could not open room", tone: "error" as const };
    }
    if (room.status === "no_session") {
      return { message: "No session", tone: "info" as const };
    }
    return { message: "", tone: "info" as const };
  }
  if (route.name === "wiki") {
    if (wiki.status === "loading") return { message: "Loading", tone: "info" as const };
    if (wiki.status === "error") {
      return { message: "Could not load wiki", tone: "error" as const };
    }
    if (wiki.status === "no_session") {
      return { message: "No session", tone: "info" as const };
    }
    return { message: "", tone: "info" as const };
  }
  if (route.name === "config") {
    if (config.status === "loading") return { message: "Loading", tone: "info" as const };
    if (config.status === "error") {
      return { message: "Could not load config", tone: "error" as const };
    }
    if (config.status === "no_session") {
      return { message: "No session", tone: "info" as const };
    }
    return { message: "", tone: "info" as const };
  }
  if (hasBoardQuery.value) {
    if (board.status === "loading") return { message: "Loading", tone: "info" as const };
    if (board.status === "error") {
      return { message: "Could not load board", tone: "error" as const };
    }
  }
  return { message: "", tone: "info" as const };
});

async function openBoard(): Promise<void> {
  await router.replace({ name: "kanban", query: place.value });
}

async function openWiki(): Promise<void> {
  await router.replace({ name: "wiki", query: place.value });
}

async function openConfig(): Promise<void> {
  await router.replace({ name: "config", query: place.value });
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
      const body = await listProjects(workspaceId);
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
    <section v-else class="shell">
      <nav class="rail" aria-label="App">
        <p class="who">{{ session.principal.display_name }}</p>
        <button
          type="button"
          class="nav-btn"
          :class="{ 'is-active': kanbanNav }"
          :aria-current="kanbanNav ? 'page' : undefined"
          @click="openBoard"
        >
          Kanban
        </button>
        <button
          type="button"
          class="nav-btn"
          :class="{ 'is-active': wikiNav }"
          :aria-current="wikiNav ? 'page' : undefined"
          @click="openWiki"
        >
          Wiki
        </button>
        <button
          type="button"
          class="nav-btn"
          :class="{ 'is-active': configNav }"
          :aria-current="configNav ? 'page' : undefined"
          @click="openConfig"
        >
          Config
        </button>
        <button type="button" class="nav-btn theme" @click="cycleTheme">
          {{ themeMode }}
        </button>
      </nav>
      <div class="stage">
        <RouterView />
      </div>
    </section>
    <Toast :message="toast.message" :tone="toast.tone" />
  </main>
</template>

<style scoped>
main {
  min-height: 100dvh;
  height: 100dvh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: var(--fg);
  background: var(--bg);
  font-family: var(--font);
}

.shell {
  display: grid;
  grid-template-columns: 13rem minmax(0, 1fr);
  flex: 1;
  min-height: 0;
  height: 100%;
}

h1 {
  margin: 0;
  padding: 1.5rem;
  font-size: 1.5rem;
}

.rail {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  height: 100dvh;
  padding: 1rem 0.75rem;
  background: var(--bg);
  border-right: 1px solid var(--border);
}

.stage {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: auto;
}

.stage > * {
  flex: 1;
  min-height: 0;
}

.nav-btn {
  font: inherit;
  font-size: 1.05rem;
  color: var(--muted);
  background: transparent;
  border: none;
  border-radius: 999px;
  padding: 0.5rem 0.75rem;
  text-align: left;
  cursor: pointer;
}

.nav-btn:hover {
  color: var(--fg);
  background: var(--surface);
}

.nav-btn.is-active {
  color: var(--fg);
  font-weight: 700;
  background: transparent;
}

.who {
  margin: 0 0 0.75rem;
  padding: 0 0.75rem;
  font-size: 0.8125rem;
  color: var(--muted);
}

.theme {
  margin-top: auto;
  font-size: 0.875rem;
}

@media (max-width: 48rem) {
  .shell {
    grid-template-columns: 1fr;
    grid-template-rows: auto minmax(0, 1fr);
  }

  .rail {
    position: sticky;
    top: 0;
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem 0.5rem;
    height: auto;
    padding: 0.5rem 0.75rem;
    border-right: none;
    border-bottom: 1px solid var(--border);
  }

  .who {
    margin: 0 0.5rem 0 0;
    padding: 0;
  }

  .theme {
    margin-top: 0;
    margin-left: auto;
  }
}
</style>
