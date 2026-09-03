<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import Modal from "../components/Modal.vue";
import PtButton from "../components/PtButton.vue";
import PtField from "../components/PtField.vue";
import PtListRow from "../components/PtListRow.vue";
import { renderMarkdown } from "../markdown.ts";
import { useBoardStore } from "../stores/board.ts";
import { useSessionStore } from "../stores/session.ts";
import { useWikiStore } from "../stores/wiki.ts";

const NODE_TYPES = ["note", "decision", "process", "research"] as const;
const PAYLOAD_KINDS = ["markdown", "json"] as const;

const route = useRoute();
const router = useRouter();
const session = useSessionStore();
const board = useBoardStore();
const wiki = useWikiStore();

const editing = ref(false);
const createOpen = ref(false);
const draftTitle = ref("");
const draftType = ref<(typeof NODE_TYPES)[number]>("note");
const draftKind = ref<(typeof PAYLOAD_KINDS)[number]>("markdown");
const draftContent = ref("");
const linkId = ref("");
const includeId = ref("");
const citeId = ref("");

function queryString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

const workspaceId = computed(() => session.workspaceId);
const nodeId = computed(() => queryString(route.query.node));

watch(
  [workspaceId, nodeId, () => board.filterProjectId],
  ([workspace, node, projectId]) => {
    if (workspace) void wiki.loadList(workspace, projectId);
    if (node) {
      editing.value = false;
      void wiki.openNode(node);
    }
  },
  { immediate: true },
);

const rendered = computed(() =>
  renderMarkdown(wiki.node?.content ?? ""),
);

const jsonPretty = computed(() => {
  const raw = wiki.node?.content ?? "";
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
});

async function openNode(id: string): Promise<void> {
  await router.replace({ name: "wiki", query: { node: id } });
}

async function back(): Promise<void> {
  await router.replace({ name: "wiki" });
}

function openCreate(): void {
  draftTitle.value = "";
  draftType.value = "note";
  draftKind.value = "markdown";
  draftContent.value = "";
  linkId.value = "";
  createOpen.value = true;
}

function cancelCreate(): void {
  createOpen.value = false;
}

async function create(): Promise<void> {
  if (wiki.status !== "ready") return;
  const title = draftTitle.value.trim();
  if (!title) return;
  const input: {
    title: string;
    type: string;
    content: string;
    payload_kind: "markdown" | "json";
    work_item_id?: string;
  } = {
    title,
    type: draftType.value,
    content: draftContent.value,
    payload_kind: draftKind.value,
  };
  const workItemId = linkId.value.trim();
  if (workItemId) input.work_item_id = workItemId;
  await wiki.createNode(input);
  draftTitle.value = "";
  draftContent.value = "";
  linkId.value = "";
  createOpen.value = false;
  if (wiki.node) await openNode(wiki.node.id);
}

function startEdit(): void {
  if (!wiki.node) return;
  draftTitle.value = wiki.node.title;
  draftType.value = NODE_TYPES.includes(wiki.node.type as (typeof NODE_TYPES)[number])
    ? (wiki.node.type as (typeof NODE_TYPES)[number])
    : "note";
  draftContent.value = wiki.node.content ?? "";
  editing.value = true;
}

async function save(): Promise<void> {
  if (wiki.status !== "ready" || !wiki.node) return;
  wiki.node.title = draftTitle.value;
  wiki.node.type = draftType.value;
  wiki.node.content = draftContent.value;
  await wiki.saveNode();
  editing.value = false;
}

async function link(): Promise<void> {
  if (wiki.status !== "ready") return;
  const id = linkId.value.trim();
  if (!id) return;
  await wiki.linkWorkItem(id);
  linkId.value = "";
}

async function include(): Promise<void> {
  const id = includeId.value.trim();
  if (!id) return;
  await wiki.includeChild(id);
  includeId.value = "";
}

