<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { useBoardStore, type WorkItem } from "./stores/board.ts";

const route = useRoute();
const board = useBoardStore();
const draft = ref("");

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

async function submit(): Promise<void> {
  const title = draft.value.trim();
  if (!title) return;
  await board.createCard(title);
  draft.value = "";
}
</script>

<template>
  <p v-if="board.status === 'error'" class="error">Could not load board</p>
  <div class="board">
    <section v-for="stage in columns" :key="stage.key" class="column">
      <h2>{{ stage.label }}</h2>
      <form v-if="stage.key === 'backlog'" class="composer" @submit.prevent="submit">
        <input v-model="draft" type="text" name="title" aria-label="New card title" />
        <button type="submit">Add</button>
      </form>
      <article v-for="item in itemsFor(stage.key)" :key="item.id" class="card">
        {{ item.title }}
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
  margin: 0 0 0.5rem;
  padding: 0.6rem 0.7rem;
  border-radius: var(--radius);
  border: 1px solid var(--muted);
}

.error {
  margin: 0 0 1rem;
  color: var(--danger);
}
</style>
