<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import Modal from "./Modal.vue";
import { renderMarkdown } from "./markdown.ts";
import { useWikiStore } from "./stores/wiki.ts";

const NODE_TYPES = ["note", "decision", "process", "research"] as const;

const route = useRoute();
const router = useRouter();
const wiki = useWikiStore();

const editing = ref(false);
const createOpen = ref(false);
const draftTitle = ref("");
const draftType = ref<(typeof NODE_TYPES)[number]>("note");
const draftContent = ref("");
const linkId = ref("");

function queryString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

const workspaceId = computed(() => queryString(route.query.workspace));
const nodeId = computed(() => queryString(route.query.node));

watch(
  [workspaceId, nodeId],
  ([workspace, node]) => {
    if (workspace) void wiki.loadList(workspace);
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

async function openNode(id: string): Promise<void> {
  const query = { ...route.query, node: id };
  delete query.item;
  await router.replace({ query });
}

async function back(): Promise<void> {
  const query = { ...route.query, wiki: "1" };
  delete query.node;
  await router.replace({ query });
}

function openCreate(): void {
  draftTitle.value = "";
  draftType.value = "note";
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
    work_item_id?: string;
  } = {
    title,
    type: draftType.value,
    content: draftContent.value,
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

async function togglePin(id: string, pinned: number): Promise<void> {
  if (wiki.status !== "ready") return;
  await wiki.setPinned(id, pinned !== 1);
}
</script>

<template>
  <section class="wiki" :class="{ 'is-edit': editing }">
    <header>
      <button v-if="nodeId" type="button" class="back" @click="back">Back</button>
      <h2>{{ wiki.node?.title ?? "Wiki" }}</h2>
    </header>
    <template v-if="!nodeId">
      <ul class="list">
        <li
          v-for="row in wiki.nodes"
          :key="row.id"
          :class="{ 'is-pinned': row.pinned === 1 }"
        >
          <button type="button" class="title" @click="openNode(row.id)">
            {{ row.title }}
          </button>
          <span class="muted">{{ row.type }}</span>
          <button
            type="button"
            class="pin"
            :aria-pressed="row.pinned === 1"
            :aria-label="row.pinned === 1 ? 'Unpin' : 'Pin'"
            :disabled="wiki.status !== 'ready'"
            @click="togglePin(row.id, row.pinned)"
          >
            {{ row.pinned === 1 ? "Unpin" : "Pin" }}
          </button>
        </li>
      </ul>
      <button
        type="button"
        class="primary compact"
        :disabled="wiki.status !== 'ready'"
        @click="openCreate"
      >
        Create
      </button>
      <Modal
        :open="createOpen"
        title="Create node"
        labelled-by="wiki-create-title"
        @close="cancelCreate"
      >
        <form class="form" @submit.prevent="create">
          <input v-model="draftTitle" type="text" aria-label="Title" />
          <select v-model="draftType" aria-label="Type">
            <option v-for="type in NODE_TYPES" :key="type" :value="type">
              {{ type }}
            </option>
          </select>
          <textarea v-model="draftContent" aria-label="Content" />
          <input
            v-model="linkId"
            type="text"
            aria-label="Work item id"
          />
          <button type="submit" class="primary" :disabled="wiki.status !== 'ready'">Create</button>
          <button type="button" @click="cancelCreate">Cancel</button>
        </form>
      </Modal>
    </template>

    <template v-else-if="wiki.node">
      <template v-if="!editing">
        <article class="wiki-read" v-html="rendered" />
        <button type="button" class="primary compact" :disabled="wiki.status !== 'ready'" @click="startEdit">
          Edit
        </button>
        <form class="link" @submit.prevent="link">
          <input
            v-model="linkId"
            type="text"
            aria-label="Work item id"
          />
          <button type="submit" :disabled="wiki.status !== 'ready'">Link</button>
        </form>
        <p class="muted">{{ wiki.workItemIds.join(", ") }}</p>
      </template>
      <div v-else class="wiki-edit">
        <div class="row">
          <input v-model="draftTitle" type="text" aria-label="Title" />
          <select v-model="draftType" aria-label="Type">
            <option v-for="type in NODE_TYPES" :key="type" :value="type">
              {{ type }}
            </option>
          </select>
        </div>
        <textarea
          v-model="draftContent"
          class="source"
          aria-label="Source"
        />
        <div class="actions">
          <button type="button" class="primary" :disabled="wiki.status !== 'ready'" @click="save">
            Save
          </button>
          <button type="button" @click="editing = false">Read</button>
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

.list li.is-pinned .title {
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

.link input {
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

.row input {
  flex: 1 1 12rem;
}

.source {
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
