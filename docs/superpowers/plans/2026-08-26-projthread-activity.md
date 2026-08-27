# ProjThread Activity Implementation Plan

> For Grok Build: one session, one slice, no sub-agent chain. Execute tasks in order in this same conversation. Stop when STATUS.md is updated. Do not dispatch reviewer sub-agents.

**Goal:** Persist work-item Activity on D1 first, append a `kind=activity` marker on the existing Room tape (`event_id` only), interleave those markers with chat by seq, filter Activity-only from D1, and move kanban cards via `stage_changed`.

**Architecture:** D1 is system of record (`work_item_event` + snapshot for stage/owner). Worker `POST /api/work-items/:id/events` commits D1, then RPC `Room.appendSystem({ event_id })` (retry once; never roll back D1). Open room = GET snapshot + GET events + WS replay. Board stays a D1 query; never `getByName` to render a list. Same `Room` class. No second DO. Event bodies never land on the tape.

**Tech Stack:** Existing Vue 3 + Pinia, Worker + D1, Wrangler 4 SQLite Durable Object RPC, `node --test --experimental-strip-types`. No vitest, no `cloudflare:test` pool, no PrimeVue, no wiki/nodes table, no R2.

---

## Locked calls (do not re-litigate)

| Topic | Call |
| --- | --- |
| SoR | D1 `work_item_event` plus `work_item.stage_key` / `owner_id` for those types. Tape is a seq marker, not the event. |
| Write path | `POST /api/work-items/:id/events` → D1 commit → `env.Room.getByName(work_item.id).appendSystem({ event_id })` → broadcast. |
| RPC | Public method on the **existing** `Room` class. No second DO. No second `fetch` path for append. Keep `fetch` for WS upgrade only. |
| Extends DurableObject | Allowed **only** if wrangler RPC requires `import { DurableObject } from "cloudflare:workers"`. Do not import that module from tests or `src/app`. Do not reopen hibernation (`ctx.acceptWebSocket`, never `server.accept()`). |
| Tape marker | `{ kind: "activity", body: "", actor_id: null, event_id, created_at }`. Body on tape is the empty string (column is NOT NULL). Real `body` stays on D1. |
| Idempotent marker | Unique `event_id` on tape (nullable for chat). Second `appendSystem` with the same `event_id` returns the existing row, no new seq. Makes Worker retry safe. |
| DO failure | Event remains on D1. Worker retries `appendSystem` **once**. Do not roll back D1. HTTP still **201**. Activity-only view lists from D1 without a tape marker. Chat timeline shows the event only when a marker exists (seq). |
| Open room | `GET /api/work-items/:id` stays the snapshot row (chrome). This slice adds `GET /api/work-items/:id/events` → `{ events }`. Client fetches **both**, then upgrades WS. Do not stuff events into the snapshot JSON. |
| Types | `stage_changed` (`from`,`to`, body **required**); `owner_changed` (`from`,`to`, body **optional**); `decision` / `occurrence` / `note` (body **required**). Optional `ref_node_id` (text, no FK — `node` table is Wiki). Append-only: no PATCH/DELETE events. |
| Body limit | Activity `body` max **2048** UTF-8 bytes. Empty/whitespace on a required body → **400**. |
| Stage/owner PATCH | Still **400**. Snapshot changes only through events. |
| Stage apply | `from` must equal current `stage_key`. `to` must be a `stage.key` for that workspace. Then set `work_item.stage_key = to`. |
| Owner apply | `from` must equal current `owner_id` (both null is fine). `to` null = unassign. Non-null `to` must have membership in the item's workspace. |
| JSON | Request: `{ type, from?, to?, body?, ref_node_id? }`. Response row uses D1 names: `from_value`, `to_value`. POST **201** `{ event, work_item }`. |
| Auth | Same as snapshot: no cookie **401**, not a member **403**, missing item **404**. |
| Fan-out | `appendSystem` broadcasts the same `type:message` frame as chat (includes `kind` + `event_id`) to all attached sockets including whoever is in the room. |
| Client last_seq | Max seq of **every** received `type:message` (chat and activity). Dedupe by seq. |
| Hydration | Tape `kind=activity` looks up `event_id` in the events map. Unknown id → GET events again. |
| Activity-only | Toggle lists **D1 events** (created_at ASC), not “filter the tape.” Missing markers still appear here. |
| Chat timeline | Tape seq order, hydrated. Do **not** insert unsequenced D1 rows into the chat list. |
| Board | D1 list. Moves = POST `stage_changed` (required body). Never wake a DO to render the board. |
| Owner PWA | API + tests only. No owner picker (no members list until Config). |
| Vite | Do not import `src/worker` or `src/room` from `src/app`. |
| Tests | `node --test --experimental-strip-types`. No vitest / cloudflare:test. Room class: tape unit tests + fake `RoomStub` on HTTP + wrangler smoke. Do not instantiate `WebSocketPair` in node:test. |
| Bindings | No R2, Vectorize, KV, Queues. No new wrangler DO class / migration tag. |

