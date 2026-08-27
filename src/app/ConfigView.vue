<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute } from "vue-router";
import {
  useConfigStore,
  type ConfigStage,
} from "./stores/config.ts";

const route = useRoute();
const config = useConfigStore();

function queryString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

const workspaceId = computed(() => queryString(route.query.workspace));

const memberOpen = ref(false);
const principalId = ref("");
const memberRole = ref<"owner" | "member">("member");

const projectOpen = ref(false);
const projectName = ref("");
const projectParentKey = ref("");
const renameOpen = ref(false);
const renameId = ref<string | null>(null);
const renameName = ref("");

const draftStages = ref<ConfigStage[]>([]);

watch(
  workspaceId,
  (workspace) => {
    if (workspace) void config.load(workspace);
  },
  { immediate: true },
);

watch(
  () => config.stages,
  (rows) => {
    draftStages.value = rows.map((s) => ({ ...s }));
  },
  { immediate: true },
);

function parentName(parentId: string | null): string {
  if (!parentId) return "root";
  return config.projects.find((p) => p.id === parentId)?.name ?? parentId;
}

async function submitMember(): Promise<void> {
  if (config.status !== "ready") return;
  const id = principalId.value.trim();
  if (!id) return;
  await config.addMember({ principal_id: id, role: memberRole.value });
  principalId.value = "";
  memberRole.value = "member";
  memberOpen.value = false;
}

async function submitProject(): Promise<void> {
  if (config.status !== "ready") return;
  const name = projectName.value.trim();
  if (!name) return;
  await config.createProject({
    name,
    parent_id: projectParentKey.value || null,
  });
  projectName.value = "";
  projectParentKey.value = "";
  projectOpen.value = false;
}

function openRename(id: string, name: string): void {
  renameId.value = id;
  renameName.value = name;
  renameOpen.value = true;
}

async function submitRename(): Promise<void> {
  if (config.status !== "ready" || !renameId.value) return;
  const name = renameName.value.trim();
  if (!name) return;
  await config.renameProject(renameId.value, name);
  renameOpen.value = false;
}

async function submitStages(): Promise<void> {
  if (config.status !== "ready") return;
  await config.saveStages(
    draftStages.value.map((s) => ({
      key: s.key,
      label: s.label,
      position: Number(s.position),
    })),
  );
}
</script>

<template>
  <section class="config">
    <h2>Config</h2>
    <p v-if="config.status === 'loading'" class="muted">Loading</p>
    <p v-else-if="config.status === 'error'" class="error">Could not load config</p>
    <p v-else-if="config.status === 'no_session'">No session</p>

    <h3>Members</h3>
    <ul>
      <li v-for="member in config.members" :key="member.principal_id">
        {{ member.display_name }} · {{ member.role }}
      </li>
    </ul>
    <button
      type="button"
      :disabled="config.status !== 'ready'"
      @click="memberOpen = true"
    >
      Add member
    </button>
    <div
      v-if="memberOpen"
      class="modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="member-title"
    >
      <form class="form" @submit.prevent="submitMember">
        <h4 id="member-title">Add member</h4>
        <input v-model="principalId" type="text" aria-label="Principal id" />
        <select v-model="memberRole" aria-label="Role">
          <option value="member">member</option>
          <option value="owner">owner</option>
        </select>
        <button type="submit" :disabled="config.status !== 'ready'">Add</button>
        <button type="button" @click="memberOpen = false">Cancel</button>
      </form>
    </div>

    <h3>Projects</h3>
    <ul>
      <li v-for="project in config.projects" :key="project.id">
        {{ project.name }} · {{ parentName(project.parent_id) }}
        <button
          type="button"
          :disabled="config.status !== 'ready'"
          @click="openRename(project.id, project.name)"
        >
          Rename
        </button>
      </li>
    </ul>
    <button
      type="button"
      :disabled="config.status !== 'ready'"
      @click="projectOpen = true"
    >
      Create project
    </button>
    <div
      v-if="projectOpen"
      class="modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="project-title"
    >
      <form class="form" @submit.prevent="submitProject">
        <h4 id="project-title">Create project</h4>
        <input v-model="projectName" type="text" aria-label="Project name" />
        <select v-model="projectParentKey" aria-label="Parent">
          <option value="">root</option>
          <option
            v-for="project in config.projects"
            :key="project.id"
            :value="project.id"
          >
            {{ project.name }}
          </option>
        </select>
        <button type="submit" :disabled="config.status !== 'ready'">Create</button>
        <button type="button" @click="projectOpen = false">Cancel</button>
      </form>
    </div>
    <div
      v-if="renameOpen"
      class="modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rename-title"
    >
      <form class="form" @submit.prevent="submitRename">
        <h4 id="rename-title">Rename project</h4>
        <input v-model="renameName" type="text" aria-label="Project name" />
        <button type="submit" :disabled="config.status !== 'ready'">Save</button>
        <button type="button" @click="renameOpen = false">Cancel</button>
      </form>
    </div>

    <h3>Stages</h3>
    <ul>
      <li v-for="stage in draftStages" :key="stage.key">
        <span>{{ stage.key }}</span>
        <input
          v-model="stage.label"
          type="text"
          :aria-label="`${stage.key} label`"
        />
        <input
          v-model.number="stage.position"
          type="number"
          :aria-label="`${stage.key} position`"
        />
      </li>
    </ul>
    <button
      type="button"
      :disabled="config.status !== 'ready'"
      @click="submitStages"
    >
      Save
    </button>
  </section>
</template>

<style scoped>
.config {
  color: var(--fg);
}

h2,
h3,
h4 {
  margin: 0 0 0.75rem;
  font-size: 1.1rem;
}

h3 {
  margin-top: 1.5rem;
}

h4 {
  font-size: 1rem;
}

.muted {
  margin: 0;
  color: var(--muted);
  font-size: 0.9rem;
}

.error {
  color: var(--danger);
}

ul {
  list-style: none;
  margin: 0 0 0.75rem;
  padding: 0;
}

li {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
  margin: 0 0 0.5rem;
}

.form {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  max-width: 24rem;
}

.modal {
  margin: 0.75rem 0 1rem;
  padding: 0.75rem;
  border: 1px solid var(--muted);
  border-radius: var(--radius);
}

input,
select,
button {
  font: inherit;
  color: var(--fg);
  background: var(--bg);
  border: 1px solid var(--muted);
  border-radius: var(--radius);
  padding: 0.35rem 0.5rem;
}

button {
  color: var(--accent);
  cursor: pointer;
}

button:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
