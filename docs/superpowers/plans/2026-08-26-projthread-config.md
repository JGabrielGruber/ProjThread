# ProjThread Config Implementation Plan

> For Grok Build: one session, compact. Scout only if a file is not where this plan says. Do not add tests this plan did not ask for. Do not dispatch reviewer or superpowers:subagent-driven-development sub-agents. Stop when STATUS is updated.

**Goal:** Smallest PWA operator Config: list/add members, create/rename projects (forest via `parent_id` on create), edit stage labels/order. PrimeVue on the Config screen only.

**Architecture:** D1 catalog already has `membership`, `project`, `stage`. Extend `CatalogStore` + `catalog-http` (no new Worker module, no migration). Client: lazy `ConfigView` on query `config=1`. PrimeVue Dialog/Button/InputText/Select, list + dialog, not DataGrid Pro. Kanban/room/wiki stay our Vue + tokens.

**Tech Stack:** Existing Vue 3 + Pinia, Worker + D1, `node --test --experimental-strip-types`. Add **primevue** (and the gospel theme package current PrimeVue requires) in Task 4. No vitest, no `cloudflare:test`, no new wrangler bindings.

This slice is **smaller than Activity and Wiki**: no migration, no new store file on the Worker, no DO/tape, no RoomView/KanbanBoard/WikiView edits, no owner picker.

---

## Locked calls (do not re-litigate)

| Topic | Call |
| --- | --- |
| Kit | **PWA config = PrimeVue.** Product screens (kanban / room / wiki) stay our Vue + tokens. **No Prime import** from `main.ts`, `KanbanBoard.vue`, `RoomView.vue`, `WikiView.vue`, `src/admin/*`. |
| Admin | Do **not** Prime-ify `/admin` this slice. Super-admin already mints principals/orgs. |
| SoR | Existing D1 tables. No new migration. `wrangler.jsonc` unchanged (DB + Room). |
| Auth | Same cookie as catalog. No cookie **401**; not a member **403**; missing workspace/project **404**. Any member may config (no owner-only gate). |
| Members GET | `GET /api/workspaces/:id/members` → `{ members }` each `{ principal_id, display_name, type, role }`. D1 JOIN `principal`. |
| Members POST | `{ principal_id, role? }`. Omit role → `member`. Role must be `owner` or `member`. Unknown principal → **400** (`sessions.getPrincipal`). Duplicate PK → **200** same member (idempotent). New → **201** `{ member }`. |
| Members UI | List + dialog. Add by **principal id** text (from `/admin`). No directory, no remove, no role PATCH. |
| Projects GET | Already ships. Unchanged. |
| Projects POST | `POST /api/workspaces/:id/projects` `{ name, parent_id? }`. Name trim required. `parent_id` omit/null = extra root. Else parent must exist in this workspace. **201** `{ project }`. |
| Projects PATCH | `PATCH /api/projects/:id` `{ name }` only. Empty name **400**. `parent_id` in body → **400** (reparent deferred). 404/403 as catalog. |
| Projects UI | List name + parent. Dialog create (name + parent select including root). Rename dialog. No delete, no drag-reparent. |
| Stages GET | Already ships. Unchanged. |
| Stages PATCH | `PATCH /api/workspaces/:id/stages` `{ stages: [{ key, label, position }] }`. Must be **exactly** the existing keys (no add/delete keys). Label trim required. Then UPDATE label+position. **200** `{ stages }` (list order). |
| Stages UI | List key (read-only), label, position. Save writes the full set. |
| Owner picker | **Deferred.** `owner_changed` HTTP already ships. Wiring a picker into Room/Kanban is not cheap (product screens, no Prime there). |
| Client | Query params. `item` wins, then wiki, then `config=1`, then board. Lazy `ConfigView` like `WikiView`. |
| Prime load | `defineAsyncComponent` ConfigView. A tiny `src/app/prime.ts` imported **only** by ConfigView installs PrimeVue + gospel theme once. Do not `app.use(PrimeVue)` in `main.ts`. |
| Vite | Do not import `src/worker` or `src/room` from `src/app`. |
| Tests | `node --test --experimental-strip-types`. No Vue test runner. No extra cases. |
| Leave alone | `wrangler.jsonc`, `src/room/*`, `RoomView.vue`, `KanbanBoard.vue`, `WikiView.vue`, `src/admin/*`, wiki Worker files, named absences. |

