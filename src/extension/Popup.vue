<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import ProjectTree from "../app/components/ProjectTree.vue";
import PtButton from "../app/components/PtButton.vue";
import PtField from "../app/components/PtField.vue";
import {
  captureApi,
  CaptureHttpError,
  type CaptureClient,
  type MeBody,
} from "../lib/capture-http.ts";
import { parseOrigin } from "../lib/capture.ts";

type ProjectRow = { id: string; parent_id: string | null; name: string };

const screen = ref<"sign-in" | "ready">("sign-in");
const originInput = ref("");
const tokenInput = ref("");
const client = ref<CaptureClient | null>(null);
const me = ref<MeBody | null>(null);
const workspaceId = ref("");
const projects = ref<ProjectRow[]>([]);
const selectedId = ref<string | null>(null);
const newProjectName = ref("");
const nodeType = ref<"note" | "research">("note");
const sentence = ref("");
const refId = ref("");
const wantShot = ref(true);
const status = ref("");
const statusTone = ref<"muted" | "danger">("muted");
const filing = ref(false);

const memberships = computed(() => me.value?.memberships ?? []);

const rootId = computed(
  () => projects.value.find((p) => p.parent_id == null)?.id ?? null,
);

const attachProjectId = computed(
  () => selectedId.value ?? rootId.value,
);

const canFile = computed(
  () => sentence.value.trim().length > 0 && attachProjectId.value != null,
);

function setStatus(text: string, tone: "muted" | "danger" = "muted"): void {
  status.value = text;
  statusTone.value = tone;
}

function fail(err: unknown, prefix = "Could not file"): void {
  if (err instanceof CaptureHttpError) {
    setStatus(`${prefix} ${err.status}`, "danger");
    return;
  }
  setStatus(prefix, "danger");
}

async function afterMe(api: CaptureClient, body: MeBody): Promise<void> {
  me.value = body;
  const rows = body.memberships ?? [];
  let ws = body.workspace_id;
  if (!ws && rows.length === 1) {
    const only = rows[0]!.workspace_id;
    me.value = await api.patchMe(only);
    ws = me.value.workspace_id ?? only;
  }
  workspaceId.value = ws ?? "";
  selectedId.value = null;
  if (workspaceId.value) await loadProjects(api, workspaceId.value);
  else projects.value = [];
}

async function loadProjects(api: CaptureClient, ws: string): Promise<void> {
  const listed = await api.listProjects(ws);
  projects.value = listed.projects;
}

async function boot(): Promise<void> {
  const stored = await chrome.storage.local.get(["origin", "token"]);
  const origin = parseOrigin(stored.origin ?? "");
  const token = stored.token?.trim() ?? "";
  if (origin) originInput.value = origin;
  if (token) tokenInput.value = token;
  if (!origin || !token) {
    screen.value = "sign-in";
    return;
  }
  try {
    const api = captureApi({ origin, token });
    const body = await api.getMe();
    client.value = api;
    await afterMe(api, body);
    screen.value = "ready";
    setStatus("");
  } catch (err) {
    if (err instanceof CaptureHttpError && err.status === 401) {
      screen.value = "sign-in";
      setStatus("Could not sign in 401", "danger");
      return;
    }
    screen.value = "sign-in";
    fail(err, "Could not sign in");
  }
}

async function saveSession(): Promise<void> {
  const origin = parseOrigin(originInput.value);
  if (!origin) {
    setStatus("Need an http(s) origin", "danger");
    return;
  }
  const token = tokenInput.value.trim();
  if (!token) {
    setStatus("Need a session token", "danger");
    return;
  }
  const granted = await chrome.permissions.request({
    origins: [`${origin}/*`],
  });
  if (!granted) {
    setStatus("host permission denied", "danger");
    return;
  }
  try {
    const api = captureApi({ origin, token });
    const body = await api.getMe();
    await chrome.storage.local.set({ origin, token });
    originInput.value = origin;
    tokenInput.value = token;
    client.value = api;
    await afterMe(api, body);
    screen.value = "ready";
    setStatus("");
  } catch (err) {
    fail(err, "Could not sign in");
  }
}