async function cite(): Promise<void> {
  const id = citeId.value.trim();
  if (!id) return;
  await wiki.citeNode(id);
  citeId.value = "";
}

async function togglePin(id: string, pinned: number): Promise<void> {
  if (wiki.status !== "ready") return;
  await wiki.setPinned(id, pinned !== 1);
}
</script>

<template>
  <section class="wiki" :class="{ 'is-edit': editing }">
    <header>
      <PtButton v-if="nodeId" type="button" class="back" @click="back">Back</PtButton>
      <h2>{{ wiki.node?.title ?? "Wiki" }}</h2>
    </header>
    <template v-if="!nodeId">
      <ul class="list">
        <PtListRow
          v-for="row in wiki.nodes"
          :key="row.id"
          :class="{ 'is-pinned': row.pinned === 1 }"
        >
          <button type="button" class="title" @click="openNode(row.id)">
            {{ row.title }}
          </button>
          <template #meta>
            <span class="muted">{{ row.type }}</span>
            <span v-if="row.payload_kind !== 'markdown'" class="muted">{{
              row.payload_kind
            }}</span>
            <PtButton
              type="button"
              variant="compact"
              class="pin"
              :aria-pressed="row.pinned === 1"
              :aria-label="row.pinned === 1 ? 'Unpin' : 'Pin'"
              :disabled="wiki.status !== 'ready'"
              @click="togglePin(row.id, row.pinned)"
            >
              {{ row.pinned === 1 ? "Unpin" : "Pin" }}
            </PtButton>
          </template>
        </PtListRow>
      </ul>
      <PtButton
        type="button"
        variant="primary"
        class="compact"
        :disabled="wiki.status !== 'ready'"
        @click="openCreate"
      >
        Create
      </PtButton>
      <Modal
        :open="createOpen"
        title="Create node"
        labelled-by="wiki-create-title"
        @close="cancelCreate"
      >
        <form class="form" @submit.prevent="create">
          <PtField v-model="draftTitle" type="text" label="Title" />
          <PtField v-model="draftType" as="select" label="Type">
            <option v-for="type in NODE_TYPES" :key="type" :value="type">
              {{ type }}
            </option>
          </PtField>
          <PtField v-model="draftKind" as="select" label="Kind">
            <option v-for="kind in PAYLOAD_KINDS" :key="kind" :value="kind">
              {{ kind }}
            </option>
          </PtField>
          <PtField v-model="draftContent" as="textarea" label="Content" />
          <PtField v-model="linkId" type="text" label="Work item id" />
          <PtButton type="submit" variant="primary" :disabled="wiki.status !== 'ready'">Create</PtButton>
          <PtButton type="button" @click="cancelCreate">Cancel</PtButton>
        </form>
      </Modal>
    </template>

    <template v-else-if="wiki.node">
      <template v-if="!editing">
        <pre
          v-if="wiki.node.payload_kind === 'json'"
          class="wiki-json"
        >{{ jsonPretty }}</pre>
        <article v-else class="wiki-read" v-html="rendered" />
        <PtButton type="button" variant="primary" class="compact" :disabled="wiki.status !== 'ready'" @click="startEdit">
          Edit
        </PtButton>
        <form class="link" @submit.prevent="link">
          <PtField v-model="linkId" type="text" label="Work item id" />
          <PtButton type="submit" :disabled="wiki.status !== 'ready'">Link</PtButton>
        </form>
        <p class="muted">{{ wiki.workItemIds.join(", ") }}</p>
        <h3>Includes</h3>
        <ul>
          <li v-for="row in wiki.includes" :key="row.id">
            <button type="button" class="title" @click="openNode(row.id)">
              {{ row.title }}
            </button>
          </li>
        </ul>
        <form class="link" @submit.prevent="include">
          <PtField v-model="includeId" type="text" label="Child node id" />
          <PtButton type="submit" :disabled="wiki.status !== 'ready'">Include</PtButton>
        </form>
        <h3>Cites</h3>
        <ul>
          <li v-for="row in wiki.refs" :key="row.id">
            <button type="button" class="title" @click="openNode(row.id)">
              {{ row.title }}
            </button>
          </li>
        </ul>
        <form class="link" @submit.prevent="cite">
          <PtField v-model="citeId" type="text" label="Cite node id" />
          <PtButton type="submit" :disabled="wiki.status !== 'ready'">Cite</PtButton>
        </form>
      </template>
      <div v-else class="wiki-edit">
        <div class="row">
          <PtField v-model="draftTitle" type="text" label="Title" />
          <PtField v-model="draftType" as="select" label="Type">
            <option v-for="type in NODE_TYPES" :key="type" :value="type">
              {{ type }}
            </option>
          </PtField>
        </div>
        <PtField
          v-model="draftContent"
          as="textarea"
          class="source"
          label="Source"
        />
        <div class="actions">
          <PtButton type="button" variant="primary" :disabled="wiki.status !== 'ready'" @click="save">
            Save
          </PtButton>
          <PtButton type="button" @click="editing = false">Read</PtButton>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.wiki {
  display: flex;
  flex-direction: column;
  min-height: 100%;
  height: 100%;
  max-width: var(--measure);
  padding: 1rem 1.25rem 4rem;
  color: var(--fg);
}

