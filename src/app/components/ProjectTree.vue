<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  projects: { id: string; parent_id: string | null; name: string }[];
  selectedId: string | null;
}>();

const emit = defineEmits<{
  select: [id: string | null];
}>();

const rows = computed(() => {
  const byParent = new Map<string | null, typeof props.projects>();
  for (const project of props.projects) {
    const key = project.parent_id;
    const list = byParent.get(key) ?? [];
    list.push(project);
    byParent.set(key, list);
  }
  const out: { id: string; name: string; depth: number }[] = [];
  function walk(parentId: string | null, depth: number): void {
    for (const project of byParent.get(parentId) ?? []) {
      out.push({ id: project.id, name: project.name, depth });
      walk(project.id, depth + 1);
    }
  }
  walk(null, 0);
  return out;
});

const rootId = computed(
  () => props.projects.find((p) => p.parent_id == null)?.id ?? null,
);

function isSelected(id: string): boolean {
  if (props.selectedId == null) return id === rootId.value;
  return props.selectedId === id;
}

function onSelect(id: string): void {
  emit("select", id === rootId.value ? null : id);
}
</script>

<template>
  <nav class="tree" aria-label="Projects">
    <button
      v-for="row in rows"
      :key="row.id"
      type="button"
      class="row"
      :class="{ 'is-selected': isSelected(row.id) }"
      :style="{ paddingLeft: `${0.5 + row.depth * 0.75}rem` }"
      @click="onSelect(row.id)"
    >
      {{ row.name }}
    </button>
  </nav>
</template>

<style scoped>
.tree {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

.row {
  font: inherit;
  font-size: 0.875rem;
  color: var(--muted);
  background: transparent;
  border: none;
  border-radius: var(--radius);
  padding: 0.35rem 0.5rem;
  text-align: left;
  cursor: pointer;
}

.row:hover {
  color: var(--fg);
  background: var(--surface);
}

.row.is-selected {
  color: var(--fg);
  font-weight: 700;
}
</style>