---

## File map

| Path | Job |
| --- | --- |
| `migrations/0003_activity.sql` | `work_item_event` + index |
| `src/worker/env.ts` | `RoomStub.appendSystem`; `D1Database.batch` |
| `src/worker/catalog.ts` | Event types + `listWorkItemEvents` + `commitWorkItemEvent` |
| `src/worker/catalog.test.ts` | Memory store event commit / list |
| `src/worker/catalog-http.ts` | GET/POST `/api/work-items/:id/events` |
| `src/worker/catalog-http.test.ts` | 401/403/404/400/201 + retry + no rollback |
| `src/worker/room-http.test.ts` | `stubCatalog` new methods |
| `src/worker/me.test.ts` | `stubCatalog` new methods |
| `src/worker/admin.test.ts` | `stubCatalog` / memory new methods |
| `src/room/tape.ts` | `ACTIVITY_BODY_MAX_BYTES`, `appendActivity`, unique event_id |
| `src/room/tape.test.ts` | Marker seq, empty body, idempotent event_id |
| `src/room/room.ts` | `appendSystem` + broadcast; `ensureSchema` unique index |
| `src/app/stores/room.ts` | Events map, last_seq all kinds, `postEvent`, `activityOnly` |
| `src/app/stores/room.test.ts` | Parallel GET events, activity line, reconnect cursor |
| `src/app/RoomView.vue` | Stage control, activity composer, Activity-only toggle |
| `src/app/stores/board.ts` | `moveCard` POST `stage_changed` |
| `src/app/stores/board.test.ts` | moveCard payload |
| `src/app/KanbanBoard.vue` | Per-card stage `<select>` + move reason |
| `docs/STATUS.md` | After smoke |
| `AGENTS.md` | Now line after landing |
| `docs/superpowers/plans/2026-08-26-projthread-v1.md` | After landing: write Wiki plan |

Do not add `node` table, R2, Channels, child rooms, PrimeVue, typing frames, Chores, PATCH stage/owner.

---

## Out of this slice (explicit)

| Deferred | Why |
| --- | --- |
| Wiki / `node` / Markdown / `ref_node_id` resolution | Spec slice 5. Store `ref_node_id` as nullable text; no FK; do not GET nodes. |
| Owner picker in the PWA | Config (members UI). HTTP `owner_changed` still ships. |
| PATCH `stage_key` / `owner_id` | Still forbidden. Events only. |
| Drag-and-drop kanban | Native `<select>` is enough. Named absence is draggable **windows**, not this; still skip drag. |
| Channels (one socket, many rooms) | Named absence. v1 remains **one WS per room**. |
| Child rooms, R2 checkpoint, MCP, Vectorize, typing frames, PrimeVue, Chores | Named absences / later plans. |
| Retry pipeline / Queues | Retry once in the POST. No Queue binding. |

