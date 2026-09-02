# ProjThread empty tenant Implementation Plan

> For Grok Build: one session, one slice. Compact after each task. Scout only if a file is not where this plan says. Do not add tests the plan did not ask for. Stop when STATUS is updated. Do not dispatch reviewer or superpowers:subagent-driven-development sub-agents. Do not start OAuth. Do not start room MCP. Do not start Config MCP. Do not add a UI kit (PrimeVue, Daisy, Nord). Do not add card/node/project archive or delete. Do not drop remote D1. Chrome DevTools only for the one first-workspace form smoke (Task 6).

**Goal:** A principal with a session and zero memberships can name a workspace in the PWA and keep it. Farm seed leaves the repo.

**Architecture:** Worker `POST /api/organizations` (plan 16) already mints org + workspace + root project + default stages + owner membership for the **caller**. This slice opens that path in the PWA: replace the dead “No workspace” heading with a setup form that calls existing `config.createWorkspace`. Retire `seeds/local.sql`. Remote Farm rows stay until José asks.

**Tech Stack:** Vue 3, Pinia (in tree). `node --test --experimental-strip-types`. No new npm dependency. No new bindings. No D1 migration.

---

## Locked calls (do not re-litigate)

| Topic | Call |
| --- | --- |
| First workspace | Session + **zero** memberships → setup panel (not Config, not a new route). Name + Create. Same `POST /api/organizations` as Config. Then `PATCH /api/me` (existing `createWorkspace` bind). Shell appears. |
| Copy | Heading stays **No workspace**. Who line is `principal.display_name`. Not marketing. |
| No session | Unchanged: heading **No session**. No create form. |
| Extra workspaces | Config “Create workspace” stays for people who already have a membership. |
| Admin | Out. `POST /api/admin/organizations` still mints a **new** principal. PWA create does not. |
| Farm seed | **Retire.** Delete `seeds/local.sql` and `seed:local`. Tests already use in-memory catalogs, not Farm ids. Leftover Farm **rows** in local D1 are ops, not this commit. |
| Remote D1 | **Do not drop.** STATUS operator note stays: do not drop remote D1 until José asks. |
| MCP | No new tools. Zero memberships: `session_briefing` already returns principal + empty memberships. Bot cannot create a workspace until Config MCP (18). |
| Deletes / UI kit / SPA flag / Deploy / OAuth / room MCP | Out. |
| Tests | `node:test` on `.ts` only. Do not import `.vue`. |
| Chrome | One page, one submit on the setup form. HTTP covers Worker. |

### Setup panel (exact)

When `session.loaded && session.principal && session.memberships.length === 0`:

```
No workspace
<display_name>
[ Workspace name ]
[ Create workspace ]
```

Empty name: no POST (same as Config `submitWorkspace`). Error: overlay toast `Could not create workspace`.

### `loadMe` (lock)

Empty `memberships` → do **not** PATCH `/api/me`. `workspace_id` stays `null`.

---

## File map

- `src/app/stores/session.test.ts` — empty memberships, no PATCH
- `src/app/App.vue` — setup panel; toast; `submitFirstWorkspace`
- `seeds/local.sql` — delete
- `package.json` — drop `seed:local`
- `.grok/skills/using-projthread/SKILL.md` — first workspace is human PWA
- `docs/STATUS.md`, `AGENTS.md`, index, spec parked line

Do not modify room DO, `src/admin`, Worker catalog (already correct), `wrangler.jsonc`, tokens, SW intercept, MCP tools.

---

## Out of this slice (explicit)

| Deferred | Why |
| --- | --- |
| Config MCP | Plan 18 |
| Drop remote D1 / wipe local Farm rows | Ops, José asks |
| Card/node/project DELETE | No HTTP on purpose |
| New `/setup` route | José: not a place |
| MCP `create_workspace` | 18 |
| OAuth / public signup | Absence |

---

## STATUS.md after this slice

**Live:** … empty-tenant setup (session, zero memberships → create workspace); Farm seed retired from the repo.
**Now:** no open slice. Next named work is **Config MCP** (plan 18 not written). Park Deploy. Do not start OAuth. Do not start room MCP. Do not drop remote D1 unless José asks.
**Next:** write Config MCP after a human workspace exists to keep.
**Parked:** Empty-tenant **shipped** (local). Farm seed file gone. Remote Farm rows remain until José asks.