## File map

Copy this plan into the working tree at `docs/superpowers/plans/2026-08-27-projthread-config.md` in Task 1 (from the wiki or pickup). Do not git add it.

| Path | Job |
| --- | --- |
| `docs/superpowers/plans/2026-08-27-projthread-config.md` | This plan (local / wiki; not a GitHub commit) |
| `src/worker/catalog.ts` | `WorkspaceMemberRow` + listMembers / insertMembership / insertProject / updateProjectName / replaceStages |
| `src/worker/catalog.test.ts` | Memory store cases below |
| CatalogStore stubs the compiler names | `unused` for new methods |
| `src/worker/catalog-http.ts` | members + POST projects + PATCH stages + PATCH `/api/projects/:id` |
| `src/worker/catalog-http.test.ts` | 401/403/400/201/200 |
| `src/worker/index.ts` | Dispatch `/api/projects` to `handleCatalog` (workspaces already does) |
| `src/app/prime.ts` | Lazy PrimeVue + gospel theme, once |
| `src/app/stores/config.ts` | Pinia list/add/create/rename/saveStages |
| `src/app/stores/config.test.ts` | fetch URLs + single-flight |
| `src/app/ConfigView.vue` | Prime list + dialogs |
| `src/app/App.vue` | header Config + lazy ConfigView |
| `package.json` | add primevue (+ theme pkg) in Task 4 |
| `docs/STATUS.md`, `AGENTS.md`, v1 index | After smoke; no git commit |

Do not add a migration. Do not bind R2. Do not touch Room DO.

---

## Out of this slice (explicit)

| Deferred | Why |
| --- | --- |
| Owner picker on board/room | Not cheap; would edit product Vue. API `owner_changed` stays. |
| Reparent / cycle UI / PATCH `parent_id` | Forest = create with parent. `wouldCycle` already exists for later. |
| Remove member, PATCH role | List + add is enough to dogfood. |
| Add/delete stage keys | Spec: mint backlog/doing/done keys; labels may be renamed. |
| Delete / archive project | Not required to operate the board. |
| PrimeVue on `/admin` | Spec kit allows it; this plan is PWA Config only. |
| Workspace create in PWA | Super-admin `POST /api/admin/organizations` already mints root + stages. |
| DataGrid Pro, drag-and-drop, fancy tree | Spec: list + dialog. |
| Skin + PWA installability | Plan 7. |
| Deploy (`APP_ORIGIN`, Access, domain) | Plan 8. Thin workers.dev origin already exists. |
| MCP, Vectorize, R2, Channels, Chores, promote, child rooms | Named absences / other plans. |

---

## STATUS.md after this slice

When Task 5 lands (not when this file is only written):

**Live:** local wrangler — Farm seed, membership, kanban moves (`stage_changed`), room chat + Activity markers on DO tape (reconnect last_seq), Activity-only from D1, wiki markdown nodes + work-item links (no promote), PWA Config (members, create/rename projects, stage labels/order; PrimeVue on config only)
**Now:** write the **Skin + PWA plan** (tokens Grok/X-sharp, installability). Do not implement Skin until that plan exists.
**Next after the plan:** implement only what the Skin plan names.
**Landed plans:** catalog, room, activity, wiki, Config (this slice; plan lives on the wiki / pickup, not as a GitHub-required commit)
**Index:** `docs/superpowers/plans/2026-08-26-projthread-v1.md`
**Spec:** `docs/superpowers/specs/2026-08-26-projthread-v1-design.md`

---

### Task 1: Maps (copy, do not git add)

**Source (first that exists):** ProjThread wiki Config plan, or `/workspace/projthread-pickup/2026-08-27-projthread-config.md`.

**Dest:** `docs/superpowers/plans/2026-08-27-projthread-config.md`