---

## STATUS.md after this slice

When Task 9 lands (not when this file is only written):

    **Live:** local wrangler — Farm seed, membership, kanban moves (`stage_changed`), room chat + Activity markers on DO tape (reconnect last_seq), Activity-only from D1
    **Now:** write the **Wiki plan** (nodes, Markdown reader, links, promote). Do not implement Wiki until that plan exists.
    **Next after the plan:** implement only what the Wiki plan names.
    **Landed plans:** `docs/superpowers/plans/2026-08-26-projthread-catalog.md`, `docs/superpowers/plans/2026-08-26-projthread-room.md`, `docs/superpowers/plans/2026-08-26-projthread-activity.md`
    **Index:** `docs/superpowers/plans/2026-08-26-projthread-v1.md`
    **Spec:** `docs/superpowers/specs/2026-08-26-projthread-v1-design.md`

---

### Task 1: Maps

**Files:**
- This file (already written)
- `docs/STATUS.md`
- `AGENTS.md`
- `docs/superpowers/plans/2026-08-26-projthread-v1.md`

The plan-writing turn already pointed STATUS at this file. If `docs/STATUS.md` **Plan:** is this path, **skip this task**.

- [ ] **Step 1:** STATUS **Now:** execute the **Activity plan**. Do not start Wiki. **Plan:** this file. Live unchanged (kanban still “no moves” until Task 8).

- [ ] **Step 2:** AGENTS **Now:** Activity plan (see STATUS). Do not claim Activity is live.

- [ ] **Step 3:** Index Activity row file `2026-08-26-projthread-activity.md`. **Now:** execute plan 4 only. Leave Wiki as *(write after 4)*.

- [ ] **Step 4: Commit** (docs only)

```bash
git add AGENTS.md docs/STATUS.md docs/superpowers/plans/2026-08-26-projthread-activity.md docs/superpowers/plans/2026-08-26-projthread-v1.md
git commit -m "docs: activity plan (D1-then-DO events, interleaved seq)"
```

---

### Task 2: D1 `work_item_event`

**Files:**
- Create: `migrations/0003_activity.sql`
- Modify: `src/worker/catalog.ts`
- Modify: `src/worker/catalog.test.ts`
- Modify every `CatalogStore` stub: `src/worker/catalog-http.test.ts`, `src/worker/room-http.test.ts`, `src/worker/me.test.ts`, `src/worker/admin.test.ts`

- [ ] **Step 1: Migration**

```sql
CREATE TABLE work_item_event (
  id TEXT PRIMARY KEY,
  work_item_id TEXT NOT NULL REFERENCES work_item(id),
  organization_id TEXT NOT NULL REFERENCES organization(id),
  type TEXT NOT NULL CHECK (type IN (
    'stage_changed',
    'owner_changed',
    'decision',
    'occurrence',
    'note'
  )),
  from_value TEXT,
  to_value TEXT,
  body TEXT,
  actor_id TEXT NOT NULL REFERENCES principal(id),
  ref_node_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_work_item_event_item
  ON work_item_event (work_item_id, created_at);
```

No `node` FK. Local only: `npx wrangler d1 migrations apply projthread --local` when you smoke, not in this task.

- [ ] **Step 2: Types + store methods** in `catalog.ts`

```ts
export type WorkItemEventType =
  | "stage_changed"
  | "owner_changed"
  | "decision"
  | "occurrence"
  | "note";

export type WorkItemEventRow = {
  id: string;
  work_item_id: string;
  organization_id: string;
  type: WorkItemEventType;
  from_value: string | null;
  to_value: string | null;
  body: string | null;
  actor_id: string;
  ref_node_id: string | null;
  created_at: string;
};

export type WorkItemEventCommit = {
  event: WorkItemEventRow;
  stage_key?: string;
  owner_id?: string | null;
  updated_at?: string;
};
```