---

### Task 1: Maps

Files: this plan, `docs/STATUS.md`, `AGENTS.md`, `docs/superpowers/plans/2026-08-26-projthread-v1.md`.

- [x] STATUS **Now:** execute this plan. **Plan:** `docs/superpowers/plans/2026-09-02-projthread-empty-tenant.md`
- [x] AGENTS **Now:** empty-tenant plan (see STATUS). Drop “Do not start empty-tenant”. Keep “Do not start Config MCP”.
- [x] Index plan **17** file name + **Now:** execute 17.

---

### Task 2: Empty memberships do not PATCH (failing test)

Files: `src/app/stores/session.test.ts`

- [x] **Step 1: Add this test** (after the existing `loadMe PATCHes memberships[0]` case)

```ts
  it("loadMe with empty memberships does not PATCH", async () => {
    const principal = { id: "p1", type: "human", display_name: "Ada" };
    const calls: string[] = [];
    globalThis.fetch = async (input, init) => {
      assert.equal(String(input), "/api/me");
      calls.push((init?.method ?? "GET").toUpperCase());
      return Response.json({
        principal,
        memberships: [],
        workspace_id: null,
      });
    };
    const store = useSessionStore();
    await store.loadMe();
    assert.deepEqual(store.principal, principal);
    assert.deepEqual(store.memberships, []);
    assert.equal(store.workspaceId, null);
    assert.deepEqual(calls, ["GET"]);
  });
```

- [x] **Step 2: Run**

```bash
node --test --experimental-strip-types src/app/stores/session.test.ts
```

Expected: PASS (store already skips PATCH when `memberships[0]` is missing). If it PATCHes, that is a product bug — fix `loadMe` so it only PATCHes when `memberships.value[0]` exists. Do not infer a workspace on the Worker.

---

### Task 3: Setup panel

Files: `src/app/App.vue`

`config` store is already imported. Add a draft + submit next to `workspaceDraft`. Toast: when principal exists, memberships empty, and `config.status === "error"`, message `Could not create workspace`.

- [x] **Step 1: Script** (inside `<script setup>`, after `workspaceDraft`)

```ts
const workspaceName = ref("");

async function submitFirstWorkspace(): Promise<void> {
  const name = workspaceName.value.trim();
  if (!name) return;
  await config.createWorkspace(name);
  if (config.status === "error") return;
  workspaceName.value = "";
}
```

In `toast`, **before** the `route.name === "room"` branch:

```ts
  if (session.principal && session.memberships.length === 0) {
    if (config.status === "error") {
      return { message: "Could not create workspace", tone: "error" as const };
    }
    return { message: "", tone: "info" as const };
  }
```

- [x] **Step 2: Template** — replace the dead heading

Was:

```html
    <h1 v-else-if="session.memberships.length === 0">No workspace</h1>
```

Now:

```html
    <section
      v-else-if="session.memberships.length === 0"
      class="setup"
    >
      <h1>No workspace</h1>
      <p class="who">{{ session.principal.display_name }}</p>
      <form class="form" @submit.prevent="submitFirstWorkspace">
        <PtField
          v-model="workspaceName"
          type="text"
          label="Workspace name"
        />
        <PtButton type="submit" variant="primary">Create workspace</PtButton>
      </form>
    </section>
```

- [x] **Step 3: CSS** (scoped, with existing `h1` rules)

```css
.setup {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  max-width: 24rem;
  padding: 1.5rem;
}

.setup h1 {
  padding: 0;
}

.setup .form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
```

Do not add a `/setup` route. Do not import `.vue` in tests. Config page create form stays.

- [x] **Step 4: Commit**

```bash
git add src/app/App.vue src/app/stores/session.test.ts
git commit -m "feat: first-workspace setup when memberships are empty"
```

---

### Task 4: Retire Farm seed

Files: `seeds/local.sql` (delete), `package.json`

- [x] **Step 1: Delete** `seeds/local.sql`

- [x] **Step 2: Remove** the script from `package.json`

```json
    "seed:local": "wrangler d1 execute projthread --local --file=seeds/local.sql"
```

Leave a trailing-comma-safe scripts object (no dangling comma).

- [x] **Step 3: Grep**

```bash
rg -n "seed:local|seeds/local" --glob '!docs/superpowers/plans/2026-08-26-projthread-catalog.md' --glob '!docs/context/**'
```