- [ ] Step 1: Copy the plan to dest. **Do not `git add`. Do not commit.**
- [ ] Step 2: `docs/STATUS.md` **Now:** execute the Config plan. Do not start Skin. **Plan:** this dest path. Live unchanged (wiki still the live product).
- [ ] Step 3: `AGENTS.md` **Now:** Config plan (see STATUS). Do not claim Config is live.
- [ ] Step 4: Index Config row file `2026-08-27-projthread-config.md`. Ships: PrimeVue PWA dialogs — members list/add, create/rename projects, stage labels/order; owner picker deferred. **Now:** execute plan 6 only. Leave Skin as *(write after 6)*.

No commit. José keeps the plan on the wiki.

---

### Task 2: CatalogStore writes

**Files:** `src/worker/catalog.ts`, `src/worker/catalog.test.ts`. Stubs: add `unused` for new methods wherever TypeScript names them (`catalog-http.test.ts`, `wiki-http.test.ts`, `room-http.test.ts`, `me.test.ts`, `admin.test.ts`). Scout only if a stub file is missing from that list.

```ts
export type WorkspaceMemberRow = {
  workspace_id: string;
  principal_id: string;
  display_name: string;
  type: "human" | "agent" | "service";
  role: "owner" | "member";
};

export type MembershipWrite = {
  workspace_id: string;
  principal_id: string;
  role: "owner" | "member";
};
```

Add to `CatalogStore`:

```ts
listMembers(workspaceId: string): Promise<WorkspaceMemberRow[]>;
insertMembership(row: MembershipWrite): Promise<"inserted" | "exists">;
insertProject(row: ProjectRow & { created_at: string }): Promise<void>;
updateProjectName(id: string, name: string): Promise<boolean>;
replaceStages(workspaceId: string, stages: StageRow[]): Promise<boolean>;
```

- `listMembers`: SELECT membership + principal JOIN by workspace_id. Memory: join the bundle principals map; if a principal row is missing, `display_name` empty string, `type` `"human"`.
- `insertMembership`: `INSERT OR IGNORE`; then inspect whether the row was new (`inserted`) or already there (`exists`). Do not change role on exists.
- `insertProject`: INSERT all columns including `created_at`.
- `updateProjectName`: UPDATE name; missing id → `false`.
- `replaceStages`: load existing keys for the workspace; if the incoming key set differs → `false` and write nothing. Else UPDATE `label`, `position` per key. Memory: same.

Failing tests after `insertTenantBundle` (sampleBundle in `catalog.test.ts`):

1. `listMembers("ws-1")` length 1, `principal_id` `prin-1`, `display_name` José, `role` `owner`. `listMembers("other")` empty.
2. `insertMembership` for `prin-2` role member → `inserted`; second call → `exists`; list length 2.
3. `insertProject` child under `proj-1` named Barn; `listProjects` includes it with that parent.
4. `updateProjectName("proj-1", "Farm")` true; missing id false.
5. `replaceStages` with same three keys, reorder doing first label Now → true; list order matches. Missing `done` or extra `nope` → false; labels unchanged.

- [ ] Step 1: Types + failing tests.
- [ ] Step 2: Implement until `src/worker/catalog.test.ts` PASS. Full suite compiles (stubs `unused`).
- [ ] Step 3: Stop. No commit.

---

### Task 3: HTTP members / projects / stages

**Files:** `src/worker/catalog-http.ts`, `src/worker/catalog-http.test.ts`, `src/worker/index.ts` only.

`WORKSPACE_RESOURCES` add `"members"`. `handleCatalog` already has `sessions`.

Workspace routes (member of `:id`):

- `GET members` → `{ members: await catalog.listMembers(id) }`
- `POST members` JSON `{ principal_id, role? }`. `principal_id` nonempty string. `role` omit → `member`; else must be `owner` or `member`. `sessions.getPrincipal(principal_id)` null → **400**. Then `insertMembership`. `inserted` → **201**, `exists` → **200**. Body `{ member: { principal_id, display_name, type, role } }` from the principal + written role.
- `POST projects` JSON `{ name, parent_id? }`. Name trim empty → **400**. `parent_id` undefined/null → root. Else `getProject(parent_id)` must exist and `workspace_id` match; else **400**. `newId()` + `created_at`. `insertProject`. **201** `{ project }` (id, workspace_id, organization_id, parent_id, name). Organization id from membership.
- `PATCH stages` JSON `{ stages: [...] }`. Not an array → **400**. Map each item: `key`/`label` strings, `position` finite number (store as integer). Label trim empty → **400**. Build `StageRow[]` with this `workspace_id`. `replaceStages` false → **400**. Else **200** `{ stages: await catalog.listStages(id) }`.

