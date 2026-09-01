# ProjThread operator CRUD Implementation Plan

> For Grok Build: one session, one slice. Compact after each task. Scout only if a file is not where this plan says. Do not add tests the plan did not ask for. Stop when STATUS is updated. Do not dispatch reviewer or superpowers:subagent-driven-development sub-agents. Do not start OAuth. Do not start room MCP. Do not start empty-tenant or Config MCP. Do not add a UI kit (PrimeVue, Daisy, Nord). Do not add card/node/project archive or delete.

**Goal:** Make the PWA operable: workspace on the session, project forest as filter chrome, Config/card/wiki mutations the minimum Config still lacks, reverse attach on the room.

**Architecture:** D1 `session.workspace_id` is last place (opaque cookie/Bearer unchanged). App HTTP grows only where the PWA has no verb. Stage chrome is one tree on kanban, wiki, and room. Stores keep calling `apiJson` wrappers. Admin SPA stays as it is (`POST /api/admin/organizations` still mints a new principal; PWA create does not).

**Tech Stack:** Vue 3, Pinia, vue-router (in tree). D1 migration `0007`. `node --test --experimental-strip-types`. No new npm UI dependency. No new bindings.

---

## Locked calls (do not re-litigate)

| Topic | Call |
| --- | --- |
| Workspace | Bound on `session.workspace_id`. Picker writes `PATCH /api/me`. `/api/me` and `session_briefing` read it. Not a URL query. Not a refresh token. |
| Project | Forest **filter**, not a session column, not required in the URL. Ignore leftover `?workspace=` / `?project=` as place. Filter is in-memory this slice (tree selection). Unfiltered / root = descendant work-items (already). Filing a card uses the selected project or the root. |
| Stage chrome | Same tree on **kanban, wiki, room**. Hide on config. Desktop: right. Mobile: expandable filters under compact nav, max-height `80dvh`. Not a graph canvas. |
| Room nodes | Wiki density on the card. `GET`/`POST /api/work-items/:id/nodes`. Open wiki at `{ name: "wiki", query: { node } }`. |
| Deletes | **Out.** No card/node/project archive or DELETE. Spec: only with HTTP; do not add those verbs here. |
| Stage keys | Stay `backlog` / `doing` / `done`. Labels/order already PATCH. |
| Members | Owner may `PATCH` role and `DELETE` a member. Last owner → `400` `{ error: "last_owner" }`. |
| Reparent | `PATCH /api/projects/:id` may send `parent_id` (string or `null`). Cycle → `400`. Other workspace → `400`. Name-only PATCH still works. |
| Workspace create | `POST /api/organizations { name }` **session** auth. Current principal becomes owner. **No** new principal. Default stages + root project. Then PWA `PATCH /api/me` to the new workspace. |
| Admin | Out. Do not change `insertTenantBundle` principal mint. |
| MCP | `workspaceId()`: explicit arg, else `me.workspace_id` if it is a membership, else sole membership, else `workspace_required`. Instructions sentence below. No new tools. |
| Hydration | Out (later slice). |
| Tests | `node:test` on `.ts` only. Do not import `.vue`. |

### `GET /api/me` (exact)

```json
{
  "principal": { "id": "...", "type": "human", "display_name": "..." },
  "memberships": [],
  "workspace_id": null
}
```

`workspace_id` is the column on **this** session row (`string \| null`). Never infer on the Worker.

### `PATCH /api/me` (exact)

Body `{ "workspace_id": "<id>" }`. `401` no session. `400` if missing/empty or not a membership of this principal. `200` same shape as GET.

### `POST /api/organizations` (exact)

Session required. Body `{ "name": "..." }` non-empty trimmed. `201`:

```json
{
  "organization": { "id": "...", "name": "..." },
  "workspace": { "id": "...", "name": "..." },
  "project": { "id": "...", "name": "...", "parent_id": null }
}
```

### Members (exact)

- `PATCH /api/workspaces/:ws/members/:principalId` `{ "role": "owner" \| "member" }` — caller must be owner. Last owner demoted → `400 last_owner`.
- `DELETE /api/workspaces/:ws/members/:principalId` — caller must be owner. Last owner removed → `400 last_owner`. `204` empty.

### Work-item nodes (exact)

- `GET /api/work-items/:id/nodes` → `{ "nodes": [{ "id", "title", "type", "summary" }] }` membership 403, missing item 404.
- `POST /api/work-items/:id/nodes` `{ "node_id": "..." }` — same-workspace node, else `400`. `201` inserted / `200` exists. Same row as `POST /api/nodes/:id/work-items`.