No remaining **runtime** references. Historical plan files may still mention Farm; do not rewrite landed plans.

- [x] **Step 4: Commit**

```bash
git add seeds/local.sql package.json
git commit -m "chore: retire local Farm seed"
```

---

### Task 5: Operator docs

Files: `.grok/skills/using-projthread/SKILL.md`, `docs/superpowers/specs/2026-08-26-projthread-v1-design.md`

- [x] **Step 1: Skill** — after “This MCP server is catalog + wiki. **Chat is not here.**” add:

```
A human creates the first workspace in the PWA (session, no memberships). This MCP does not create organizations.
```

- [x] **Step 2: Spec** — PWA product item 3 becomes **this plan** (not “later”). Parked briefing-pins line that still says empty-tenant is later: point at this file; Config MCP and dropping remote Farm D1 stay later.

Exact replace in **Parked: briefing pins**:

Was: `Config MCP, empty-tenant, and dropping Farm D1 stay later (see **PWA product**). Operator CRUD landed locally.`

Now: `Empty tenant is plan 17. Config MCP and dropping remote Farm D1 stay later. Operator CRUD landed locally.`

- [x] **Step 3: Commit**

```bash
git add .grok/skills/using-projthread/SKILL.md docs/superpowers/specs/2026-08-26-projthread-v1-design.md
git commit -m "docs: first workspace is human PWA; empty-tenant is plan 17"
```

---

### Task 6: Smoke (HTTP required; Chrome once)

Worker path is already green in `catalog-http.test.ts` (`handleCatalog organizations`). Prove the **new principal** path against wrangler. Do **not** mint Farm `01FARM…`. Do **not** drop remote D1. Do **not** wipe local Farm rows.

- [x] **Step 1: Start wrangler only if it is not already up** (`npm run dev` → http://localhost:8787). Apply no new migration.

- [x] **Step 2: HTTP** (admin `X-Admin-Dev: local-dev-secret`)

1. `POST /api/admin/principals` `{ "type": "human", "display_name": "Empty" }` → 201, id `P`.
2. `POST /api/admin/sessions` `{ "principal_id": P }` → 200, cookie `pt_session`.
3. `GET /api/me` with that cookie → `memberships: []`, `workspace_id: null`.
4. `POST /api/organizations` `{ "name": "Keep" }` → 201, no `principal` key, caller is owner.
5. `PATCH /api/me` `{ "workspace_id": <that workspace> }` → 200 bound.
6. `GET /api/workspaces/:ws/projects` → one root. `GET .../work-items?project_id=<root>` → `{ items: [] }`.

- [x] **Step 3: Chrome (one pass)** — only this. Cookie from step 2 (or mint Enter as for `P` in `/admin`). Open `/`. Expect heading **No workspace**, who **Empty**, field **Workspace name**, button **Create workspace**. Submit `Keep` (or `Keep 2` if HTTP already created Keep). After submit: shell (Kanban rail), not the setup panel. Stop. Do not click Filters, wiki, room, or Config.

- [x] **Step 4: Tests**

```bash
npm test
```

Expected: all pass (count ≥ 233 if Task 2 added one test).

If wrangler was started here, leave it; do not restart if José killed it after.

---

### Task 7: STATUS landing

Files: `docs/STATUS.md`, `AGENTS.md`, `docs/superpowers/plans/2026-08-26-projthread-v1.md`, this plan (checkboxes).

- [x] Live: empty-tenant setup; Farm seed file retired.
- [x] **Now:** no open slice. Next named work is **Config MCP** (plan 18 not written). Park Deploy. Do not start OAuth. Do not start room MCP. Do not drop remote D1 unless José asks.
- [x] Index plan 17 file + landed. **Now** matches STATUS.
- [x] AGENTS **Now:** no open slice. Do not start Config MCP.
- [x] Operator note: Farm seed file gone; leftover local/remote Farm **rows** wait for José.
- [x] Commit

```bash
git add docs/STATUS.md AGENTS.md docs/superpowers/plans/2026-08-26-projthread-v1.md docs/superpowers/plans/2026-09-02-projthread-empty-tenant.md
git commit -m "docs: empty-tenant landed; next is Config MCP"
```

Stop. Do not push. Do not deploy. Do not write plan 18.
