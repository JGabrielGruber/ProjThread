<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import ProjectTree from "./components/ProjectTree.vue";
import PtButton from "./components/PtButton.vue";
import PtField from "./components/PtField.vue";
import Toast from "./components/Toast.vue";
import { useBoardStore } from "./stores/board.ts";
import { useCaptureStore } from "./stores/capture.ts";
import { useConfigStore } from "./stores/config.ts";
import { useRoomStore } from "./stores/room.ts";
import { useSessionStore } from "./stores/session.ts";
import { useWikiStore } from "./stores/wiki.ts";

type ThemeMode = "system" | "dark" | "light";
const THEME_ORDER: ThemeMode[] = ["system", "dark", "light"];

const session = useSessionStore();
const board = useBoardStore();
const capture = useCaptureStore();
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

const filtersOpen = ref(false);
const workspaceDraft = computed(() => session.workspaceId ?? "");
const workspaceName = ref("");

async function submitFirstWorkspace(): Promise<void> {
  const name = workspaceName.value.trim();
  if (!name) return;
  await config.createWorkspace(name);
  if (config.status === "error") return;
  workspaceName.value = "";
}

const showTree = computed(
  () =>
    Boolean(session.workspaceId) &&
    (route.name === "kanban" || route.name === "wiki" || route.name === "room"),
);

watch(
  () => session.workspaceId,
  (id) => {
    if (id) void board.loadBoard(id);
  },
);

async function onWorkspaceChange(id: string): Promise<void> {
  if (!id || id === session.workspaceId) return;
  await session.bindWorkspace(id);
}

const kanbanNav = computed(() => route.name === "kanban");
const wikiNav = computed(() => route.name === "wiki");
const captureNav = computed(() => route.name === "capture");
const configNav = computed(() => route.name === "config");

const toast = computed(() => {
  if (session.principal && session.memberships.length === 0) {
    if (config.status === "error") {
      return { message: "Could not create workspace", tone: "error" as const };
    }
    return { message: "", tone: "info" as const };
  }
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
  if (route.name === "capture") {
    if (capture.status === "filing") return { message: "Filing", tone: "info" as const };
    if (capture.status === "error") {
      return { message: capture.message || "Could not file", tone: "error" as const };
    }
    return { message: "", tone: "info" as const };
  }
  if (session.workspaceId) {
    if (board.status === "loading") return { message: "Loading", tone: "info" as const };
    if (board.status === "error") {
      return { message: "Could not load board", tone: "error" as const };
    }
  }
  return { message: "", tone: "info" as const };
});

async function openBoard(): Promise<void> {
  await router.replace({ name: "kanban" });
}

async function openWiki(): Promise<void> {
  await router.replace({ name: "wiki" });
}

async function openCapture(): Promise<void> {
  await router.replace({ name: "capture" });
}

async function openConfig(): Promise<void> {
  await router.replace({ name: "config" });
}
</script>

<template>
  <main v-if="session.loaded">
    <h1 v-if="!session.principal">No session</h1>
    <section
      v-else-if="session.memberships.length === 0"
      class="setup"
    >
      <h1>No workspace</h1>
      <p class="who">{{ session.principal.display_name }}</p>
      <form class="form" @submit.prevent="submitFirstWorkspace">
        <PtField
          v-model="workspaceName"
          type="text"
          label="Workspace name"
        />
        <PtButton type="submit" variant="primary">Create workspace</PtButton>
      </form>
    </section>
    <section v-else class="shell">
      <nav class="rail" aria-label="App">
        <p class="who">{{ session.principal.display_name }}</p>
        <PtField
          as="select"
          label="Workspace"
          class="place"
          :model-value="workspaceDraft"
          @update:model-value="onWorkspaceChange(String($event))"
        >
          <option
            v-for="row in session.memberships"
            :key="row.workspace_id"
            :value="row.workspace_id"
          >
            {{ row.workspace_name }}
          </option>
        </PtField>
        <PtButton
          v-if="showTree"
          variant="compact"
          class="filters-toggle"
          @click="filtersOpen = !filtersOpen"
        >
          Filters
        </PtButton>
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
          :class="{ 'is-active': captureNav }"
          :aria-current="captureNav ? 'page' : undefined"
          @click="openCapture"
        >
          Capture
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
        <div
          v-if="showTree && filtersOpen"
          class="filters"
        >
          <ProjectTree
            :projects="board.projects"
            :selected-id="board.filterProjectId"
            @select="board.setFilter"
          />
        </div>
        <RouterView />
      </div>
      <aside v-if="showTree" class="tree" aria-label="Project filter">
        <ProjectTree
          :projects="board.projects"
          :selected-id="board.filterProjectId"
          @select="board.setFilter"
        />
      </aside>
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

.shell:has(.tree) {
  grid-template-columns: 13rem minmax(0, 1fr) 13rem;
}

h1 {
  margin: 0;
  padding: 1.5rem;
  font-size: 1.5rem;
}

.setup {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  max-width: 24rem;
  padding: 1.5rem;
}

.setup h1 {
  padding: 0;
}

.setup .form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
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

.tree {
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding: 0.75rem;
  border-left: 1px solid var(--border);
}

.filters {
  display: none;
  max-height: 80dvh;
  overflow: auto;
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--border);
}

.filters-toggle {
  display: none;
}

.place {
  width: 100%;
  margin-bottom: 0.5rem;
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
  .shell,
  .shell:has(.tree) {
    grid-template-columns: 1fr;
    grid-template-rows: auto minmax(0, 1fr);
  }

  .tree {
    display: none;
  }

  .filters {
    display: block;
  }

  .filters-toggle {
    display: inline-flex;
  }

  .place {
    width: auto;
    margin: 0 0.5rem 0 0;
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
