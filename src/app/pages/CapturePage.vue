<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import ProjectTree from "../components/ProjectTree.vue";
import PtButton from "../components/PtButton.vue";
import PtField from "../components/PtField.vue";
import { parseShareId } from "../../lib/share-target.ts";
import { useCaptureStore } from "../stores/capture.ts";
import { useSessionStore } from "../stores/session.ts";

const session = useSessionStore();
const capture = useCaptureStore();
const route = useRoute();
const router = useRouter();
const newProjectName = ref("");

const canFile = computed(
  () =>
    capture.sentence.trim().length > 0 &&
    capture.attachProjectId != null &&
    Boolean(session.workspaceId) &&
    !capture.filing,
);

async function bootFromQuery(): Promise<void> {
  const share = parseShareId(String(route.query.share ?? ""));
  if (share) {
    await capture.consumeShare(share);
  } else if (route.query.title || route.query.text || route.query.url) {
    capture.applyFields({
      title: String(route.query.title ?? ""),
      text: String(route.query.text ?? ""),
      url: String(route.query.url ?? ""),
    });
  }
  if (route.query.share || route.query.title || route.query.text || route.query.url) {
    await router.replace({ name: "capture" });
  }
}

onMounted(() => {
  void bootFromQuery();
});

watch(
  () => session.workspaceId,
  (id) => {
    if (id) void capture.loadProjects(id);
  },
  { immediate: true },
);

async function onCreateProject(): Promise<void> {
  const ws = session.workspaceId;
  const parent = capture.attachProjectId;
  if (!ws || !parent) return;
  await capture.createProject(ws, newProjectName.value, parent);
  newProjectName.value = "";
}

async function onFile(): Promise<void> {
  const ws = session.workspaceId;
  const projectId = capture.attachProjectId;
  if (!ws || !projectId) return;
  await capture.file(ws, projectId);
}
</script>

<template>
  <section class="capture">
    <h1>Capture</h1>
    <p class="hint">Share lands here. Point a project, edit the sentence, file.</p>
    <ProjectTree
      :projects="capture.projects"
      :selected-id="capture.selectedId"
      @select="capture.selectedId = $event"
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
        :disabled="!newProjectName.trim() || !capture.attachProjectId"
        @click="onCreateProject"
      >
        Create
      </PtButton>
    </div>
    <PtField as="select" v-model="capture.nodeType" label="Type" name="type">
      <option value="note">note</option>
      <option value="research">research</option>
    </PtField>
    <PtField
      as="textarea"
      v-model="capture.sentence"
      label="Sentence"
      name="sentence"
      required
    />
    <PtField
      v-model="capture.refId"
      label="Ref"
      name="ref"
      placeholder="optional node id"
    />
    <p v-if="capture.files.length" class="hint">
      {{ capture.files.length }} image{{ capture.files.length === 1 ? "" : "s" }} from share
    </p>
    <PtButton
      variant="primary"
      type="button"
      :disabled="!canFile"
      @click="onFile"
    >
      File
    </PtButton>
    <p
      v-if="capture.message"
      class="status"
      :class="capture.status === 'error' ? 'danger' : 'muted'"
    >
      {{ capture.message }}
    </p>
  </section>
</template>

<style scoped>
.capture {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  max-width: 32rem;
  padding: 1rem 1.25rem 2rem;
  color: var(--fg);
  font-family: var(--font);
}
h1 {
  margin: 0;
  font-size: 1.25rem;
}
.hint,
.status {
  margin: 0;
  font-size: 0.8125rem;
}
.hint,
.status.muted {
  color: var(--muted);
}
.status.danger {
  color: var(--danger);
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
</style>
