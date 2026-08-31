# ProjThread PWA structure Implementation Plan

> For Grok Build: one session, one slice. Compact after each task. Scout only if a file is not where this plan says. Do not add tests the plan did not ask for. Stop when STATUS is updated. Do not dispatch reviewer or superpowers:subagent-driven-development sub-agents. Do not start OAuth. Do not start room MCP. Do not start operator CRUD, empty-tenant, or Config MCP. Do not add a UI kit (PrimeVue, Daisy, Nord).

**Goal:** Grow the PWA tree to pages, components, models, services, and a real router. Same product behavior. No new CRUD.

**Architecture:** vue-router owns surfaces. Worker serves `/index.html` for history paths (same pattern as `/admin`). Stores stay client SoR; `fetch` lives in `services/`. Types live in `models/`. Primitives extracted from screens that already exist. Admin SPA stays as it is.

**Tech Stack:** Vue 3, vue-router, Pinia (already in tree). `node --test --experimental-strip-types`. No new npm UI dependency. No new bindings.

---

## Locked calls (do not re-litigate)

| Topic | Call |
| --- | --- |
| Surfaces | Path owns the screen. `workspace` + `project` stay query (App already fills them). |
| Routes | `name: "kanban"` `/` · `wiki` `/wiki` · `config` `/config` · `room` `/room/:itemId`. Optional wiki `node` stays query. |
| Legacy | `/` with `wiki=1` → `/wiki`. `/` with `config=1` → `/config`. `/` with `item` → `/room/:itemId`. Drop those three query keys. Keep `workspace`, `project`, `node`. |
| History HTML | Worker `handleAppShell`: `/wiki`, `/config`, `/room/:itemId` (one segment) rewrite to `/index.html`. Do **not** add wrangler `not_found_handling`. Static `/`, `/assets/*`, `/sw.js`, manifest, icons pass through. |
| Components | Move `Modal.vue`, `Toast.vue` to `src/app/components/`. Add `PtButton.vue`, `PtField.vue`, `PtListRow.vue`. Wire existing dialogs/lists to them. No unused variants. |
| Models | Types only. Stores re-export the same names they export today so existing tests keep importing from stores if cheaper; pages may import from models. |
| Services | One `apiJson`. Domain files wrap paths. Views and `App.vue` do not call `fetch`. Stores catch `ApiError`: `401` → `no_session` where that status already exists; otherwise `error`. |
| Admin | Out. Same primitives later. |
| Product | No new HTTP. No delete/remove/reparent/owner picker/outline chrome. Pin, create card, move, wiki edit, config as today. |
| Tests | `node:test` on `.ts` only. Do not import `.vue` in tests (no Vue runner). Do not add vitest. |

### Routes (exact)

```ts
export const APP_ROUTES = [
  { name: "kanban", path: "/" },
  { name: "wiki", path: "/wiki" },
  { name: "config", path: "/config" },
  { name: "room", path: "/room/:itemId" },
] as const;
```

### Legacy rewrite (exact)

`src/app/legacy-query.ts`:

```ts
export function rewriteLegacyQuery(
  path: string,
  query: Record<string, string | undefined>,
): { path: string; query: Record<string, string> } | null {
  if (path !== "/" && path !== "") return null;
  const next: Record<string, string> = {};
  if (query.workspace) next.workspace = query.workspace;
  if (query.project) next.project = query.project;
  if (query.node) next.node = query.node;
  if (query.item) {
    return { path: `/room/${query.item}`, query: next };
  }
  if (query.wiki === "1") {
    return { path: "/wiki", query: next };
  }
  if (query.config === "1") {
    return { path: "/config", query: next };
  }
  return null;
}
```

Nav `is-active`: `route.name === "kanban"` (kanban includes room? **No.** Room is its own route; Kanban nav is not current on `/room/:id`. Today Kanban highlights when `item` is set. **Lock: on room, no nav `aria-current`.** Room has Back to board. Do not fake Kanban current.)

Today `kanbanNav` is true when `item` is set. Changing that is intentional: path is the surface.

### `apiJson` (exact)