Project route: pathname `/api/projects/:id` (no extra segment).

- `PATCH` load `getProject`; missing **404**; `getMembership(project.workspace_id, principal.id)` missing **403**. JSON record; if `"parent_id" in body` → **400**. `name` trim empty → **400**. `updateProjectName`. **200** `{ project: await catalog.getProject(id) }`.

`index.ts`: catalog dispatch also when `url.pathname.startsWith("/api/projects")`. Wiki nodes branch stays first.

HTTP tests: reuse catalog-http memory + mintCookie + farmBundle / memberContext. Extend memory catalog with the new methods (copy behavior from Task 2). Session store must `getPrincipal` for POST members.

Cases:

1. GET members no cookie → 401
2. Outsider cookie → 403
3. Member GET members 200; includes seeded owner `principal_id`
4. POST members `{ principal_id }` of a principal that exists in sessions but is not a member → 201, `role` `member`; GET length +1
5. Same POST again → 200, still one extra row
6. POST `{ principal_id: "missing" }` → 400
7. POST `{ principal_id, role: "nope" }` → 400
8. POST projects `{ name: "Barn", parent_id: seeded root }` → 201, parent_id set
9. POST `{ name: "   " }` → 400
10. POST `{ name: "X", parent_id: "other-ws-project" }` → 400
11. PATCH `/api/projects/:root` `{ name: "Farm" }` → 200, name Farm
12. PATCH `{ name: "Farm", parent_id: null }` → 400, name unchanged
13. PATCH stages full key set, swap labels/positions → 200, GET stages matches
14. PATCH stages missing a key → 400

- [ ] Step 1: Failing tests + routing.
- [ ] Step 2: Implement. Suite PASS.
- [ ] Step 3: Stop. No commit.

---

### Task 4: Pinia + Prime ConfigView + App nav

**Files:** create `src/app/prime.ts`, `src/app/stores/config.ts`, `src/app/stores/config.test.ts`, `src/app/ConfigView.vue`. Modify `src/app/App.vue`. Add **primevue** (latest; do not invent a version) and the gospel theme package current PrimeVue docs require (Aura or equivalent). Scout only if the import path is not obvious.

`src/app/prime.ts`: export `ensurePrime(app)` (or install on first import via app context). Use PrimeVue with gospel theme preset. Idempotent. **Only ConfigView imports this file.**

Pinia `useConfigStore`: fields `workspaceId`, `members`, `projects`, `stages`, `status` (loading|ready|error|no_session), `error`, `loading`. Single-flight. credentials include.

- `load(workspaceId)` parallel GET members, projects, stages under `/api/workspaces/:id/`. Any 401 -> no_session. Other non-OK -> error.
- `addMember({ principal_id, role? })` POST members; 200/201 update list.
- `createProject({ name, parent_id })` POST projects; 201 append.
- `renameProject(id, name)` PATCH `/api/projects/:id`; 200 patch local.
- `saveStages(stages)` PATCH stages; 200 replace.

Failing Pinia tests (fake fetch, same as wiki/board):

1. load("ws1") GETs the three URLs with credentials include.
2. Second load while in-flight does not double-fetch (calls === 3).
3. 401 -> no_session.
4. addMember({ principal_id: "p2" }) POSTs that JSON to members.
5. createProject({ name: "Barn", parent_id: "root" }) POSTs to projects.
6. renameProject("root", "Farm") PATCHes `/api/projects/root`.
7. saveStages([...]) PATCHes stages.

`ConfigView.vue`: query workspace id (same queryString helper as App). On workspace, config.load. PrimeVue Button opens Dialogs:

