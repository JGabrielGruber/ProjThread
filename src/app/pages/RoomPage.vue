<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import PtButton from "../components/PtButton.vue";
import PtField from "../components/PtField.vue";
import { useConfigStore } from "../stores/config.ts";
import { useRoomStore } from "../stores/room.ts";
import { useSessionStore } from "../stores/session.ts";

const route = useRoute();
const router = useRouter();
const room = useRoomStore();
const session = useSessionStore();
const config = useConfigStore();
const draft = ref("");
const activityType = ref<"note" | "decision" | "occurrence">("note");
const activityBody = ref("");
const attachId = ref("");

function queryString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function paramString(value: unknown): string | undefined {
  if (Array.isArray(value)) return queryString(value[0]);
  return queryString(value);
}

const itemId = computed(() => paramString(route.params.itemId));

watch(
  itemId,
  (id) => {
    if (id) void room.open(id);
  },
  { immediate: true },
);

watch(
  () => session.workspaceId,
  (workspace) => {
    if (workspace && config.workspaceId !== workspace) void config.load(workspace);
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
  await router.replace({ name: "kanban" });
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

async function onOwner(value: string): Promise<void> {
  const to = value || null;
  await room.postEvent({
    type: "owner_changed",
    from: room.item?.owner_id ?? null,
    to,
  });
}

async function attach(): Promise<void> {
  const id = attachId.value.trim();
  if (!id) return;
  await room.attachNode(id);
  attachId.value = "";
}
</script>

<template>
  <section class="room">
    <header>
      <button type="button" class="back" @click="back">Back</button>
      <h2>{{ room.item?.title }}</h2>
      <p class="stage">{{ room.item?.stage_key }}</p>
      <PtField
        as="select"
        label="Owner"
        :model-value="room.item?.owner_id ?? ''"
        @update:model-value="onOwner(String($event))"
      >
        <option value="">unassigned</option>
        <option
          v-for="member in config.members"
          :key="member.principal_id"
          :value="member.principal_id"
        >
          {{ member.display_name }}
        </option>
      </PtField>
    </header>
    <section class="nodes">
      <h3>Nodes</h3>
      <ul>
        <li v-for="node in room.nodes" :key="node.id">
          <button
            type="button"
            class="title"
            @click="router.push({ name: 'wiki', query: { node: node.id } })"
          >
            {{ node.title }}
          </button>
        </li>
      </ul>
      <form class="link" @submit.prevent="attach">
        <PtField v-model="attachId" type="text" label="Node id" />
        <PtButton type="submit">Attach</PtButton>
      </form>
    </section>
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
    <div class="dock">
    <form class="composer" @submit.prevent="submit">
      <input
        v-model="draft"
        type="text"
        name="body"
        aria-label="Chat message"
        :disabled="room.status !== 'ready'"
      />
      <button type="submit" class="primary" :disabled="room.status !== 'ready'">Send</button>
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
    </div>
  </section>
</template>

<style scoped>
.room {
  display: flex;
  flex-direction: column;
  min-height: 100%;
  height: 100%;
  color: var(--fg);
}

header {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: baseline;
  padding: 1rem 1.25rem 0.5rem;
}

h2 {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 700;
}

.stage,
.muted {
  margin: 0;
  color: var(--muted);
  font-size: 0.8125rem;
}

.back,
input,
button {
  font: inherit;
  color: var(--fg);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.5rem 0.75rem;
}

.back,
button {
  color: var(--accent);
  cursor: pointer;
}

.back,
.toggle {
  background: transparent;
  border: none;
  padding: 0.5rem 0.25rem;
}

.tape {
  list-style: none;
  flex: 1;
  min-height: 0;
  overflow: auto;
  margin: 0;
  padding: 0.5rem 1.25rem 1rem;
  color: var(--fg);
}

.line {
  margin: 0 0 0.5rem;
}

.dock {
  position: sticky;
  bottom: 0;
  z-index: 11;
  padding: 0.75rem 1.25rem 1rem;
  background: var(--bg);
  border-top: 1px solid var(--border);
}

.composer {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.composer:last-child {
  margin-bottom: 0;
}

.toggle {
  align-self: flex-start;
  margin: 0 1.25rem 0.5rem;
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
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.5rem 0.75rem;
}

.composer input,
.composer textarea {
  flex: 1;
  min-width: 0;
}

button.primary {
  color: var(--bg);
  background: var(--accent);
  border-color: var(--accent);
}
</style>
