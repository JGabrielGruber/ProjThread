<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useRoomStore } from "./stores/room.ts";

const route = useRoute();
const router = useRouter();
const room = useRoomStore();
const draft = ref("");
const activityType = ref<"note" | "decision" | "occurrence">("note");
const activityBody = ref("");

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

function eventFor(eventId: string | null) {
  if (!eventId) return undefined;
  return room.events.find((row) => row.id === eventId);
}

function submit(): void {
  const body = draft.value.trim();
  if (!body) return;
  room.send(body);
  draft.value = "";
}

async function submitActivity(): Promise<void> {
  const body = activityBody.value;
  if (body.trim() === "") return;
  await room.postEvent({ type: activityType.value, body });
  activityBody.value = "";
}

function toggleActivityOnly(): void {
  room.activityOnly = !room.activityOnly;
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
    <button type="button" class="toggle" @click="toggleActivityOnly">
      Activity only
    </button>
    <ol v-if="room.activityOnly" class="tape">
      <li v-for="event in room.events" :key="event.id" class="line">
        <span>{{ event.type }}</span>
        <span v-if="event.body"> {{ event.body }}</span>
        <span v-if="event.from_value || event.to_value" class="muted">
          {{ event.from_value }} → {{ event.to_value }}
        </span>
      </li>
    </ol>
    <ol v-else class="tape">
      <li v-for="line in lines" :key="line.seq" class="line">
        <template v-if="line.kind === 'chat'">{{ line.body }}</template>
        <template v-else>
          <span v-if="eventFor(line.event_id)">
            {{ eventFor(line.event_id)?.type }}
            {{ eventFor(line.event_id)?.body }}
          </span>
          <span v-else class="muted">Activity</span>
        </template>
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
    <form class="composer" @submit.prevent="submitActivity">
      <select
        v-model="activityType"
        aria-label="Activity type"
        :disabled="room.status !== 'ready'"
      >
        <option value="note">note</option>
        <option value="decision">decision</option>
        <option value="occurrence">occurrence</option>
      </select>
      <textarea
        v-model="activityBody"
        aria-label="Activity body"
        :disabled="room.status !== 'ready'"
      />
      <button type="submit" :disabled="room.status !== 'ready'">Record</button>
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
  margin-bottom: 0.5rem;
}

.toggle,
select,
textarea,
input,
button {
  font: inherit;
}

select,
textarea {
  color: var(--fg);
  background: var(--bg);
  border: 1px solid var(--muted);
  border-radius: var(--radius);
  padding: 0.35rem 0.5rem;
}
</style>
