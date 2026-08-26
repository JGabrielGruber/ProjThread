# ProjThread Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Session cookie + membership opens a D1 kanban for one seeded (or super-admin-created) org: cards you can create, not move, not open.

**Architecture:** Catalog is D1 only. Cookie → principal → membership on every `/api/workspaces*` and `/api/work-items*` request. Board never talks to a Durable Object. Workspace / extra projects / stages / members UIs wait for Config (PrimeVue). This slice seeds them and, when feasible, super-admin `POST /api/admin/organizations` mints the same bundle (org + workspace + root project named after the org + default stages + default human + owner membership).

**Tech Stack:** Vue 3, Pinia, vue-router, existing Worker + D1 + `node --test --experimental-strip-types`. No PrimeVue, no Room DO, no Activity writes, no wiki, no hostname literals.

---

## Locked calls (do not re-litigate)

| Topic | Call |
| --- | --- |
| Seed | One org, **local only** (`seeds/local.sql`, not a D1 migration). Name **Farm**. |
| Super-admin | `POST /api/admin/organizations { name }` → org, workspace, root project (all `name`), stages `backlog/doing/done`, human principal `display_name = name`, membership `owner`. |
| PWA config | Workspace, extra projects, stages, members — **not this plan**. |
| Open card | **No detail.** Click is inert. Room is later. |
| Stage / owner | **Forbidden.** Create with `stage_key = backlog`, `owner_id = null`. PATCH may change `title` only. No DELETE. |
| Board filter | `project_id` in the URL; query **includes descendant projects**. LCA picker is later. |
| `/api/me` | `{ principal, memberships[] }` — session context, not the board. |
| Create UX | Composer on the board: title → POST onto the URL’s project. |

---

## File map

| Path | Job |
| --- | --- |
| `migrations/0002_catalog.sql` | `workspace`, `membership`, `stage`, `project`, `work_item` |
| `seeds/local.sql` | One Farm tenant (local execute only) |
| `src/lib/project-tree.ts` | Descendants + cycle check |
| `src/worker/catalog.ts` | `CatalogStore`, `d1CatalogStore`, `createTenantBundle` |
| `src/worker/catalog-http.ts` | App catalog HTTP |
| `src/worker/me.ts` | Add `memberships` |
| `src/worker/admin.ts` | `POST/GET /api/admin/organizations` |
| `src/worker/index.ts` | Dispatch catalog routes (cookie, not Access) |
| `src/app/stores/session.ts` | Pinia: `/api/me`, single-flight |
| `src/app/stores/board.ts` | Pinia: stages, projects, items, create |
| `src/app/router.ts` | `/` query `workspace`, `project` |
| `src/app/App.vue` | No session / no workspace / kanban |
| `src/app/KanbanBoard.vue` | Columns + cards + composer |
| `src/admin/App.vue` | Org create form (keep principals + mint) |

Do not add Room, Activity handlers, wiki, PrimeVue, or `work_item_event`.

---

### Task 1: Maps

**Files:**
- Modify: `docs/STATUS.md`
- Modify: `AGENTS.md`
- Modify: `docs/superpowers/plans/2026-08-26-projthread-v1.md`

- [x] **Step 1: Point STATUS at catalog**

```
**Live:** local wrangler — Access admin, session cookie, GET /api/me
**Now:** catalog plan (kanban + membership; no Room)
**Plan:** `docs/superpowers/plans/2026-08-26-projthread-catalog.md`
**Index:** `docs/superpowers/plans/2026-08-26-projthread-v1.md`
**Spec:** `docs/superpowers/specs/2026-08-26-projthread-v1-design.md`
```

- [x] **Step 2: AGENTS.md**

Set **Now:** catalog plan (see STATUS). Open plan row → this file. Remove “(foundation first)”.

- [x] **Step 3: Plan index**

Catalog row file: `2026-08-26-projthread-catalog.md`. **Now:** execute plan 2 (catalog) only.

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md docs/STATUS.md docs/superpowers/plans/
git commit -m "docs: catalog plan (kanban, membership, local seed)"
```

---

### Task 2: Schema

**Files:**
- Create: `migrations/0002_catalog.sql`

- [ ] **Step 1: Write migration**

```sql
CREATE TABLE workspace (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organization(id),
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE membership (
  workspace_id TEXT NOT NULL REFERENCES workspace(id),
  principal_id TEXT NOT NULL REFERENCES principal(id),
  role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  PRIMARY KEY (workspace_id, principal_id)
);

CREATE TABLE stage (
  workspace_id TEXT NOT NULL REFERENCES workspace(id),
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, key)
);

