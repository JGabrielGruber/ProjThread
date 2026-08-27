<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useRoomStore } from "./stores/room.ts";

const route = useRoute();
const router = useRouter();
const room = useRoomStore();
const draft = ref("");

function queryString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

const itemId = computed(() => queryString(route.query.item));

watch(
  itemId,
  (id) => {
    if (id) void room.open(id);
  },
  { immediate: true },
);

onUnmounted(() => {
  room.close();
});

const lines = computed(() =>
  [...room.lines].sort((a, b) => a.seq - b.seq),
);

async function back(): Promise<void> {
  const query = { ...route.query };
  delete query.item;
  await router.replace({ query });
}

function submit(): void {
  const body = draft.value.trim();
  if (!body) return;
  room.send(body);
  draft.value = "";
}
</script>

<template>
  <section class="room">
    <header>
      <button type="button" class="back" @click="back">Back</button>
      <h2>{{ room.item?.title }}</h2>
      <p class="stage">{{ room.item?.stage_key }}</p>
    </header>
    <p v-if="room.status === 'loading'" class="muted">Connecting</p>
    <p v-else-if="room.status === 'error'" class="error">Could not open room</p>
    <p v-else-if="room.status === 'no_session'">No session</p>
    <ol class="tape">
      <li v-for="line in lines" :key="line.seq" class="line">
        {{ line.body }}
      </li>
    </ol>
    <form class="composer" @submit.prevent="submit">
      <input
        v-model="draft"
        type="text"
        name="body"
        aria-label="Chat message"
        :disabled="room.status !== 'ready'"
      />
      <button type="submit" :disabled="room.status !== 'ready'">Send</button>
    </form>
  </section>
</template>

<style scoped>
.room {
  color: var(--fg);
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
  font-size: 1.1rem;
}

.stage,
.muted {
  margin: 0;
  color: var(--muted);
  font-size: 0.9rem;
}

.back,
input,
button {
  font: inherit;
  color: var(--fg);
  background: var(--bg);
  border: 1px solid var(--muted);
  border-radius: var(--radius);
  padding: 0.35rem 0.5rem;
}

.back,
button {
  color: var(--accent);
  cursor: pointer;
}

.error {
  color: var(--danger);
}

.tape {
  list-style: none;
  margin: 0 0 1rem;
  padding: 0;
  color: var(--fg);
}

.line {
  margin: 0 0 0.5rem;
}

.composer {
  display: flex;
  gap: 0.5rem;
}

input,
button {
  font: inherit;
}
</style>