Add to `CatalogStore`:

```ts
listWorkItemEvents(workItemId: string): Promise<WorkItemEventRow[]>;
commitWorkItemEvent(commit: WorkItemEventCommit): Promise<void>;
```

`listWorkItemEvents`: `SELECT ... FROM work_item_event WHERE work_item_id = ? ORDER BY created_at ASC, id ASC`.

`commitWorkItemEvent` on D1: `db.batch` of `INSERT` plus optional `UPDATE work_item SET stage_key/owner_id, updated_at`. If only the event, still one INSERT (batch of one is fine). Add `batch` to `D1Database` in `env.ts`:

```ts
batch(statements: D1PreparedStatement[]): Promise<unknown>;
```

Memory catalogs: insert into a `Map`; if `stage_key` / `owner_id` present, patch the work item. Stubs: `unused`.

- [ ] **Step 3: Failing tests** in `catalog.test.ts` (memory store)

After insertTenantBundle + insertWorkItem `wi-1` stage backlog:

1. `commitWorkItemEvent` with `type: "note"`, body `"keep"`, then `listWorkItemEvents("wi-1")` length 1, same row. `getWorkItem` stage still `backlog`.
2. `commitWorkItemEvent` with `type: "stage_changed"`, `from_value: "backlog"`, `to_value: "doing"`, `stage_key: "doing"`, `updated_at` set → item.stage_key is `doing`.
3. `listWorkItemEvents("missing")` is `[]`.

- [ ] **Step 4: Implement until `npm test` PASS** (stubs compile).

- [ ] **Step 5: Commit**

```bash
git add migrations/0003_activity.sql src/worker/catalog.ts src/worker/catalog.test.ts src/worker/catalog-http.test.ts src/worker/room-http.test.ts src/worker/me.test.ts src/worker/admin.test.ts src/worker/env.ts
git commit -m "feat: work_item_event D1 table and catalog commit"
```

---

### Task 3: Tape `appendActivity`

**Files:**
- Modify: `src/room/tape.ts`
- Modify: `src/room/tape.test.ts`

Export `ACTIVITY_BODY_MAX_BYTES = 2048`.

```ts
export function rejectActivityBody(
  body: string | null | undefined,
  required: boolean,
): "empty" | "too_large" | null {
  const text = body ?? "";
  if (text.trim() === "") return required ? "empty" : null;
  if (utf8Bytes(text) > ACTIVITY_BODY_MAX_BYTES) return "too_large";
  return null;
}
```

Extend `Tape`:

```ts
appendActivity(input: {
  event_id: string;
  created_at: string;
}): TapeMessage;
```

`memoryTape.appendActivity`: if `event_id` is empty/whitespace throw `Error("empty")`. If a message already has that `event_id`, return it (no push). Else push `{ seq: n, kind: "activity", body: "", actor_id: null, event_id, created_at }`.

Export `TAPE_EVENT_ID_INDEX`:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS message_event_id
  ON message (event_id) WHERE event_id IS NOT NULL
