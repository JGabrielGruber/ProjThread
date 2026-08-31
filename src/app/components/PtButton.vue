<script setup lang="ts">
withDefaults(
  defineProps<{
    variant?: "default" | "primary" | "compact";
    type?: "button" | "submit" | "reset";
    disabled?: boolean;
  }>(),
  { variant: "default" },
);
</script>

<template>
  <button :type="type" :disabled="disabled" :class="variant">
    <slot />
  </button>
</template>

<style scoped>
button {
  font: inherit;
  color: var(--accent);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.5rem 0.75rem;
  cursor: pointer;
}

button:disabled {
  opacity: 0.5;
  cursor: default;
}

.primary {
  color: var(--bg);
  background: var(--accent);
  border-color: var(--accent);
}

.compact {
  align-self: flex-start;
  width: auto;
}
</style>
