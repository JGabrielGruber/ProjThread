<script setup lang="ts">
defineProps<{
  message: string;
  tone?: "info" | "error";
}>();
</script>

<template>
  <Teleport to="body">
    <div
      v-if="message"
      class="toast"
      :class="{ error: tone === 'error' }"
      role="status"
      aria-live="polite"
    >
      {{ message }}
    </div>
  </Teleport>
</template>

<style scoped>
.toast {
  position: fixed;
  z-index: 10;
  left: 50%;
  bottom: 1.25rem;
  transform: translateX(-50%);
  max-width: min(24rem, calc(100% - 2rem));
  padding: 0.5rem 0.75rem;
  color: var(--fg);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  font-family: var(--font);
  font-size: 0.9rem;
}

.error {
  color: var(--danger);
}
</style>