```ts
export class ApiError extends Error {
  readonly status: number;
  constructor(status: number) {
    super("error");
    this.status = status;
  }
}

export async function apiJson<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body != null && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const res = await fetch(path, {
    ...init,
    credentials: "include",
    headers,
  });
  if (!res.ok) throw new ApiError(res.status);
  return (await res.json()) as T;
}
```

### Primitives

| Component | Job |
| --- | --- |
| `Modal` | Unchanged API: `open`, `title`, `labelledBy`, `close`. |
| `Toast` | Unchanged: `message`, `tone`. |
| `PtButton` | Props: `variant?: "default" \| "primary" \| "compact"`, native `type`, `disabled`. Default slot. Tokens only. |
| `PtField` | Props: `as?: "input" \| "textarea" \| "select"` (default input), `modelValue`, `label` → `aria-label`, plus `type`/`required`/`name` passed through. Select uses default slot for options. |
| `PtListRow` | Default slot (title control) + optional `meta` slot. Same list row flex as wiki/config. |

---

## File map

- `src/worker/shell.ts` — `isAppHistoryPath`, `handleAppShell`
- `src/worker/shell.test.ts` — `/wiki` `/config` `/room/:id` → `/index.html`; assets pass through
- `src/worker/index.ts` — call `handleAppShell` before bare `ASSETS.fetch`
- `src/app/legacy-query.ts` + `legacy-query.test.ts`
- `src/app/router.ts` — real routes, lazy pages, `beforeEach` legacy rewrite
- `src/app/models/` — `session.ts`, `board.ts`, `wiki.ts`, `config.ts`, `room.ts` (types moved)
- `src/app/services/http.ts` + `http.test.ts`
- `src/app/services/session.ts`, `catalog.ts`, `wiki.ts`, `room.ts` — path wrappers
- `src/app/stores/*.ts` — import services; re-export types
- `src/app/components/` — `Modal.vue`, `Toast.vue`, `PtButton.vue`, `PtField.vue`, `PtListRow.vue`
- `src/app/pages/` — `KanbanPage.vue`, `WikiPage.vue`, `RoomPage.vue`, `ConfigPage.vue` (move the four views)
- `src/app/App.vue` — shell + `<RouterView />`; nav uses named routes + place query
- `package.json` `test` glob: add `src/app/*.test.ts` `src/app/services/*.test.ts`
- docs after landing

Do not modify Worker catalog/wiki/mcp, room DO, `src/admin`, `wrangler.jsonc`, tokens, SW intercept rules (navigate already hits network).

---

## Out of this slice (explicit)

| Deferred | Why |
| --- | --- |
| Operator CRUD (16) | Spec order |
| Empty tenant / Config MCP | After 16 / 17 |
| Admin primitives | Separate SPA |
| Nested `/w/:workspaceId/...` | Query place is enough |
| Vue SFC tests / vitest | No runner |
| Design-system variants | Vacuum kit |

---

## STATUS.md after this slice

**Live:** … PWA routes `/` `/wiki` `/config` `/room/:itemId`; `src/app` pages/components/models/services.
**Now:** no open slice. Next named work is **operator CRUD** (plan 16 not written). Park Deploy. Do not start OAuth. Do not start room MCP. Do not start empty-tenant or Config MCP.
**Next:** write the operator-CRUD plan when José wants Config/card/wiki/workspace gaps filled.

---

### Task 1: Maps

Files: this plan, `docs/STATUS.md`, `AGENTS.md`, `docs/superpowers/plans/2026-08-26-projthread-v1.md`.

- [x] STATUS **Now:** execute this plan.
- [x] AGENTS **Now:** PWA-structure plan (see STATUS).
- [x] Index plan **15** file name + **Now:** execute 15.

---

### Task 2: App shell history (failing tests)

Files: `src/worker/shell.test.ts`, then `shell.ts`, `index.ts`.

- [ ] `isAppHistoryPath("/wiki")` true; `"/config"` true; `"/room/wi-1"` true; `"/room/wi-1/extra"` false; `"/"` false; `"/assets/x.js"` false; `"/admin"` false.
- [ ] `handleAppShell` GET `/wiki` and `/config` and `/room/wi-1` fetch pathname `/index.html`. GET `/sw.js` fetches `/sw.js`.
- [ ] Wire `src/worker/index.ts`: if `isAppHistoryPath`, `return handleAppShell(...)`. Else existing `ASSETS.fetch`.