```

`sqlTape` (in `room.ts`, next task) runs `TAPE_SCHEMA` then this index in `ensureSchema`. This task only needs memoryTape.

- [ ] **Step 1: Failing tests**

`rejectActivityBody`: required `""` / `"  "` → `empty`; optional `""` → `null`; 2048 ascii `a` → `null`; 2049 → `too_large`.

`memoryTape`: chat then activity → seq 1 chat, seq 2 activity, `body === ""`, `event_id` set, `actor_id === null`. `replay(1)` is the activity row. Second `appendActivity` same `event_id` returns seq 2, `lastSeq()` stays 2. Empty `event_id` throws, `lastSeq` 0.

- [ ] **Step 2: Run `src/room/tape.test.ts` — expect FAIL**

- [ ] **Step 3: Implement**

- [ ] **Step 4: Tape tests PASS. Full `npm test` PASS.**

- [ ] **Step 5: Commit** `feat: tape appendActivity marker by event_id`

---

### Task 4: `Room.appendSystem`

**Files:**
- Modify: `src/worker/env.ts`
- Modify: `src/room/room.ts`

```ts
export type RoomStub = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  appendSystem(input: { event_id: string }): Promise<TapeMessage>;
};
```

Do not import `TapeMessage` from `src/room` into `src/app`. `env.ts` may duplicate a tiny return shape or import from `../room/tape.ts` (worker side only). Prefer a structural type in `env.ts`:

```ts
appendSystem(input: { event_id: string }): Promise<{
  seq: number;
  kind: "activity";
  body: string;
  actor_id: null;
  event_id: string;
  created_at: string;
}>;
```

`sqlTape.appendActivity`: `INSERT ... kind='activity', body='', actor_id=NULL, event_id=?`. On unique conflict, `SELECT` existing row by `event_id`. `ensureSchema` executes `TAPE_SCHEMA` then `TAPE_EVENT_ID_INDEX`.

`Room.appendSystem({ event_id })`:

```ts
async appendSystem(input: { event_id: string }) {
  const eventId = input.event_id?.trim() ?? "";
  if (!eventId) throw new Error("empty");
  const row = this.tape.appendActivity({
    event_id: eventId,
    created_at: new Date().toISOString(),
  });
  const frame = messageFrame(row);
  for (const socket of this.ctx.getWebSockets()) {
    socket.send(frame);
  }
  return row;
}
```

Hibernation handlers unchanged. WS still rejects non-chat payloads.

If wrangler `dev` later cannot RPC a class that does not extend `DurableObject`, add:

```ts
import { DurableObject } from "cloudflare:workers";
export class Room extends DurableObject<Env> { ... super(ctx, env); }
```

Do that only when smoke proves it. Do not add it “just in case.”

No node:test for the class. Coverage is tape + HTTP fake stub + Task 9 smoke.

- [ ] **Step 1: Types + sqlTape.appendActivity + Room.appendSystem**

- [ ] **Step 2: `npm test` still PASS** (HTTP fakes must add `appendSystem` if they construct a full `RoomNamespace`; room-http tests only use `fetch` — add `appendSystem: unused` on those stubs if TypeScript requires it).

- [ ] **Step 3: Commit** `feat: Room.appendSystem RPC appends activity marker`

---

### Task 5: HTTP events (D1 first, retry once)

**Files:**
- Modify: `src/worker/catalog-http.ts`
- Modify: `src/worker/catalog-http.test.ts`

Replace `matchWorkItemId` with a path that allows `/events`:

```ts
function matchWorkItemPath(
  pathname: string,
): { id: string; events: boolean } | null {
  const prefix = "/api/work-items/";
  if (!pathname.startsWith(prefix)) return null;
  const rest = pathname.slice(prefix.length);
  const slash = rest.indexOf("/");
  if (slash === -1) {
    return rest && !rest.includes("/") ? { id: rest, events: false } : null;
  }
  const id = rest.slice(0, slash);
  const tail = rest.slice(slash + 1);
  if (!id || tail !== "events") return null;
  return { id, events: true };
}
```

Use `env` (drop the `_env` ignore). GET item / PATCH item unchanged. If `events && GET` → `listWorkItemEvents` after the same 404/403 as snapshot. If `events && POST` → validate, `commitWorkItemEvent`, then:

```ts
const stub = env.Room.getByName(item.id);
try {
  await stub.appendSystem({ event_id: event.id });
} catch {
  try {
    await stub.appendSystem({ event_id: event.id });
  } catch {
    // keep D1
  }
}
const work_item = await catalog.getWorkItem(item.id);
return Response.json({ event, work_item }, { status: 201 });
```

Validation (all **400** `{ error: "bad_request" }`):

- body not a record; `type` not one of the five
- `rejectActivityBody(body, required)` where required = type !== `owner_changed`
- `stage_changed`: `from` and `to` strings; `from !== item.stage_key`; `to` not in `catalog.listStages(item.workspace_id)`
- `owner_changed`: `from` is string or null; must equal `item.owner_id`; `to` string or null; if `to` string, `getMembership(item.workspace_id, to)` must exist
- `decision` / `occurrence` / `note`: store `from_value`/`to_value` null (ignore extra `from`/`to`)
- `ref_node_id`: omit or string; empty string → null; do not look up nodes

`stage_changed` commit includes `stage_key: to` and `updated_at`. `owner_changed` includes `owner_id: to` and `updated_at`.

POST uses `newId()` for event id, `created_at = new Date().toISOString()`, `actor_id = principal.id`.

- [ ] **Step 1: Failing HTTP tests** (extend `memoryCatalog` with events map; tests that POST need `env.Room`)

Use a counting stub:

```ts
function roomEnv(append: (event_id: string) => Promise<unknown>): Env {
  return {
    APP_ORIGIN: ORIGIN,
    Room: {
      getByName: () => ({
        fetch: async () => new Response(null, { status: 500 }),
        appendSystem: async ({ event_id }) => append(event_id) as never,
      }),
    },
  } as Env;
}
```

Cases:

1. GET `/api/work-items/:id/events` 401 without cookie
2. GET events 403 outsider (same outsider pattern as snapshot)
3. GET events 404 missing id
4. GET events 200 `{ events: [] }` on a real item
5. POST `note` `{ type: "note", body: "  hi  " }` 201; event.body `"  hi  "` or trimmed? **Lock: store the string as sent, reject only when `trim()===""`.** appendSystem called once with that event id. GET events length 1.
6. POST `stage_changed` `{ type, from: "backlog", to: "doing", body: "start" }` 201; `work_item.stage_key === "doing"`; GET snapshot matches
7. POST `stage_changed` empty body → 400; stage stays backlog; appendSystem **not** called
8. POST `stage_changed` `from: "doing"` while item is backlog → 400
9. POST `stage_changed` `to: "nope"` → 400
10. PATCH still 400 if `stage_key` in body
11. POST `decision` body `""` → 400
12. POST `owner_changed` `{ type, from: null, to: <member id> }` 201; `work_item.owner_id` set; body omitted OK
13. POST `owner_changed` `to` outsider principal id → 400
14. First `appendSystem` throws, second resolves → 201, event in D1, call count 2
15. Both throws → 201, event in D1, call count 2, GET events still lists it

- [ ] **Step 2: Run catalog-http tests — expect FAIL**

- [ ] **Step 3: Implement routing + POST**

- [ ] **Step 4: `npm test` PASS**

- [ ] **Step 5: Commit** `feat: POST work-item events D1-first then appendSystem`

---

### Task 6: Pinia room store

**Files:**
- Modify: `src/app/stores/room.ts`
- Modify: `src/app/stores/room.test.ts`

Replace `ChatLine` with a tape line:

```ts
export type TapeLine = {
  seq: number;
  kind: "chat" | "activity";
  body: string;
  actor_id: string | null;
  event_id: string | null;
  created_at: string;
};