- Members: list display_name + role. Dialog: InputText principal id (aria-label Principal id), Select role default member, submit addMember.
- Projects: list name + parent name or root. Dialog create: name + parent Select (null = root). Per row rename Dialog.
- Stages: inputs for each label + position; Save -> saveStages (send key, label, position for every row).

No hex. Status text like WikiView. Disable submit unless ready.

`App.vue`: defineAsyncComponent ConfigView. configQuery = query config===1. Template: RoomView if itemQuery; else WikiView if wikiQuery; else ConfigView if configQuery; else KanbanBoard if hasBoardQuery. Header Config control: replace query with workspace, project, config=1 (drop item, wiki, node). Do not edit RoomView / KanbanBoard / WikiView.

- [ ] Step 1: Install deps. Failing store tests.
- [ ] Step 2: prime.ts + ConfigView + App. Suite PASS. App build still works (Prime in the config async chunk, not worker).
- [ ] Step 3: Stop. No commit.

---

### Task 5: Smoke + STATUS

**Files:** `docs/STATUS.md`, `AGENTS.md`, `docs/superpowers/plans/2026-08-26-projthread-v1.md`

- [ ] Step 1: Test suite PASS.
- [ ] Step 2: Local D1 already migrated (no new SQL). Re-seed if needed. Build app+admin, wrangler dev.

Step 3: HTTP smoke with Farm cookie from /admin, principal 01FARM00000000000000000002, workspace 01FARM00000000000000000003, root project 01FARM00000000000000000004. Create a second principal in /admin (id P2).

- GET members -> 200, includes Farm owner.
- POST members { principal_id: P2 } -> 201 then 200 on repeat.
- POST members unknown id -> 400.
- POST projects { name: "Barn", parent_id: root } -> 201.
- PATCH /api/projects/:barn { name: "Barn 1" } -> 200. PATCH with parent_id -> 400.
- PATCH stages rename doing label; GET stages shows it. Kanban columns use the new label after reload (do not edit KanbanBoard).
- Outsider GET members -> 403.
- PWA: header Config -> Prime dialogs add member, create child project, rename stage. Wiki / room / board still have no Prime.

- [ ] Step 4: STATUS / AGENTS / index to the after this slice block. Now is write Skin + PWA plan, not implement Skin. Index Config ships line: owner picker not in this landing.
- [ ] Step 5: **Do not git add. Do not commit.** Stop. Do not start Skin.

---

## Spec coverage (self-check)

| Spec | This slice |
| --- | --- |
| PWA config PrimeVue list + dialog (not DataGrid Pro) | Yes |
| Members / projects / stages | Yes (list+add; create+rename; labels/order) |
| Lazy Prime on config only; no Prime on tape/kanban/wiki | Yes |
| Project forest parent_id; cycle-checked writes | Create with parent (no cycle). PATCH parent deferred |
| Stage keys minted; labels may be renamed | Yes; no add/delete keys |
| Membership roles owner or member | Yes on add |
| Super-admin PrimeVue | Deferred (admin stays tokens) |
| Owner on work item | API already; picker deferred |
| MCP / Vectorize / R2 / Channels / Chores / promote | Out |

## Confirmed against main (do not rediscover)

- package.json dependencies: marked, pinia, vue, vue-router. **No primevue.** Add it in Task 4.
- wrangler.jsonc: DB + Room only. Do not add bindings.
- catalog-http.ts: GET projects/stages/work-items, POST work-items, PATCH title, events. **No members write, no POST/PATCH project, no PATCH stages.** WORKSPACE_RESOURCES = projects, stages, work-items.
- CatalogStore: list/get project, list stages, getMembership (one principal), no listMembers / insert project / replaceStages.
- src/lib/project-tree.ts already has wouldCycle — do not call it this slice (no reparent).
- Admin App.vue is tokenized Vue (principals, org mint, session mint). Not Prime. Leave it.
- PWA routing is query params (workspace, project, item, wiki, node). Config follows with config=1. item still wins.
- KanbanBoard.vue already renders stage.label and loads projects via the board store. Leave it; reload picks up Config writes.
- Activity locked owner PWA as API-only until Config; this plan still skips the picker.
- Thin workers.dev origin already exists. This plan is product Config, not Deploy.