Run: `node --test --experimental-strip-types src/worker/shell.test.ts` — fail then pass.

---

### Task 3: Legacy query helper

Files: `src/app/legacy-query.ts`, `src/app/legacy-query.test.ts`.

- [ ] `rewriteLegacyQuery("/", { wiki: "1", workspace: "w", project: "p" })` → `{ path: "/wiki", query: { workspace: "w", project: "p" } }` (no `wiki` key).
- [ ] `config=1` → `/config`. `item: "wi-1"` → `/room/wi-1`. `item` wins over `wiki`.
- [ ] `path: "/wiki"` → `null`. Bare `/` with only workspace/project → `null`.

Run: `node --test --experimental-strip-types src/app/legacy-query.test.ts`.

---

### Task 4: `apiJson`

Files: `src/app/services/http.ts`, `http.test.ts`.

- [ ] 200 JSON returns the body; `credentials` is `include`.
- [ ] 401 throws `ApiError` with `status === 401`.
- [ ] POST sets `content-type: application/json` when `body` is set.

Run: `node --test --experimental-strip-types src/app/services/http.test.ts`.

---

### Task 5: Models + services + stores

Files: `src/app/models/*`, `src/app/services/{session,catalog,wiki,room}.ts`, stores.

- [ ] Move exported types from each store into the matching `models/` file. Store files re-export them.
- [ ] Wrappers use `apiJson` (same URLs/bodies the store tests already assert):
  - `getMe` → `GET /api/me`
  - catalog: projects, stages, work-items, POST work-item, PATCH title, POST events, members, POST member, POST project, PATCH project, PATCH stages
  - wiki: list/get/create/patch/link/setPinned
  - room: GET work-item, GET events, POST events (already in room store)
- [ ] Stores call wrappers; `App.vue` `fillMissingQuery` uses `listProjects` (no raw `fetch`).
- [ ] Existing store tests stay green (still mock `globalThis.fetch`).

`package.json` test script includes `src/app/*.test.ts src/app/services/*.test.ts`.

Run: `npm test`.

---

### Task 6: Components + pages + router

Files: `src/app/components/*`, `src/app/pages/*`, `router.ts`, `App.vue`, the four moved views.

- [ ] `git mv` `Modal.vue` `Toast.vue` → `components/`. `git mv` the four views → `pages/{Kanban,Wiki,Room,Config}Page.vue`.
- [ ] Add `PtButton`, `PtField`, `PtListRow`. Replace duplicated native buttons/inputs/list rows **inside dialogs and wiki/config lists** with the primitives. Kanban column chrome can stay (not a list+dialog).
- [ ] `router.ts`: `createWebHistory`, routes from **Routes (exact)** with `defineAsyncComponent` page imports. `beforeEach`: if `rewriteLegacyQuery` returns, `next` that location.
- [ ] `App.vue`: `<RouterView />` instead of v-if views. Nav: `router.replace({ name, query: place })` where `place` is `{ workspace, project }` (and wiki keeps `node` only on wiki). Room links: `{ name: "room", params: { itemId }, query: place }`.
- [ ] Room Back → `{ name: "kanban", query: place }`. Wiki Back from node → `{ name: "wiki", query: place }` (drop `node`).
- [ ] `main.ts` still `app.use(router)`.

No Vue unit tests. Browser smoke when executing: `/`, `/wiki`, `/config`, open a card to `/room/:id`, Back, compact nav, legacy `/?wiki=1&workspace=…&project=…` lands on `/wiki`.

---

### Task 7: Land status

- [ ] STATUS / AGENTS / spec tree / index **Now** as “STATUS.md after this slice”.
- [ ] `npm test` green.
- [ ] Do not deploy unless José asks.

---

## Self-review

- Spec **structure** (routes, pages, components, models, services, no new CRUD): Tasks 2–6.
- Spec **admin same primitives**: deferred (locked).
- Spec **operator CRUD / empty tenant / Config MCP**: not this plan.
- SPA `/wiki` 404: Task 2 Worker rewrite, not wrangler.
- Tests never import `.vue`.