CREATE TABLE project (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace(id),
  organization_id TEXT NOT NULL REFERENCES organization(id),
  parent_id TEXT REFERENCES project(id),
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_project_workspace ON project (workspace_id);

CREATE TABLE work_item (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES project(id),
  workspace_id TEXT NOT NULL REFERENCES workspace(id),
  organization_id TEXT NOT NULL REFERENCES organization(id),
  title TEXT NOT NULL,
  stage_key TEXT NOT NULL,
  owner_id TEXT REFERENCES principal(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_work_item_board ON work_item (workspace_id, project_id, stage_key);
```

SQLite cannot FK `(workspace_id, stage_key)` to `stage` without an extra unique column; handlers must verify `stage_key` exists. Do not invent a second stage table.

- [ ] **Step 2: Apply locally**

```bash
npx wrangler d1 migrations apply projthread --local
```

Expected: applied `0002_catalog.sql`. Do **not** apply remote.

- [ ] **Step 3: Commit**

```bash
git add migrations/0002_catalog.sql
git commit -m "feat: D1 workspace, membership, project, work_item"
```

---

### Task 3: Project tree (pure)

**Files:**
- Create: `src/lib/project-tree.ts`
- Create: `src/lib/project-tree.test.ts`

- [ ] **Step 1: Failing tests**

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { descendantIds, wouldCycle } from "./project-tree.ts";

const nodes = [
  { id: "root", parent_id: null },
  { id: "a", parent_id: "root" },
  { id: "b", parent_id: "a" },
  { id: "c", parent_id: "root" },
];

describe("descendantIds", () => {
  it("includes self and nested children", () => {
    const ids = descendantIds("root", nodes);
    assert.deepEqual([...ids].sort(), ["a", "b", "c", "root"]);
  });

  it("is only the leaf for a leaf", () => {
    assert.deepEqual([...descendantIds("b", nodes)], ["b"]);
  });
});

describe("wouldCycle", () => {
  it("rejects setting parent to a descendant", () => {
    assert.equal(wouldCycle("root", "b", nodes), true);
  });

  it("allows a sibling reparent", () => {
    assert.equal(wouldCycle("c", "a", nodes), false);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
node --test --experimental-strip-types src/lib/project-tree.test.ts
```

- [ ] **Step 3: Implement**

```ts
export type TreeNode = { id: string; parent_id: string | null };

export function descendantIds(
  rootId: string,
  nodes: TreeNode[],
): Set<string> {
  const children = new Map<string, string[]>();
  for (const n of nodes) {
    if (!n.parent_id) continue;
    const list = children.get(n.parent_id) ?? [];
    list.push(n.id);
    children.set(n.parent_id, list);
  }
  const out = new Set<string>();
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    for (const c of children.get(id) ?? []) stack.push(c);
  }
  return out;
}

export function wouldCycle(
  nodeId: string,
  newParentId: string | null,
  nodes: TreeNode[],
): boolean {
  if (newParentId == null) return false;
  if (newParentId === nodeId) return true;
  return descendantIds(nodeId, nodes).has(newParentId);
}
```

No HTTP in this task. Config will call `wouldCycle` later; catalog uses `descendantIds` now.

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add src/lib/project-tree.ts src/lib/project-tree.test.ts
git commit -m "feat: project forest descendants and cycle check"
```

---

### Task 4: Catalog store (injectable)

**Files:**
- Create: `src/worker/catalog.ts`
- Create: `src/worker/catalog.test.ts`

```ts
export const DEFAULT_STAGES = [
  { key: "backlog", label: "Backlog", position: 0 },
  { key: "doing", label: "Doing", position: 1 },
  { key: "done", label: "Done", position: 2 },
] as const;

export type Membership = {
  organization_id: string;
  organization_name: string;
  workspace_id: string;
  workspace_name: string;
  role: "owner" | "member";
};

export type ProjectRow = {
  id: string;
  workspace_id: string;
  organization_id: string;
  parent_id: string | null;
  name: string;
};

export type StageRow = {
  workspace_id: string;
  key: string;
  label: string;
  position: number;
};

export type WorkItemRow = {
  id: string;
  project_id: string;
  workspace_id: string;
  organization_id: string;
  title: string;
  stage_key: string;
  owner_id: string | null;
  created_at: string;
  updated_at: string;
};

export type TenantBundle = {
  organization: { id: string; name: string; created_at: string };
  workspace: { id: string; organization_id: string; name: string; created_at: string };
  project: ProjectRow & { created_at: string };
  principal: { id: string; type: "human"; display_name: string; created_at: string };
  membership: { workspace_id: string; principal_id: string; role: "owner" };
};

export type CatalogStore = {
  listMemberships(principalId: string): Promise<Membership[]>;
  getMembership(workspaceId: string, principalId: string): Promise<Membership | null>;
  listProjects(workspaceId: string): Promise<ProjectRow[]>;
  getProject(id: string): Promise<(ProjectRow & { created_at: string }) | null>;
  listStages(workspaceId: string): Promise<StageRow[]>;
  listWorkItems(workspaceId: string, projectIds: string[]): Promise<WorkItemRow[]>;
  getWorkItem(id: string): Promise<WorkItemRow | null>;
  insertWorkItem(row: WorkItemRow): Promise<void>;
  updateWorkItemTitle(id: string, title: string, updatedAt: string): Promise<boolean>;
  insertTenantBundle(b: TenantBundle): Promise<void>;
  listOrganizations(): Promise<{ id: string; name: string }[]>;
};
```

`insertTenantBundle` writes: `organization`, `principal`, `workspace`, three `stage` rows from `DEFAULT_STAGES`, root `project` (`parent_id` null, `name` = org name), membership owner. Keep SQL in `catalog.ts`. `d1CatalogStore(db: D1Database): CatalogStore`.

- [ ] **Step 1: Failing tests** with an in-memory `CatalogStore` (same shape as session tests). Also a tiny in-memory `SessionStore` is **not** required here if the bundle inserts the principal row itself (catalog store may insert `principal` — that is allowed; it is the same D1). Cases:

- `insertTenantBundle` then `listMemberships` returns one owner row with org/workspace names
- `listProjects` is the one root named after the org
- `listStages` is backlog, doing, done in position order
- `insertWorkItem` with `owner_id: null`, `stage_key: "backlog"`; `listWorkItems` by that project id returns it
- `updateWorkItemTitle` changes title; missing id returns false
- `getMembership` other workspace → null

Do not use real D1.

- [ ] **Step 2: Run — expect FAIL**

```bash
node --test --experimental-strip-types src/worker/catalog.test.ts
```

- [ ] **Step 3: Implement `src/worker/catalog.ts`** (types + memory is test-only; production is `d1CatalogStore` + `insertTenantBundle` helper that builds ids via injected `newId` / `now` in HTTP layer, not in the store).

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add src/worker/catalog.ts src/worker/catalog.test.ts
git commit -m "feat: catalog store for tenant bundle and work items"
```

---

### Task 5: `GET /api/me` memberships

**Files:**
- Modify: `src/worker/me.ts`
- Modify: `src/worker/me.test.ts`
- Modify: `src/worker/index.ts` (pass catalog store)

Change signature to `handleMe(request, env, sessions, catalog)`. After `resolveSession`, `memberships = await catalog.listMemberships(principal.id)`. Body:

```ts
{ principal, memberships }
```

Empty array if none. 401 unchanged when cookie missing/invalid.

- [ ] **Step 1: Extend `me.test.ts`** — memory catalog with one membership; GET `/api/me` with cookie includes that membership; principal with no memberships → `memberships: []`. Keep 401 tests.

- [ ] **Step 2: Run — expect FAIL** (old body shape / arity)

- [ ] **Step 3: Implement**

- [ ] **Step 4: `npm test` — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add src/worker/me.ts src/worker/me.test.ts src/worker/index.ts
git commit -m "feat: GET /api/me returns memberships"
```

---

### Task 6: Catalog HTTP

**Files:**
- Create: `src/worker/catalog-http.ts`
- Create: `src/worker/catalog-http.test.ts`
- Modify: `src/worker/index.ts`

JSON errors: `{ error: "unauthorized" | "forbidden" | "not_found" | "bad_request" }` with 401/403/404/400.

Resolve cookie via `parseSessionId` + `resolveSession`. Missing/invalid → 401 **before** membership.

| Method | Path | Result |
| --- | --- | --- |
| GET | `/api/workspaces/:id/projects` | `{ projects }` if member else 403 |
| GET | `/api/workspaces/:id/stages` | `{ stages }` sorted by `position` |
| GET | `/api/workspaces/:id/work-items?project_id=` | `{ work_items }` for that project **and descendants**; 400 if `project_id` missing; 404 if project not in workspace |
| POST | `/api/workspaces/:id/work-items` | `{ title, project_id }` → 201 item; `stage_key=backlog`, `owner_id=null`; 400 empty title; 404 bad project |
| PATCH | `/api/work-items/:id` | `{ title }` only; 200 item; 400 if `stage_key` or `owner_id` present; 403 if not member of item’s workspace; 404 missing |

Use `descendantIds` from `src/lib/project-tree.ts`.

Handlers: `handleCatalog(request, env, sessions, catalog)`.

`index.ts`: after `/api/me`, if path starts with `/api/workspaces` or `/api/work-items`, `return handleCatalog(...)`.

- [ ] **Step 1: Tests** with memory session + catalog + minted cookie (reuse the pattern in `me.test.ts`). Cover: 401 no cookie; 403 other workspace; POST create; GET includes descendant project’s item when filtering parent; PATCH title; PATCH `{ title, stage_key: "done" }` → 400; POST empty title → 400.

- [ ] **Step 2: Run — expect FAIL**

```bash
node --test --experimental-strip-types src/worker/catalog-http.test.ts
```

- [ ] **Step 3: Implement**

- [ ] **Step 4: `npm test` — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add src/worker/catalog-http.ts src/worker/catalog-http.test.ts src/worker/index.ts
git commit -m "feat: catalog HTTP for projects, stages, work items"
```

---

### Task 7: Super-admin create org

**Files:**
- Modify: `src/worker/admin.ts`
- Modify: `src/worker/admin.test.ts`
- Modify: `src/worker/index.ts` (pass catalog into `handleAdmin`)
- Modify: `src/admin/App.vue`

`handleAdmin(request, env, sessions, catalog)`.

- `GET /api/admin/organizations` → `{ organizations }`
- `POST /api/admin/organizations` `{ name }` (non-empty string) → 201:

```ts
{
  organization: { id, name },
  workspace: { id, name },
  project: { id, name, parent_id: null },
  principal: { id, type: "human", display_name },
}
```

`display_name` of principal = trimmed `name`. Workspace name = same. Root project name = same. Stages = `DEFAULT_STAGES`. Membership owner on that principal. Use `newId()` for org, workspace, project, principal. `insertPrincipal` **or** bundle insert — one path only; prefer `catalog.insertTenantBundle` so seed and admin share writes.

Do not invent Access→principal link. `minted_by` on later session mint stays the target principal.

- [ ] **Step 1: Admin tests** — POST `{ name: "Farm" }` 201; memberships for returned principal include owner; empty name 400; GET lists the org.

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement handler**

- [ ] **Step 4: Admin Vue** — form “Organization name” + submit → POST `/api/admin/organizations` `credentials: 'include'`. On success, reload principals (new default human appears) and show the created names. Keep existing principal create + mint. Tokens only (`var(--*)`). No PrimeVue.

- [ ] **Step 5: `npm test` — expect PASS**

- [ ] **Step 6: Commit**

```bash
git add src/worker/admin.ts src/worker/admin.test.ts src/worker/index.ts src/admin/App.vue
git commit -m "feat: super-admin creates org tenant bundle"
```

---

### Task 8: Local seed (not a migration)

**Files:**
- Create: `seeds/local.sql`
- Modify: `package.json` (script only)

Do **not** put Farm in `migrations/`. Deploy must not create tenants.

Fixed Crockford ids (26 chars, no I/L/O/U):

```
org        01FARM00000000000000000001
principal  01FARM00000000000000000002
workspace  01FARM00000000000000000003
project    01FARM00000000000000000004
```

- [ ] **Step 1: Write `seeds/local.sql`**

`INSERT OR IGNORE` into `organization`, `principal` (human, display_name `Farm`), `workspace`, `stage` (three rows), `project` (parent_id NULL, name Farm), `membership` (owner). Timestamps `2010-01-01T00:00:00.000Z` (stable).

- [ ] **Step 2: Script**

```json
"seed:local": "wrangler d1 execute projthread --local --file=seeds/local.sql"
```

- [ ] **Step 3: Apply**

```bash
npx wrangler d1 migrations apply projthread --local
npm run seed:local
```

Expected: success. Re-run seed: no error (OR IGNORE).

- [ ] **Step 4: Commit**

```bash
git add seeds/local.sql package.json
git commit -m "chore: local Farm seed (not a migration)"
```

---

### Task 9: Pinia + kanban

**Files:**
- Modify: `package.json` — `npm install pinia` (vue-router already present)
- Modify: `package.json` test script to also run `src/app/stores/*.test.ts`
- Create: `src/app/stores/session.ts`
- Create: `src/app/stores/session.test.ts`
- Create: `src/app/stores/board.ts`
- Create: `src/app/stores/board.test.ts`
- Create: `src/app/router.ts`
- Create: `src/app/KanbanBoard.vue`
- Modify: `src/app/main.ts`
- Modify: `src/app/App.vue`

**Router:** `createWebHistory()`, one route `{ path: '/', component: App }` is unnecessary if App is the shell — use `createRouter` with `path: '/'` and read `route.query.workspace` / `route.query.project` (strings).

**Session store:** `loadMe()` GET `/api/me` `credentials: 'include'`. Single-flight (`if (loading) return`). 401 → `principal = null`, `memberships = []`. 200 → set both. `loaded` always true in `finally`.

**Board store:** `loadBoard(workspaceId, projectId)` single-flight. Parallel GET projects, stages, work-items (that `project_id`). Do not clear previous `items` until new payload arrives (no blank on refetch). `createCard(title)` POST then append or reload. `status` / `error` slugs (`loading` | `ready` | `error`). No PATCH/delete/stage.

**Session tests (mock `globalThis.fetch`):** 401; 200 with memberships; second `loadMe` while in-flight does not call fetch twice.

**Board tests:** second `loadBoard` while in-flight does not double-fetch; `createCard` POSTs `{ title, project_id }`.

**App.vue:**
- `loaded` false → nothing (or existing layout)
- no principal → heading `No session`
- principal, `memberships.length === 0` → heading `No workspace`
- else: if query missing `workspace` or `project`, `router.replace` with first membership’s `workspace_id` and that workspace’s root project (`parent_id == null` from GET projects — if query already has workspace, fetch projects then fill project). Then `<KanbanBoard>`. Show `principal.display_name` in a small header (`var(--muted)`).

**KanbanBoard.vue:** one column per stage (`position` order). Cards are title only; **no click handler** that navigates. Composer: text input + submit at the **backlog** column (or above the board) → `createCard`. No drag, no owner, no Prime, no hex — `var(--bg)` etc. Empty column is empty, not a skeleton row.

**main.ts:** `createPinia()` + `app.use(router)`.

- [ ] **Step 1: Install pinia; write failing store tests**

- [ ] **Step 2: Run store tests — expect FAIL**

- [ ] **Step 3: Stores + Vue**

- [ ] **Step 4: `npm test` — expect PASS**

- [ ] **Step 5: `npm run build` — expect PASS**

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/app
git commit -m "feat: kanban board with URL project filter"
```

---

### Task 10: Smoke + STATUS

**Files:**
- Modify: `docs/STATUS.md`

- [ ] **Step 1: Local smoke**

```bash
npm run build
npx wrangler d1 migrations apply projthread --local
npm run seed:local
npx wrangler dev
```

Hand / curl:

1. `GET /` without cookie → “No session”
2. `/admin` → create org **or** skip and mint seed principal `01FARM00000000000000000002`
3. Mint → `/` with cookie → kanban columns Backlog / Doing / Done
4. URL contains `workspace=01FARM00000000000000000003` and `project=01FARM00000000000000000004` (or the admin-created ids)
5. Composer creates a card; it appears in Backlog
6. `PATCH` stage via curl → 400
7. `GET /api/me` → `memberships` non-empty
8. Kill wrangler

- [ ] **Step 2: STATUS**

```
**Live:** local wrangler — Farm seed, membership, kanban (no moves, no room)
**Now:** next plan = room (not written)
```

- [ ] **Step 3: Commit**

```bash
git add docs/STATUS.md
git commit -m "docs: catalog slice live on wrangler dev"
```

---

## Out of scope

Room DO, WS, Activity / `work_item_event`, stage moves, owner, delete, extra projects UI, members UI, stage rename, PrimeVue, wiki, ETag, search `q`, LCA picker, second org, deploy seed, `POLICY_AUD`.
