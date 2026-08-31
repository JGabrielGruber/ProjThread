<template>
  <li class="row">
    <div class="main">
      <slot />
    </div>
    <div v-if="$slots.meta" class="meta">
      <slot name="meta" />
    </div>
  </li>
</template>

<style scoped>
.row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: baseline;
  margin: 0;
  padding: 0.75rem 0;
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--border);
  border-radius: 0;
}

.main {
  min-width: 0;
  flex: 1 1 auto;
}

.meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: baseline;
  margin-left: auto;
  color: var(--muted);
  font-size: 0.8125rem;
}
</style>
