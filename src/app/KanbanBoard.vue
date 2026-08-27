<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute } from "vue-router";
import Modal from "./Modal.vue";
import { useBoardStore, type WorkItem } from "./stores/board.ts";

const route = useRoute();
const board = useBoardStore();
const draft = ref("");
const addOpen = ref(false);
const moveReason = ref("");
const pendingMove = ref<{ item: WorkItem; to: string } | null>(null);

function queryString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

watch(
  () => [queryString(route.query.workspace), queryString(route.query.project)],
  ([workspace, project]) => {
    if (workspace && project) {
      void board.loadBoard(workspace, project);
    }
  },
  { immediate: true },
);

const columns = computed(() =>
  [...board.stages].sort((a, b) => a.position - b.position),
);

function itemsFor(stageKey: string): WorkItem[] {
  return board.items.filter((item) => item.stage_key === stageKey);
}

function openAdd(): void {
  draft.value = "";
  addOpen.value = true;
}

function cancelAdd(): void {
  addOpen.value = false;
  draft.value = "";
}

async function submit(): Promise<void> {
  const title = draft.value.trim();
  if (!title) return;
  await board.createCard(title);
  if (board.status === "error") return;
  cancelAdd();
}

function openMove(item: WorkItem): void {
  pendingMove.value = { item, to: item.stage_key };
  moveReason.value = "";
}

function cancelMove(): void {
  pendingMove.value = null;
  moveReason.value = "";
}

async function confirmMove(): Promise<void> {
  const pending = pendingMove.value;
  if (!pending || !moveReason.value.trim()) return;
  if (pending.to !== pending.item.stage_key) {
    await board.moveCard(pending.item.id, pending.to, moveReason.value);
    if (board.status === "error") return;
  }
  cancelMove();
}
</script>

<template>
  <Modal
    :open="addOpen"
    title="Add card"
    labelled-by="add-card-title"
    @close="cancelAdd"
  >
    <form class="form" @submit.prevent="submit">
      <input
        v-model="draft"
        type="text"
        name="title"
        aria-label="New card title"
      />
      <button type="submit" class="primary">Add</button>
      <button type="button" @click="cancelAdd">Cancel</button>
    </form>
  </Modal>
  <Modal
    :open="pendingMove !== null"
    title="Move reason"
    labelled-by="move-reason-title"
    @close="cancelMove"
  >
    <form class="form" @submit.prevent="confirmMove">
      <select
        v-if="pendingMove"
        v-model="pendingMove.to"
        aria-label="Stage"
      >
        <option
          v-for="option in columns"
          :key="option.key"
          :value="option.key"
        >
          {{ option.label }}
        </option>
      </select>
      <input
        v-model="moveReason"
        type="text"
        aria-label="Move reason"
        required
      />
      <button type="submit" class="primary">Move</button>
      <button type="button" @click="cancelMove">Cancel</button>
    </form>
  </Modal>
  <div class="board">
    <section v-for="stage in columns" :key="stage.key" class="column">
      <h2>{{ stage.label }}</h2>
      <button
        v-if="stage.key === 'backlog'"
        type="button"
        class="composer primary"
        @click="openAdd"
      >
        Add
      </button>
      <article
        v-for="item in itemsFor(stage.key)"
        :key="item.id"
        class="card"
      >
        <router-link :to="{ query: { ...route.query, item: item.id } }">
          {{ item.title }}
        </router-link>
        <button type="button" class="move" @click="openMove(item)">
          Move
        </button>
      </article>
    </section>
  </div>
</template>

<style scoped>
.board {
  display: flex;
  gap: 0.75rem;
  align-items: stretch;
  height: 100%;
  min-height: 0;
  padding: 1rem;
  overflow-x: auto;
}

.column {
  flex: 1 1 16rem;
  min-width: 16rem;
  min-height: 100%;
  padding: 0.75rem;
  border-right: 1px solid var(--border);
  border-radius: 0;
  background: transparent;
}

.column:last-child {
  border-right: none;
}

h2 {
  margin: 0 0 0.75rem;
  font-size: 0.8125rem;
  color: var(--muted);
  font-weight: 700;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}

.composer {
  display: flex;
  margin-bottom: 0.75rem;
}

.form {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

select,
input,
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

.card {
  display: flex;
  gap: 0.5rem;
  align-items: baseline;
  justify-content: space-between;
  color: inherit;
  margin: 0 0 0.5rem;
  padding: 0.75rem;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--surface);
}

.card:hover {
  box-shadow: var(--shadow);
}

.card a {
  color: inherit;
  text-decoration: none;
  flex: 1;
  min-width: 0;
}

.move {
  flex: 0 0 auto;
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
  background: transparent;
}
</style>