async function signOut(): Promise<void> {
  await chrome.storage.local.remove(["origin", "token"]);
  client.value = null;
  me.value = null;
  workspaceId.value = "";
  projects.value = [];
  selectedId.value = null;
  screen.value = "sign-in";
  setStatus("");
}

async function onWorkspaceChange(id: string): Promise<void> {
  const api = client.value;
  if (!api || !id) return;
  try {
    const body = await api.patchMe(id);
    await afterMe(api, body);
  } catch (err) {
    fail(err, "Could not bind workspace");
  }
}

async function createProject(): Promise<void> {
  const api = client.value;
  const name = newProjectName.value.trim();
  const parent = attachProjectId.value;
  if (!api || !workspaceId.value || !name || !parent) return;
  try {
    const created = await api.createProject(workspaceId.value, {
      name,
      parent_id: parent,
    });
    newProjectName.value = "";
    await loadProjects(api, workspaceId.value);
    selectedId.value = created.project.id;
  } catch (err) {
    fail(err, "Could not create");
  }
}

async function fileReportUi(): Promise<void> {}

onMounted(() => {
  void boot();
});
</script>

<template>
  <main class="shell">
    <header class="head">
      <h1>ProjThread</h1>
      <PtButton
        v-if="screen === 'ready'"
        variant="compact"
        type="button"
        @click="signOut"
      >
        Sign out
      </PtButton>
    </header>

    <form v-if="screen === 'sign-in'" class="stack" @submit.prevent="saveSession">
      <p class="hint">Admin → Issue token</p>
      <PtField
        v-model="originInput"
        label="Origin"
        name="origin"
        required
        placeholder="http://127.0.0.1:8787"
      />
      <PtField
        v-model="tokenInput"
        label="Token"
        name="token"
        required
        autocomplete="off"
      />
      <PtButton variant="primary" type="submit">Save</PtButton>
    </form>

    <div v-else class="stack">
      <p v-if="me" class="hint">{{ me.principal.display_name }}</p>
      <label v-if="memberships.length > 1" class="field">
        <span class="hint">Workspace</span>
        <PtField
          as="select"
          :model-value="workspaceId"
          label="Workspace"
          name="workspace"
          @update:model-value="onWorkspaceChange(String($event))"
        >
          <option v-if="!workspaceId" value="">Select</option>
          <option
            v-for="row in memberships"
            :key="row.workspace_id"
            :value="row.workspace_id"
          >
            {{ row.workspace_name }}
          </option>
        </PtField>
      </label>

      <ProjectTree
        :projects="projects"
        :selected-id="selectedId"
        @select="selectedId = $event"
      />

      <div class="row">
        <PtField
          v-model="newProjectName"
          label="New project"
          name="project-name"
          placeholder="Name"
        />
        <PtButton
          type="button"
          :disabled="!newProjectName.trim() || !attachProjectId"
          @click="createProject"
        >
          Create
        </PtButton>
      </div>

      <PtField as="select" v-model="nodeType" label="Type" name="type">
        <option value="note">note</option>
        <option value="research">research</option>
      </PtField>

      <PtField
        as="textarea"
        v-model="sentence"
        label="Sentence"
        name="sentence"
        required
      />

      <PtField
        v-model="refId"
        label="Ref"
        name="ref"
        placeholder="optional node id"
      />

      <label class="check">
        <input v-model="wantShot" type="checkbox" />
        Screenshot
      </label>

      <PtButton
        variant="primary"
        type="button"
        :disabled="!canFile || filing"
        @click="fileReportUi"
      >
        File
      </PtButton>
    </div>

    <p v-if="status" class="status" :class="statusTone">{{ status }}</p>
  </main>
</template>

<style>
html,
body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font-family: var(--font);
}
.shell {
  box-sizing: border-box;
  width: 22rem;
  padding: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}
h1 {
  font-size: 1rem;
  font-weight: 600;
  margin: 0;
}
.stack {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.row {
  display: flex;
  gap: 0.5rem;
  align-items: stretch;
}
.row input {
  min-width: 0;
  flex: 1;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.hint {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--muted);
}
.check {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  color: var(--fg);
}
.status {
  margin: 0;
  font-size: 0.8125rem;
}
.status.muted {
  color: var(--muted);
}
.status.danger {
  color: var(--danger);
}
</style>
