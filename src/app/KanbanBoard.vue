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

async function onStage(item: WorkItem, event: Event): Promise<void> {
  const select = event.target as HTMLSelectElement;
  const to = select.value;
  select.value = item.stage_key;
  if (to === item.stage_key) return;
  pendingMove.value = { item, to };
  moveReason.value = "";
}

function cancelMove(): void {
  pendingMove.value = null;
  moveReason.value = "";
}

async function confirmMove(): Promise<void> {
  const pending = pendingMove.value;
  if (!pending || !moveReason.value.trim()) return;
  await board.moveCard(pending.item.id, pending.to, moveReason.value);
  if (board.status === "error") return;
  cancelMove();
}
</script>

<template>
  <p v-if="board.status === 'error'" class="error">Could not load board</p>
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
      <button type="submit">Add</button>
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
      <input
        v-model="moveReason"
        type="text"
        aria-label="Move reason"
      />
      <button type="submit">Move</button>
      <button type="button" @click="cancelMove">Cancel</button>
    </form>
  </Modal>
  <div class="board">
    <section v-for="stage in columns" :key="stage.key" class="column">
      <h2>{{ stage.label }}</h2>
      <button
        v-if="stage.key === 'backlog'"
        type="button"
        class="composer"
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
        <select
          aria-label="Stage"
          :value="item.stage_key"
          @change="onStage(item, $event)"
        >
          <option
            v-for="option in columns"
            :key="option.key"
            :value="option.key"
          >
            {{ option.label }}
          </option>
        </select>
      </article>
    </section>
  </div>
</template>

<style scoped>
.board {
  display: flex;
  gap: 1rem;
  align-items: flex-start;
  overflow-x: auto;
}

.column {
  flex: 1 1 12rem;
  min-width: 12rem;
  padding: 0.75rem;
  border: 1px solid var(--muted);
  border-radius: var(--radius);
  background: var(--bg);
}

h2 {
  margin: 0 0 0.75rem;
  font-size: 0.95rem;
  color: var(--muted);
  font-weight: 600;
}

.composer {
  display: flex;
  gap: 0.5rem;
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
  border: 1px solid var(--muted);
  border-radius: var(--radius);
  padding: 0.35rem 0.5rem;
}

button {
  color: var(--accent);
  cursor: pointer;
}

.card {
  display: block;
  color: inherit;
  margin: 0 0 0.5rem;
  padding: 0.6rem 0.7rem;
  border-radius: var(--radius);
  border: 1px solid var(--muted);
}

.card a {
  color: inherit;
  text-decoration: none;
  display: block;
  margin-bottom: 0.4rem;
}

.error {
  margin: 0 0 1rem;
  color: var(--danger);
}
</style>