### Wiki list filter

`GET /api/workspaces/:ws/nodes?project_id=` optional. When set, descendants of that project (existing `descendantIds`). A node matches if `node_project` hits that set **or** `node_work_item` → `work_item.project_id` in that set. Omit query = all workspace nodes (today).

### MCP instructions (replace the last sentence)

Was: `One membership: omit workspace_id.`

New exact:

`Session may bind workspace; omit workspace_id when bound or when there is one membership.`

---

## File map

- `migrations/0007_session_workspace.sql`
- `src/worker/session.ts` — `SessionRow.workspace_id`, `updateSessionWorkspace`
- `src/worker/me.ts` — GET includes `workspace_id`; PATCH
- `src/worker/catalog.ts` — `insertWorkspaceFor`, `updateMembershipRole`, `deleteMembership`, `updateProjectParent`
- `src/worker/catalog-http.ts` — organizations POST, members PATCH/DELETE, project `parent_id`
- `src/worker/wiki.ts` / `wiki-http.ts` — list filter; work-item nodes GET/POST
- `src/worker/index.ts` — `/api/organizations`; `/api/work-items/:id/nodes` → wiki **before** catalog; `/api/workspaces/:id/members/:pid`
- `src/worker/mcp.ts` — `workspaceId` + instructions
- `src/app/services/*`, stores, `App.vue`, pages
- `src/app/components/ProjectTree.vue` — forest list; selected id; `@select`
- docs after landing

Do not modify room DO, `src/admin` (except if a type import breaks — prefer not), tokens, SW intercept, `wrangler.jsonc` SPA flag.

---

## Out of this slice (explicit)

| Deferred | Why |
| --- | --- |
| Empty tenant / drop Farm | Plan 17 |
| Config MCP | Plan 18 |
| Card/node/project DELETE | No HTTP on purpose |
| `node_project` write UI | Filter reads the table; attach via work item is enough |
| Persist project filter in URL | José: not place |
| Local snapshot / ETag | Later |
| OAuth / refresh token | Absence |
| Graph canvas | Absence |
| Admin primitives | Separate SPA |

---

## STATUS.md after this slice

**Live:** … session `workspace_id`; PWA workspace picker; project tree filter on kanban/wiki/room; reverse attach on the room; Config member role/remove, project reparent, workspace create; owner picker.
**Now:** no open slice. Next named work is **empty tenant** (plan 17 not written). Park Deploy. Do not start OAuth. Do not start room MCP. Do not start Config MCP.
**Next:** write empty-tenant when José wants Farm gone.

---

### Task 1: Maps

Files: this plan, `docs/STATUS.md`, `AGENTS.md`, `docs/superpowers/plans/2026-08-26-projthread-v1.md`.

- [x] STATUS **Now:** execute this plan.
- [x] AGENTS **Now:** operator-CRUD plan (see STATUS).
- [x] Index plan **16** file name + **Now:** execute 16.

---

### Task 2: Session workspace (failing tests)

Files: `migrations/0007_session_workspace.sql`, `src/worker/session.ts`, `src/worker/me.ts`, `src/worker/me.test.ts`.

```sql
ALTER TABLE session ADD COLUMN workspace_id TEXT REFERENCES workspace(id);
```

- [ ] `GET /api/me` 200 includes `workspace_id: null` for a fresh session.
- [ ] `PATCH /api/me` `{ workspace_id: <membership> }` 200 and later GET returns that id.
- [ ] `PATCH` outsider workspace `400`. No session `401`. GET still `401` without cookie/Bearer.

`SessionRow.workspace_id: string | null`. `insertSession` writes `null`. `getSession` SELECTs the column. `updateSessionWorkspace(id, workspaceId)`.

`handleMe`: GET as today plus `workspace_id` from `getSession`. PATCH: parse body, membership check, update, return GET shape.

Run: `node --test --experimental-strip-types src/worker/me.test.ts` — fail then pass. Apply `0007` local D1 when running wrangler (`wrangler d1 migrations apply projthread --local`).

---

### Task 3: App workspace create

Files: `src/worker/catalog.ts`, `catalog-http.ts`, `index.ts`, `catalog-http.test.ts`.