export type ActivityEvent = {
  id: string;
  work_item_id: string;
  type: string;
  from_value: string | null;
  to_value: string | null;
  body: string | null;
  actor_id: string;
  ref_node_id: string | null;
  created_at: string;
};
```

Keep exporting `lines` as `TapeLine[]` (includes activity). Add `events: ref<ActivityEvent[]>([])`, `activityOnly: ref(false)`.

`lastSeq()` = max seq on `lines` (all kinds).

`open`: single-flight unchanged. Parallel:

```ts
const [snapRes, eventsRes] = await Promise.all([
  fetch(`/api/work-items/${nextItemId}`, { credentials: "include" }),
  fetch(`/api/work-items/${nextItemId}/events`, { credentials: "include" }),
]);
```

401 on either → `no_session`. Other non-OK → `error`. Parse events `{ events }`. Then `connect()`.

On `type:message` and `kind === "chat" | "activity"`: append if seq unseen.

If `kind === "activity"` and no event in `events` with that `event_id`, GET events again (single-flight a `refreshEvents()`; ignore failure).

`postEvent(payload)`: POST JSON credentials include; 201 → push/replace event in `events`, set `item` from `work_item` (id, title, stage_key, owner_id). Do not send on the WebSocket. Live marker arrives via WS.

`RoomItem` gains optional `owner_id: string | null`.

Existing tests: open now makes **2** fetches. Update “GETs the work-item snapshot” to assert both URLs. Single-flight: `calls === 2` (one snapshot, one events), not 1.

New tests:

- open fetches `/api/work-items/wi-1/events`
- activity message seq 2 with known event_id stays in `lines` with `kind: "activity"`; last_seq reconnect after close 1006 is `last_seq=2` even if no chat
- `postEvent({ type: "note", body: "x" })` POSTs `/api/work-items/wi-1/events`

- [ ] **Step 1: Failing store tests** (update counts first — they fail)

- [ ] **Step 2: Implement store**

- [ ] **Step 3: `npm test` PASS**

- [ ] **Step 4: Commit** `feat: room store hydrates activity events and last_seq`

---

### Task 7: RoomView (chrome + composer + filter)

**Files:**
- Modify: `src/app/RoomView.vue`

Header: title, current `stage_key`, `<select aria-label="Stage">` of… RoomView does not have stages. **Lock:** stage control lives on the **board**. Room chrome shows `stage_key` as text. Activity composer + filter live in the room. (Avoid a second stages fetch this slice; board already has stages.)

Composer **two** forms:

1. Chat (existing)
2. Activity: `<select aria-label="Activity type">` options `note`, `decision`, `occurrence`; `<textarea aria-label="Activity body">`; submit `room.postEvent({ type, body })`. Disable unless `status === "ready"`.

Toggle: button `Activity only` sets `room.activityOnly = true/false`. When true, render `room.events` (id as `:key`) as type + body + optional `from_value → to_value`. When false, render `lines` in seq order: chat shows `body`; activity shows hydrated event or a muted `Activity` placeholder if not yet loaded.

Keep tokens (`--fg`, `--muted`, `--accent`). No PrimeVue. No new colors.

- [ ] **Step 1: Implement the template** (no Vue test runner; Pinia covers the store)

- [ ] **Step 2: `npm test` PASS**

- [ ] **Step 3: Commit** `feat: room activity composer and activity-only filter`

---

### Task 8: Kanban moves

**Files:**
- Modify: `src/app/stores/board.ts`
- Modify: `src/app/stores/board.test.ts`
- Modify: `src/app/KanbanBoard.vue`

`moveCard(itemId, to, body)`:

```ts
async function moveCard(itemId: string, to: string, body: string): Promise<void> {
  const item = items.value.find((row) => row.id === itemId);
  if (!item) return;
  const reason = body.trim();
  if (!reason) return;
  if (to === item.stage_key) return;
  const res = await fetch(`/api/work-items/${itemId}/events`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "stage_changed",
      from: item.stage_key,
      to,
      body: reason,
    }),
  });
  if (!res.ok) {
    status.value = "error";
    error.value = "error";
    return;
  }
  const payload = (await res.json()) as { work_item: WorkItem };
  items.value = items.value.map((row) =>
    row.id === itemId ? payload.work_item : row,
  );
}
```

Board UI: one input `aria-label="Move reason"` (required). Each card is an `<article class="card">` containing a `router-link` on the title (keep `item` query) and a `<select aria-label="Stage">` bound to `item.stage_key`. `@change` calls `board.moveCard(item.id, value, reason)`. Empty reason: do not POST.

- [ ] **Step 1: Failing board test** — after `loadBoard`, `moveCard("i1", "doing", "start")` POSTs the JSON above to `/api/work-items/i1/events`. Fake 201 `{ event: {}, work_item: { ...item, stage_key: "doing" } }`. Store item stage is `doing`.

- [ ] **Step 2: Implement store + template**

- [ ] **Step 3: `npm test` PASS**

- [ ] **Step 4: Commit** `feat: kanban stage_changed moves via work-item events`

---

### Task 9: Smoke + STATUS

**Files:**
- Modify: `docs/STATUS.md`
- Modify: `AGENTS.md`
- Modify: `docs/superpowers/plans/2026-08-26-projthread-v1.md`

- [ ] **Step 1:** `npm test` PASS.

- [ ] **Step 2:** `npx wrangler d1 migrations apply projthread --local`. `npm run seed:local` if the DB was reset. `npm run build` then `npx wrangler dev`.

- [ ] **Step 3: HTTP/WS** (Farm cookie from `/admin`, principal `01FARM00000000000000000002`)

Create or use a card id `WI`.

```bash
# empty required body
curl -sS -o /tmp/pt-a.json -w "%{http_code}" -X POST "$ORIGIN/api/work-items/WI/events" \
  -H "Cookie: $COOKIE" -H "content-type: application/json" \
  -d '{"type":"note","body":""}'
