<script setup lang="ts">
import { onMounted, ref } from "vue";

type PrincipalType = "human" | "agent" | "service";

type Principal = {
  id: string;
  type: PrincipalType;
  display_name: string;
};

const principals = ref<Principal[]>([]);
const displayName = ref("");
const type = ref<PrincipalType>("human");
const error = ref("");

async function load() {
  error.value = "";
  try {
    const res = await fetch("/api/admin/principals", { credentials: "include" });
    if (!res.ok) {
      error.value = "Could not load principals";
      return;
    }
    const body = (await res.json()) as { principals: Principal[] };
    principals.value = body.principals;
  } catch {
    error.value = "Could not load principals";
  }
}

async function create() {
  error.value = "";
  try {
    const res = await fetch("/api/admin/principals", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        display_name: displayName.value,
        type: type.value,
      }),
    });
    if (!res.ok) {
      error.value = "Create failed";
      return;
    }
    displayName.value = "";
    await load();
  } catch {
    error.value = "Create failed";
  }
}

async function mint(principalId: string) {
  error.value = "";
  try {
    const res = await fetch("/api/admin/sessions", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ principal_id: principalId }),
    });
    if (!res.ok) {
      error.value = "Mint failed";
      return;
    }
    location.href = "/";
  } catch {
    error.value = "Mint failed";
  }
}

onMounted(load);
</script>

<template>
  <main>
    <h1>Admin</h1>
    <p v-if="error" class="error">{{ error }}</p>

    <form @submit.prevent="create">
      <label>
        Display name
        <input v-model="displayName" name="display_name" required />
      </label>
      <label>
        Type
        <select v-model="type" name="type">
          <option value="human">human</option>
          <option value="agent">agent</option>
          <option value="service">service</option>
        </select>
      </label>
      <button type="submit">Create principal</button>
    </form>

    <ul>
      <li v-for="p in principals" :key="p.id">
        <span>{{ p.display_name }}</span>
        <span class="muted">{{ p.type }}</span>
        <button type="button" @click="mint(p.id)">Mint session</button>
      </li>
    </ul>
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
  margin: 0 0 1rem;
  font-size: 1.5rem;
}

.error {
  color: var(--danger);
}

form,
ul {
  display: grid;
  gap: 0.75rem;
  max-width: 28rem;
  padding: 0;
  list-style: none;
}

label {
  display: grid;
  gap: 0.25rem;
  color: var(--muted);
}

input,
select,
button {
  font: inherit;
  color: var(--fg);
  background: var(--bg);
  border: 1px solid var(--muted);
  border-radius: var(--radius);
  padding: 0.4rem 0.6rem;
}

button {
  color: var(--accent);
  cursor: pointer;
}

li {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}

.muted {
  color: var(--muted);
}
</style>
