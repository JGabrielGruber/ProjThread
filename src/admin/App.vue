<script setup lang="ts">
import { onMounted, ref } from "vue";

type PrincipalType = "human" | "agent" | "service";

type Principal = {
  id: string;
  type: PrincipalType;
  display_name: string;
};

type CreatedOrg = {
  organization: { id: string; name: string };
  workspace: { id: string; name: string };
  project: { id: string; name: string; parent_id: string | null };
  principal: { id: string; type: string; display_name: string };
};

type Issued = {
  display_name: string;
  session_id: string;
  expires_at: string;
};

const principals = ref<Principal[]>([]);
const displayName = ref("");
const type = ref<PrincipalType>("human");
const orgName = ref("");
const createdOrg = ref<CreatedOrg | null>(null);
const issued = ref<Issued | null>(null);
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

async function createOrg() {
  error.value = "";
  try {
    const res = await fetch("/api/admin/organizations", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: orgName.value }),
    });
    if (!res.ok) {
      error.value = "Create organization failed";
      return;
    }
    createdOrg.value = (await res.json()) as CreatedOrg;
    orgName.value = "";
    await load();
  } catch {
    error.value = "Create organization failed";
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

async function issueToken(p: Principal) {
  error.value = "";
  issued.value = null;
  try {
    const res = await fetch("/api/admin/sessions", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ principal_id: p.id, set_cookie: false }),
    });
    if (!res.ok) {
      error.value = "Issue token failed";
      return;
    }
    const body = (await res.json()) as {
      session: { id: string; expires_at: string };
    };
    issued.value = {
      display_name: p.display_name,
      session_id: body.session.id,
      expires_at: body.session.expires_at,
    };
  } catch {
    error.value = "Issue token failed";
  }
}

async function copyIssued() {
  if (!issued.value) return;
  await navigator.clipboard.writeText(issued.value.session_id);
}

onMounted(load);
</script>

<template>
  <main>
    <h1>Admin</h1>
    <p v-if="error" class="error">{{ error }}</p>

    <form @submit.prevent="createOrg">
      <label>
        Organization name
        <input v-model="orgName" name="organization_name" required />
      </label>
      <button type="submit">Create organization</button>
    </form>

    <p v-if="createdOrg" class="created">
      {{ createdOrg.organization.name }} /
      {{ createdOrg.workspace.name }} /
      {{ createdOrg.project.name }} /
      {{ createdOrg.principal.display_name }}
    </p>

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
        <button type="button" @click="mint(p.id)">Enter as</button>
        <button type="button" @click="issueToken(p)">Issue token</button>
      </li>
    </ul>

    <section v-if="issued" class="issued">
      <p>
        Token for {{ issued.display_name }} (expires {{ issued.expires_at }})
      </p>
      <input :value="issued.session_id" readonly name="issued_session_id" />
      <button type="button" @click="copyIssued">Copy</button>
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
  margin: 0 0 1rem;
  font-size: 1.5rem;
}

.error {
  color: var(--danger);
}

.created {
  color: var(--muted);
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

.issued {
  display: grid;
  gap: 0.5rem;
  max-width: 28rem;
  margin-top: 1rem;
  color: var(--muted);
}
</style>
