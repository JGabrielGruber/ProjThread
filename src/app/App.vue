<script setup lang="ts">
import { onMounted, ref } from "vue";

type Principal = {
  id: string;
  type: string;
  display_name: string;
};

const principal = ref<Principal | null>(null);
const loaded = ref(false);

onMounted(async () => {
  try {
    const res = await fetch("/api/me", { credentials: "include" });
    if (res.ok) {
      const body = (await res.json()) as { principal: Principal };
      principal.value = body.principal;
    }
  } catch {
    principal.value = null;
  } finally {
    loaded.value = true;
  }
});
</script>

<template>
  <main v-if="loaded">
    <h1 v-if="!principal">No session</h1>
    <section v-else>
      <p class="name">{{ principal.display_name }}</p>
      <p class="type">{{ principal.type }}</p>
    </section>
  </main>
</template>

<style scoped>
main {
  padding: 1.5rem;
  color: var(--fg);
  background: var(--bg);
  font-family: var(--font);
}

h1 {
  margin: 0;
  font-size: 1.5rem;
}

.name {
  margin: 0 0 0.25rem;
  font-size: 1.25rem;
}

.type {
  margin: 0;
  color: var(--muted);
}
</style>
