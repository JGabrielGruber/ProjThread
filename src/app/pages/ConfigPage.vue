<script setup lang="ts">
import { ref, watch } from "vue";
import Modal from "../components/Modal.vue";
import PtButton from "../components/PtButton.vue";
import PtField from "../components/PtField.vue";
import PtListRow from "../components/PtListRow.vue";
import {
  useConfigStore,
  type ConfigStage,
} from "../stores/config.ts";
import { useSessionStore } from "../stores/session.ts";

const session = useSessionStore();
const config = useConfigStore();

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
const workspaceName = ref("");

watch(
  () => session.workspaceId,
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

async function onRole(principalId: string, role: string): Promise<void> {
  if (role !== "owner" && role !== "member") return;
  await config.setRole(principalId, role);
}

async function onParent(id: string, parent: string): Promise<void> {
  await config.reparentProject(id, parent || null);
}

async function submitWorkspace(): Promise<void> {
  const name = workspaceName.value.trim();
  if (!name) return;
  await config.createWorkspace(name);
  if (config.status === "error") return;
  workspaceName.value = "";
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

    <section class="block">
    <h3>Workspace</h3>
    <form class="form" @submit.prevent="submitWorkspace">
      <PtField v-model="workspaceName" type="text" label="New workspace" />
      <PtButton type="submit" variant="primary">Create workspace</PtButton>
    </form>
    </section>

    <section class="block">
    <h3>Members</h3>
    <ul>
      <PtListRow v-for="member in config.members" :key="member.principal_id">
        {{ member.display_name }}
        <template #meta>
          <PtField
            as="select"
            :model-value="member.role"
            :label="`${member.display_name} role`"
            @update:model-value="onRole(member.principal_id, String($event))"
          >
            <option value="owner">owner</option>
            <option value="member">member</option>
          </PtField>
          <PtButton
            type="button"
            :disabled="config.status !== 'ready'"
            @click="config.removeMember(member.principal_id)"
          >
            Remove
          </PtButton>
        </template>
      </PtListRow>
    </ul>
    <PtButton
      type="button"
      variant="primary"
      :disabled="config.status !== 'ready'"
      @click="memberOpen = true"
    >
      Add member
    </PtButton>
    <Modal
      :open="memberOpen"
      title="Add member"
      labelled-by="member-title"
      @close="memberOpen = false"
    >
      <form class="form" @submit.prevent="submitMember">
        <PtField v-model="principalId" type="text" label="Principal id" />
        <PtField v-model="memberRole" as="select" label="Role">
          <option value="member">member</option>
          <option value="owner">owner</option>
        </PtField>
        <PtButton type="submit" variant="primary" :disabled="config.status !== 'ready'">Add</PtButton>
        <PtButton type="button" @click="memberOpen = false">Cancel</PtButton>
      </form>
    </Modal>
    </section>

    <section class="block">
    <h3>Projects</h3>
    <ul>
      <PtListRow v-for="project in config.projects" :key="project.id">
        {{ project.name }} · {{ parentName(project.parent_id) }}
        <template #meta>
          <PtField
            as="select"
            :model-value="project.parent_id ?? ''"
            :label="`${project.name} parent`"
            @update:model-value="onParent(project.id, String($event))"
          >
            <option value="">root</option>
            <option
              v-for="other in config.projects.filter((p) => p.id !== project.id)"
              :key="other.id"
              :value="other.id"
            >
              {{ other.name }}
            </option>
          </PtField>
          <PtButton
            type="button"
            :disabled="config.status !== 'ready'"
            @click="openRename(project.id, project.name)"
          >
            Rename
          </PtButton>
        </template>
      </PtListRow>
    </ul>
    <PtButton
      type="button"
      variant="primary"
      :disabled="config.status !== 'ready'"
      @click="projectOpen = true"
    >
      Create project
    </PtButton>
    <Modal
      :open="projectOpen"
      title="Create project"
      labelled-by="project-title"
      @close="projectOpen = false"
    >
      <form class="form" @submit.prevent="submitProject">
        <PtField v-model="projectName" type="text" label="Project name" />
        <PtField v-model="projectParentKey" as="select" label="Parent">
          <option value="">root</option>
          <option
            v-for="project in config.projects"
            :key="project.id"
            :value="project.id"
          >
            {{ project.name }}
          </option>
        </PtField>
        <PtButton type="submit" variant="primary" :disabled="config.status !== 'ready'">Create</PtButton>
        <PtButton type="button" @click="projectOpen = false">Cancel</PtButton>
      </form>
    </Modal>
    <Modal
      :open="renameOpen"
      title="Rename project"
      labelled-by="rename-title"
      @close="renameOpen = false"
    >
      <form class="form" @submit.prevent="submitRename">
        <PtField v-model="renameName" type="text" label="Project name" />
        <PtButton type="submit" variant="primary" :disabled="config.status !== 'ready'">Save</PtButton>
        <PtButton type="button" @click="renameOpen = false">Cancel</PtButton>
      </form>
    </Modal>
    </section>

    <section class="block">
    <h3>Stages</h3>
    <ul>
      <PtListRow v-for="stage in draftStages" :key="stage.key">
        <span>{{ stage.key }}</span>
        <template #meta>
          <PtField
            v-model="stage.label"
            type="text"
            :label="`${stage.key} label`"
          />
          <PtField
            v-model="stage.position"
            type="number"
            :label="`${stage.key} position`"
          />
        </template>
      </PtListRow>
    </ul>
    <PtButton
      type="button"
      variant="primary"
      :disabled="config.status !== 'ready'"
      @click="submitStages"
    >
      Save
    </PtButton>
    </section>
  </section>
</template>

<style scoped>
.config {
  max-width: 40rem;
  padding: 1rem 1.25rem 4rem;
  color: var(--fg);
}

.block {
  margin: 0 0 1rem;
  padding: 1rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

h2,
h3 {
  margin: 0 0 0.75rem;
  font-size: 1.25rem;
  font-weight: 700;
}

h3 {
  margin-top: 0;
  font-size: 0.9375rem;
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
}

input,
select,
button {
  font: inherit;
  color: var(--fg);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.5rem 0.75rem;
}

button {
  color: var(--accent);
  cursor: pointer;
}

button.primary {
  color: var(--bg);
  background: var(--accent);
  border-color: var(--accent);
}

button:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