# expect 400

# note
curl -sS -D - -X POST "$ORIGIN/api/work-items/WI/events" \
  -H "Cookie: $COOKIE" -H "content-type: application/json" \
  -d '{"type":"note","body":"farm note"}'
# expect 201, event id

# stage
curl -sS -X POST "$ORIGIN/api/work-items/WI/events" \
  -H "Cookie: $COOKIE" -H "content-type: application/json" \
  -d '{"type":"stage_changed","from":"backlog","to":"doing","body":"start"}'
# expect 201, work_item.stage_key doing

# list
curl -sS "$ORIGIN/api/work-items/WI/events" -H "Cookie: $COOKIE"
# expect both events

# outsider 403 (existing outsider cookie from room smoke) POST events
```

WS: connect `GET /api/rooms/WI?last_seq=0` with cookie. Replay includes `kind:activity` frames with `event_id` matching D1 and `body:""`. Chat still works. Reconnect `last_seq` after the activity seq does not duplicate.

PWA: board select moves the card; room composer posts a note; Activity-only toggle lists D1 events; chat timeline shows the marker once WS delivers it.

- [ ] **Step 4:** If RPC `appendSystem` is missing at runtime, **then** extend `DurableObject` as locked in Task 4, re-smoke. Do not do it earlier.

- [ ] **Step 5:** STATUS / AGENTS / index to the “after this slice” block. **Now** is write Wiki plan, not implement Wiki.

- [ ] **Step 6: Commit** `docs: activity slice live (D1 events, tape markers, kanban moves)`

Stop. Do not start Wiki.

---

## Spec coverage (self-check)

| Spec | Task |
| --- | --- |
| D1 SoR; POST D1 then `Room.appendSystem` | 5, 4 |
| Retry once; no D1 rollback; Activity-only from D1 | 5, 6, 7 |
| Open GET snapshot + event bodies | 5, 6 |
| Tape `kind=activity` + `event_id`; seq not wall clock | 3, 4, 9 |
| Types + required/optional body | 5 |
| Activity body 2 KiB; empty required 400 | 3, 5 |
| Schema `work_item_event` + index | 2 |
| Board D1; card moves = `stage_changed` | 8 |
| Catalog still forbids stage/owner PATCH | 5 (existing tests stay) |
| RPC on existing Room; no second DO; no event body on tape | 4 |
| Wiki / Channels / child rooms / R2 / PrimeVue / typing | Out of slice |