.wiki.is-edit {
  max-width: none;
  padding-bottom: 1rem;
  overflow: hidden;
}

header {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: baseline;
  margin-bottom: 1rem;
}

h2 {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 700;
}

.muted {
  margin: 0;
  color: var(--muted);
  font-size: 0.8125rem;
}

.list {
  list-style: none;
  margin: 0 0 1rem;
  padding: 0;
}

.list li {
  display: flex;
  gap: 0.75rem;
  align-items: baseline;
  margin: 0;
  padding: 0.75rem 0;
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--border);
  border-radius: 0;
}

.list .pin {
  margin-left: auto;
  font-size: 0.8125rem;
}

.list :deep(.is-pinned .title) {
  font-weight: 600;
}

.form {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  max-width: 40rem;
  margin: 1rem 0;
}

.link {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
  width: 100%;
  margin: 1rem 0 0;
}

.link :deep(input) {
  flex: 1 1 12rem;
}

.wiki-read {
  max-width: var(--measure);
  line-height: 1.65;
  margin: 0 0 1rem;
  padding: 0;
  background: transparent;
  border: none;
}

.wiki-json {
  max-width: var(--measure);
  margin: 0 0 1rem;
  padding: 0.75rem;
  overflow: auto;
  font-family: var(--font-mono);
  font-size: 0.875rem;
  line-height: 1.5;
  color: var(--fg);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  white-space: pre-wrap;
}

.wiki-read :deep(a) {
  color: var(--accent);
}

.wiki-edit {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  flex: 1;
  min-height: 0;
  padding: 0.75rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

.row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.row :deep(input) {
  flex: 1 1 12rem;
}

.wiki-edit :deep(.source) {
  flex: 1;
  min-height: 12rem;
}

.actions {
  display: flex;
  gap: 0.5rem;
}

input,
select,
textarea,
button {
  font: inherit;
  color: var(--fg);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.5rem 0.75rem;
}

.form textarea {
  min-height: 8rem;
}

button,
.title {
  color: var(--accent);
  cursor: pointer;
}

.title {
  background: none;
  border: none;
  padding: 0;
  text-align: left;
  font-size: 1rem;
  color: var(--fg);
}

.title:hover {
  color: var(--accent);
}

.back {
  background: transparent;
  border: none;
  padding: 0.5rem 0;
}

button.primary {
  color: var(--bg);
  background: var(--accent);
  border-color: var(--accent);
}

button.compact,
.wiki > button {
  align-self: flex-start;
  width: auto;
}

button:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
