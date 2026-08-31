<script setup lang="ts">
defineOptions({ inheritAttrs: false });

withDefaults(
  defineProps<{
    as?: "input" | "textarea" | "select";
    label?: string;
    type?: string;
    required?: boolean;
    name?: string;
    disabled?: boolean;
  }>(),
  { as: "input" },
);

const model = defineModel<string | number>();
</script>

<template>
  <select
    v-if="as === 'select'"
    v-model="model"
    :aria-label="label"
    :name="name"
    :required="required"
    :disabled="disabled"
    v-bind="$attrs"
  >
    <slot />
  </select>
  <textarea
    v-else-if="as === 'textarea'"
    v-model="model"
    :aria-label="label"
    :name="name"
    :required="required"
    :disabled="disabled"
    v-bind="$attrs"
  />
  <input
    v-else
    v-model="model"
    :type="type"
    :aria-label="label"
    :name="name"
    :required="required"
    :disabled="disabled"
    v-bind="$attrs"
  />
</template>

<style scoped>
input,
select,
textarea {
  font: inherit;
  color: var(--fg);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.5rem 0.75rem;
}

textarea {
  min-height: 8rem;
}
</style>