- [ ] Session `POST /api/organizations` `{ name: "Keep" }` 201; membership owner is the **caller**, not a new principal; stages minted; one root project.
- [ ] Empty name `400`. No session `401`.
- [ ] Admin `POST /api/admin/organizations` still creates a **new** principal (existing tests stay green).

`insertWorkspaceFor(principalId, name)`: org + workspace + root project + default stages + membership owner. Do not insert principal.

Wire `index.ts`: `pathname === "/api/organizations"` → catalog handler (session, not Access).

Run: `node --test --experimental-strip-types src/worker/catalog-http.test.ts`.

---

### Task 4: Members PATCH / DELETE

Files: `catalog.ts`, `catalog-http.ts`, `catalog-http.test.ts`.

Match `PATCH|DELETE /api/workspaces/:ws/members/:principalId` (principalId one segment). Caller `getMembership` role must be `owner`, else `403`.

- [ ] Owner PATCH `{ role: "member" }` on another owner when a second owner exists → 200.
- [ ] PATCH/DELETE the sole owner → `400` `{ error: "last_owner" }`.
- [ ] Member caller → `403`.
- [ ] DELETE other member → `204`; GET members no longer lists them.

`updateMembershipRole`, `deleteMembership`, `countOwners(workspaceId)`.

Run: same catalog-http test file.

---

### Task 5: Project reparent

Files: `catalog-http.ts` `patchProject`, `catalog.ts` `updateProjectParent`, `catalog-http.test.ts`. Use `wouldCycle` from `src/lib/project-tree.ts`.

Today PATCH with `parent_id` is `400`. Change:

- Body may include `name` and/or `parent_id`.
- `parent_id: null` → root.
- `parent_id: string` → must be same workspace, `wouldCycle` false.
- Name omitted → keep name.

- [ ] Existing test “PATCH project with parent_id is 400” **becomes** 200 when parent is a valid sibling/root and cycle-checked.
- [ ] Cycle (parent = self or descendant) `400`.
- [ ] Name-only PATCH still 200 (existing rename test).

Run: catalog-http tests.

---

### Task 6: Reverse attach

Files: `wiki.ts`, `wiki-http.ts`, `index.ts`, `wiki-http.test.ts`.

`index.ts` **before** `handleCatalog`:

```ts
if (/^\/api\/work-items\/[^/]+\/nodes$/.test(url.pathname)) {
  return handleWiki(request, env, store, catalog, wiki);
}
```

- [ ] GET empty `{ nodes: [] }`. After `POST /api/nodes/:id/work-items`, GET work-item nodes includes `{ id, title, type, summary }`.
- [ ] POST `{ node_id }` 201 then 200. Other-workspace node `400`. No session `401`.

`listNodesForWorkItem`, reuse `linkNodeWorkItem`.

Run: `node --test --experimental-strip-types src/worker/wiki-http.test.ts`.

---

### Task 7: Wiki list `?project_id=`

Files: `wiki.ts` `listNodes(workspaceId, projectIds?: string[])`, `wiki-http.ts` GET, `wiki-http.test.ts`. `descendantIds` on `listProjects`.

- [ ] Unfiltered GET still returns a node with no links.
- [ ] `?project_id=<child>` omits a node only linked (via `node_work_item`) to a card on the **root**, includes a node linked to a card on the child.

`node_project` rows also match (SQL `OR`). No PWA writer for `node_project` this slice.

Run: wiki-http tests.

---

### Task 8: MCP uses bound workspace

Files: `src/worker/mcp.ts`, `mcp.test.ts`.

`workspaceId`: after loadMe, if no explicit arg and `typeof me.workspace_id === "string"` and it is in memberships, return it (even if memberships.length > 1).

- [ ] Two memberships, session PATCH to A, `session_briefing` without `workspace_id` briefings A (not `workspace_required`).
- [ ] Instructions last sentence is the locked string.

Existing one-membership and two-memberships-unbound tests stay: unbound + two still `workspace_required`.

Run: `node --test --experimental-strip-types src/worker/mcp.test.ts`.

---

### Task 9: PWA session + drop URL place

Files: `src/app/models/session.ts`, `services/session.ts`, `stores/session.ts`, `session.test.ts`, `App.vue`, pages that copy `workspace`/`project` into `router` query.

- [ ] `getMe` type includes `workspace_id: string | null`. `patchMe({ workspace_id })`.
- [ ] Store: `workspaceId`. `loadMe` sets it. If `null` and `memberships[0]`, `patchMe` that id then set (one extra fetch). Single-flight still on `loadMe`.
- [ ] `App.vue`: **delete** `fillMissingQuery` and `workspace`/`project` on nav `query`. Nav `replace({ name })` only. Wiki keeps `node` on wiki routes only.
- [ ] Kanban/wiki/config/room load from `session.workspaceId`, not `route.query.workspace`.
- [ ] Room / kanban links: `{ name: "room", params: { itemId } }` with **no** place query.
- [ ] Store tests: GET body with `workspace_id`; auto-PATCH when null.

Picker UI can wait for Task 10; store must be bound first.

Run: `npm test` (session + board/wiki/config/room still mock fetch).

---

### Task 10: Project tree chrome

Files: `src/app/components/ProjectTree.vue`, `App.vue`, `src/app/stores/board.ts` (projects already loaded) or a tiny `place` store. Prefer **board store** `filterProjectId` (`string | null`) + `setFilter(id)` so kanban list/create use it. Wiki `loadList` passes filter. Room tree still shows (filter does not hide the open card).

`ProjectTree` props: `projects: { id, parent_id, name }[]`, `selectedId: string | null` (null = whole workspace / highlight root), `emit('select', id | null)`. Indent by depth. Tokens only. No extra variants.

`App.vue` shell: `aside.tree` on desktop (`grid-template-columns: 13rem minmax(0,1fr) 13rem`) when `route.name` is `kanban` | `wiki` | `room` and session has workspace. Compact: a `PtButton` “Filters” toggles a panel `max-height: 80dvh; overflow: auto` under the rail.

Workspace picker: `PtField as="select"` of memberships in the rail (or filters panel on compact). `@change` → `patchMe`.

Load projects for the tree via existing `listProjects` (board already does; wiki/room must load projects if board is cold — call `listProjects` from App when workspaceId set).

No Vue tests. Browser smoke in Task 12.

---

### Task 11: Config mutations

Files: `services/catalog.ts`, `stores/config.ts`, `config.test.ts`, `pages/ConfigPage.vue`.

- [ ] `patchMember(ws, principalId, role)`, `deleteMember(ws, principalId)`, `createOrganization(name)`, `patchProject(id, { name?, parent_id? })`.
- [ ] Store: `removeMember`, `setRole`, `createWorkspace` (POST org then `session.patchMe` + `loadMe`). Reparent control: parent select on each project (existing rename stays).
- [ ] Owner-only buttons still hit the API; `403`/`last_owner` → `status = "error"`.
- [ ] Tests: PATCH/DELETE URLs; POST `/api/organizations`.

Run: `src/app/stores/config.test.ts`.

---

### Task 12: Owner picker, wiki outline, room nodes

Files: `pages/RoomPage.vue`, `KanbanPage.vue` (optional owner on card — **room is enough**), `WikiPage.vue`, `services/wiki.ts`, `stores/wiki.ts`, `stores/room.ts`.

**Owner:** Room header select of `config`/`catalog` members (GET members if not loaded). `postEvent({ type: "owner_changed", from: item.owner_id, to })`. `to` may be `null` (unassign). Existing HTTP.

**Wiki node view:** render `includes` and `refs` from GET (already in payload; store must keep them). Dialogs: child id → existing POST includes/refs. Attach work item stays. List filter: `loadList(ws, filterProjectId)`.

**Room nodes:** `GET /api/work-items/:id/nodes` on open; list titles → `router.push({ name: "wiki", query: { node: id } })`. Attach dialog: node id → POST work-item nodes.

Wiki store tests: filter query string; keep includes/refs on openNode. Room store test: GET nodes URL.

Run: `npm test`.

Browser (wrangler + Farm session): picker if two workspaces (create one in Config); tree on `/` `/wiki` `/room/:id`; compact Filters 80dvh; room node list; Back; Config reparent and add/remove member (do not strand last owner). Apply `0007` local.

---

### Task 13: Land status

- [ ] STATUS / AGENTS / spec session row / index **Now** as “STATUS.md after this slice”.
- [ ] `npm test` green.
- [ ] Do not deploy unless José asks. Remote D1 has no `0007` until then.

---

## Self-review

- Spec **Stage chrome**: Tasks 2, 9, 10.
- Spec **operator CRUD** members/reparent/owner/workspace create/attach reverse/outline: Tasks 3–6, 11–12.
- Spec **archive/delete only with HTTP**: out (locked).
- Spec **empty tenant / Config MCP / OAuth**: out.
- Tests never import `.vue`.
- Admin org-create principal mint unchanged.
