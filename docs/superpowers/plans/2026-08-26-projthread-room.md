# ProjThread Room Implementation Plan

> For Grok Build: one session, one slice, no sub-agent chain. Execute tasks in order in this same conversation. Stop when STATUS.md is updated.

**Goal:** Click a kanban card, open its room, upgrade a cookie-authenticated WebSocket to a Durable Object named by `work_item.id`, send/receive plain-text chat, persist on the DO tape, reconnect with `last_seq`.

**Architecture:** Worker stays thin: cookie to D1 session to `work_item` row to membership to stub to `Room` DO. The board never talks to a DO. Chat never writes D1. Tape lives in DO SQLite (`kind=chat` only this slice). PWA is static; Worker runs for `/api/*` and the WS upgrade. Idle sockets hibernate (`ctx.acceptWebSocket`, never `server.accept()`). No keystroke frames.

**Tech Stack:** Existing Vue 3 + Pinia + vue-router, Worker + D1, Wrangler 4 SQLite Durable Object, `node --test --experimental-strip-types`. No vitest, no cloudflare vitest pool, no PrimeVue, no Activity table, no R2.

---

## Locked calls (do not re-litigate)

| Topic | Call |
| --- | --- |
| Binding | wrangler binding **`Room`**, class **`Room`**, `new_sqlite_classes`. `env.Room.getByName(work_item.id)`. |
| Open card | URL query `item=<work_item.id>` (keep `workspace` + `project`). Spec URL contract. Not `/room/:id`. |
| Snapshot | `GET /api/work-items/:id` returns the D1 row (title, stage_key, and the rest). 401 / 403 / 404 same as PATCH. No events. |
| Upgrade | `GET /api/rooms/:id` plus `Upgrade: websocket` plus `pt_session`. Query `last_seq` (integer >= 0, default `0`). |
| Auth | No/expired/revoked cookie: **401** JSON, no 101. Not a member of the item workspace: **403**. Missing item: **404**. Non-WS GET: **400** `{ error: "bad_request" }`. Invalid `last_seq`: **400**. |
| Close code | If a socket must die for no session after accept: **4001**. Prefer 401 before 101. |
| Principal to DO | Worker sets `X-Pt-Principal: <principal.id>` on the forwarded upgrade. Client cannot reach the DO. Missing header: DO close 4001. |
| Client to DO | `{ "type": "chat", "body": "<plain text>" }` only. Empty/whitespace: error frame, no append. UTF-8 byte length > **8192**: error frame, no append. |
| DO to client (replay + live) | `{ "type": "message", "seq", "kind", "body", "actor_id", "event_id", "created_at" }`. This slice always `kind: "chat"`, `event_id: null`. |
| Catch-up | After replay of `seq > last_seq`, send `{ "type": "caught_up", "last_seq": <max seq or 0> }` then live frames. |
| Error frame | `{ "type": "error", "error": "bad_request" }`. Do not close the socket. |
| Fan-out | Broadcast the message frame to **all** attached sockets including sender. |
| Tape | DO SQLite `message(seq INTEGER PK AUTOINCREMENT, kind, body, actor_id, event_id, created_at)`. `kind` CHECK in (`chat`, `activity`). This slice **writes chat only**. No `appendSystem`. |
| Client render | Show `kind === "chat"` lines. Ignore unknown types except `caught_up` / `error`. Forward-compat for Activity. |
| Reconnect | On close other than 4001, one automatic reconnect with `last_seq` = last received message seq (0 if none). No poll. No backoff maze. 4001: slug `no_session`, do not reconnect. |
| Keystrokes | Composer submit only. Do not send typing / per-keystroke frames. |
| Vite | Do **not** import `src/worker` or `src/room` from `src/app` (vite root is `src/app`). Duplicate the tiny wire types in the Pinia store. |
| Board | Kanban stays D1. Never `getByName` to render a list. |

---

## File map

| Path | Job |
| --- | --- |
| `wrangler.jsonc` | `Room` DO binding + sqlite class migration tag |
| `src/worker/env.ts` | `Room` namespace type |
| `src/worker/index.ts` | `export { Room }`; dispatch `/api/rooms` |
| `src/worker/catalog-http.ts` | `GET /api/work-items/:id` |
| `src/worker/catalog-http.test.ts` | GET snapshot 200/401/403/404 |
| `src/worker/room-http.ts` | Cookie, membership, upgrade stub |
| `src/worker/room-http.test.ts` | 401/403/404/400 + `getByName` dispatch |
| `src/room/tape.ts` | Schema + append + replay (injectable) |
| `src/room/tape.test.ts` | Seq, replay cursor, body limits |
| `src/room/room.ts` | Hibernatable DO class |
| `src/app/stores/room.ts` | Pinia: snapshot, WS, last_seq, send |
| `src/app/stores/room.test.ts` | Fake `WebSocket`; reconnect cursor |
| `src/app/RoomView.vue` | Chrome + tape + composer + back |
| `src/app/KanbanBoard.vue` | Cards navigate with `item` |
| `src/app/App.vue` | `item` query to lazy `RoomView` |
| `package.json` | `test` glob includes `src/room/*.test.ts` |
| `docs/STATUS.md` | After smoke |
| `AGENTS.md` | Now: room (then Activity after landing) |
| `docs/superpowers/plans/2026-08-26-projthread-v1.md` | Room file name; **Now:** plan 3 |

Do not add `work_item_event`, Activity HTTP, stage PATCH, owner, wiki, R2, PrimeVue, typing, attachments.

---

## Out of this slice (explicit)

The room is usable as a chat. These wait:

| Deferred | Why |
| --- | --- |
| Activity / `work_item_event` / `appendSystem` / Activity-only filter | Spec slice 4. Tape schema already has `kind=activity` + `event_id` so it can land without a migration. Opening a room does **not** GET event bodies this slice. |
| Stage PATCH / owner assignment | Catalog still forbids them. Activity will own `stage_changed` / `owner_changed`. |
| Wiki / nodes / Markdown on tape | Spec slice 5. Chat stays plain text. |
| R2 transcript checkpoint | Named absence. DO SQLite is the live log. |
| Typing indicators as messages | Free-tier: do not bill keystrokes as DO requests. |
| File attachments | R2 unbound. |
| cloudflare:test / miniflare DO tests | Quota. `node:test` on tape + upgrade HTTP + fake WS + wrangler smoke. |
| Dedicated `/room/:id` route | Spec URL holds `item`. Keep the dummy `/` router. |
| Channels, child rooms, Chores, MCP, Vectorize, Google OAuth, PrimeVue on the PWA | Named absences / later plans. |

---

## STATUS.md after this slice

When Task 9 lands (not when this file is only written):

    **Live:** local wrangler — Farm seed, membership, kanban (no moves), room chat on DO tape (reconnect last_seq)
    **Now:** write the **Activity plan** (D1-then-DO events, interleaved seq). Do not implement Activity until that plan exists.
    **Next after the plan:** implement only what the Activity plan names.
    **Landed plans:** `docs/superpowers/plans/2026-08-26-projthread-catalog.md`, `docs/superpowers/plans/2026-08-26-projthread-room.md`
    **Index:** `docs/superpowers/plans/2026-08-26-projthread-v1.md`
    **Spec:** `docs/superpowers/specs/2026-08-26-projthread-v1-design.md`

---

### Task 1: Maps

**Files:**
- Create: `docs/superpowers/plans/2026-08-26-projthread-room.md` (this file)
- Modify: `docs/STATUS.md`
- Modify: `AGENTS.md`
- Modify: `docs/superpowers/plans/2026-08-26-projthread-v1.md`

- [ ] **Step 1: Point STATUS at this plan**

Set Live to the current catalog line (Farm seed, membership, kanban, no moves, no room).
Set Now to: execute the **room plan** (chat DO + WS). Do not start Activity.
Set Plan to: `docs/superpowers/plans/2026-08-26-projthread-room.md`
Keep Landed plan pointing at the catalog plan (done). Keep Index and Spec paths unchanged.

- [ ] **Step 2: AGENTS.md**

Set **Now:** room plan (see STATUS). Do not claim the room is live.

- [ ] **Step 3: Plan index**

Room row file: `2026-08-26-projthread-room.md`. **Now:** execute plan 3 (room) only. Leave Activity as *(write after 3)*.

- [ ] **Step 4: Commit**

Stage AGENTS.md, docs/STATUS.md, and docs/superpowers/plans/. Commit message:

    docs: room plan (DO chat tape, WS upgrade, item query)

---

### Task 2: Durable Object binding

**Files:**
- Modify: `wrangler.jsonc`
- Modify: `src/worker/env.ts`

`wrangler.jsonc` today has **no** DO binding. Add it. Do not add Vectorize, R2, KV, or Queues.

- [ ] **Step 1: Bind Room**

Add durable_objects.bindings: name `Room`, class_name `Room`.
Add wrangler migrations (DO class migrations, not the D1 `migrations/` folder):

    tag: v1
    new_sqlite_classes: ["Room"]

Keep existing `d1_databases`, `assets`, `vars`.

- [ ] **Step 2: Env types** (hand-written, same style as `DB` / `ASSETS`; do not add extra Cloudflare type packages)

    export type RoomStub = { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> };
    export type RoomNamespace = { getByName(name: string): RoomStub };

Add `Room: RoomNamespace` to `Env`.

- [ ] **Step 3: Commit**

    chore: bind sqlite Room Durable Object

Existing worker tests that cast a partial object `as Env` should still type-check. Do not break them.

---

### Task 3: Tape (pure)

**Files:**
- Create: `src/room/tape.ts`
- Create: `src/room/tape.test.ts`
- Modify: `package.json` so the test script also runs `src/room/*.test.ts`

This is the persistence contract. The DO class is a thin wrapper around it. No HTTP, no WebSocket.

Export `CHAT_BODY_MAX_BYTES = 8192`, kinds `"chat" | "activity"`, and types:

TapeMessage fields: seq, kind, body, actor_id (string or null), event_id (string or null), created_at.

Tape methods: ensureSchema(); appendChat({ body, actor_id, created_at }) -> TapeMessage; replay(lastSeq) -> TapeMessage[]; lastSeq() -> number.

`utf8Bytes(text)` uses TextEncoder. `rejectChatBody(body)` returns `"empty"` or `"too_large"` or null (trim empty; utf8 length greater than 8192 is too_large).

`memoryTape(): Tape` — seq starts at 1. replay(lastSeq) returns messages with seq greater than lastSeq, order seq ASC. appendChat throws Error("empty") or Error("too_large") on reject. kind is always `"chat"`; event_id is always null.

Export `TAPE_SCHEMA` as the DO SQLite create-table string: table `message`, seq integer primary key autoincrement, kind text not null check chat or activity, body text not null, actor_id text, event_id text, created_at text not null.

This slice does not require a sqlTape helper if it adds complexity. memoryTape is required. Room may run the same SQL directly; keep column names identical.

- [ ] **Step 1: Failing tests** in `src/room/tape.test.ts` using node:test and node:assert/strict.

rejectChatBody: empty and whitespace => empty; 8192 ascii a => null; 8193 ascii a => too_large; e-acute repeated 4097 times (8194 bytes) => too_large.

memoryTape: two appends get seq 1 then 2, lastSeq 2, kind chat, event_id null. After bodies a,b,c: replay(0) is all three, replay(1) is b and c, replay(3) is empty. Rejected empty body throws and lastSeq stays 0.

- [ ] **Step 2: Run the tape test file with the repo test runner — expect FAIL**

- [ ] **Step 3: Implement memoryTape and helpers**

- [ ] **Step 4: Tape tests PASS. Full package test script PASS. Update package.json test glob to include src/room/*.test.ts alongside existing lib, worker, and app/stores globs.**

- [ ] **Step 5: Commit** with message: `feat: room tape append and replay from last_seq`

---

### Task 4: GET work-item snapshot

**Files:**
- Modify: `src/worker/catalog-http.ts`
- Modify: `src/worker/catalog-http.test.ts`

Room chrome is D1. There is no GET today — only PATCH on `/api/work-items/:id`.

In handleCatalog, when matchWorkItemId matches:

- GET: load item; 404 if missing; membership on item.workspace_id (403 if none); 200 JSON is the WorkItemRow.
- PATCH unchanged.
- Other methods: 404.

Auth order stays: cookie 401 before membership.

- [ ] **Step 1: Tests** (same memory session/catalog plus minted cookie as the existing catalog-http test file). Cover 200 with id/title/stage_key, 401 without cookie, 403 other workspace, 404 unknown id.

- [ ] **Step 2: catalog-http tests — expect FAIL**

- [ ] **Step 3: Implement GET**

- [ ] **Step 4: Full package tests — expect PASS**

- [ ] **Step 5: Commit** with message: `feat: GET work-item snapshot by id`

---

### Task 5: Room Durable Object

**Files:**
- Create: `src/room/room.ts`
- Modify: `src/worker/index.ts` (export the class from the Worker entry; Wrangler requires this)

Hibernation is mandatory: `this.ctx.acceptWebSocket(server)`. Never `server.accept()`.

Hand-write a small DurableObjectState type: acceptWebSocket, getWebSockets, storage.sql.exec returning `{ toArray() }`.

Class `Room` constructor(ctx, env): keep ctx/env, build a Tape (sql adapter or, if sql is awkward, isolate SQL in helpers with the same column names as TAPE_SCHEMA), call ensureSchema().

`fetch(request)`:
1. Upgrade header must be websocket, else 400 bad_request.
2. Read `X-Pt-Principal`. Missing: 401 unauthorized (or close 4001 only if already accepted — prefer 401 before 101).
3. last_seq query: default 0; must be digits or 400.
4. Construct WebSocketPair. serializeAttachment({ principalId }) on the server socket. acceptWebSocket(server).
5. Send each replay(lastSeq) row as a message frame (JSON text). Then send caught_up with last_seq = tape.lastSeq().
6. Return status 101 with the client socket.

`webSocketMessage(ws, data)`:
1. principalId from deserializeAttachment. Missing: close 4001.
2. Parse JSON. If not `{ type: "chat", body: string }`: error frame, return.
3. rejectChatBody: error frame, return (do not append).
4. appendChat with actor_id = principalId, created_at ISO now.
5. JSON.stringify the message frame; send to every socket from getWebSockets() including sender.

`webSocketClose`: close the socket. Do not implement appendSystem.

Message frame shape: type message, seq, kind, body, actor_id, event_id, created_at.

SQL adapter (required unless Room only runs under wrangler): ensureSchema runs TAPE_SCHEMA; appendChat inserts and reads seq (RETURNING seq or last_insert_rowid); replay selects seq greater than lastSeq ordered by seq; lastSeq is COALESCE(MAX(seq), 0). Do not unit-test Room in node if WebSocketPair is missing; Task 9 wrangler smoke is the DO runtime test.

In index.ts keep `export default { fetch }` and add `export { Room } from "../room/room.ts"`.

- [ ] **Step 1: Write room.ts plus the export**

- [ ] **Step 2: Commit** with message: `feat: hibernatable Room Durable Object`

No new node test required in this task if tape tests already cover append/replay.

---

### Task 6: Worker upgrade

**Files:**
- Create: `src/worker/room-http.ts`
- Create: `src/worker/room-http.test.ts`
- Modify: `src/worker/index.ts`

`handleRoom(request, env, sessions, catalog)`:

1. Path `/api/rooms/:id` (id has no slash). Else the caller should not invoke this handler.
2. Parse cookie. Missing/invalid session: 401 `{ error: "unauthorized" }`.
3. catalog.getWorkItem(id). Missing: 404 `{ error: "not_found" }`.
4. catalog.getMembership(item.workspace_id, principal.id). Missing: 403 `{ error: "forbidden" }`.
5. If Upgrade is not websocket: 400 `{ error: "bad_request" }`.
6. Validate last_seq query (absent means 0; must be digits) else 400.
7. Forward to `env.Room.getByName(item.id).fetch(...)` with X-Pt-Principal set to principal.id. Return that response.

Dispatch in index.ts before the generic `/api/` 404, not via handleCatalog. Do not send `/api/rooms` to the catalog matcher.

- [ ] **Step 1: Tests** — reuse memory session + catalog + cookie mint from catalog-http.test.ts / me.test.ts. Fake a Room namespace: getByName records the name; fetch records X-Pt-Principal and returns a 101 Response body "upgraded" (no real WebSocket needed in node).

Cases (names array must stay empty when auth fails — never wake a DO):

- no cookie + Upgrade => 401
- valid cookie, unknown item => 404
- valid cookie, item in other workspace => 403
- valid member, no Upgrade header => 400
- valid member, last_seq=nope => 400
- valid member + Upgrade => 101, names[0] === item.id, header equals principal id

- [ ] **Step 2: room-http tests — expect FAIL**

- [ ] **Step 3: Implement plus dispatch**

- [ ] **Step 4: Full package tests — expect PASS**

- [ ] **Step 5: Commit** with message: `feat: cookie-gated WebSocket upgrade to Room DO`

---

### Task 7: Pinia room store

**Files:**
- Create: `src/app/stores/room.ts`
- Create: `src/app/stores/room.test.ts`

Types: RoomStatus = idle | loading | ready | error | no_session. ChatLine = seq, body, actor_id, created_at.

Behavior:

- `open(itemId)` is single-flight (if loading, return). GET `/api/work-items/:id` with credentials include. 401 => no_session. Other failure => error. On 200 set item, then connect().
- `connect()` builds ws: or wss: from globalThis.location.protocol and location.host (no hostname literals): `{proto}//{host}/api/rooms/{itemId}?last_seq={lastSeq}`. lastSeq is the max seq already in lines, or 0.
- onmessage: parse JSON. type message and kind chat => append if seq not already present, update lastSeq. type caught_up => status ready. type error => keep socket, do not crash.
- `send(body)`: if socket OPEN, send JSON `{ type: "chat", body }`. Do not send on each keystroke. Trim; skip empty.
- onclose: if code === 4001 => no_session, do not reconnect. Else if still the same itemId and not idle, one reconnect (keep lines). Guard with reconnectScheduled so a close storm does not loop in tests; allow one automatic retry then wait for the next open().
- `close()`: mark idle, close socket, do not reconnect.
- Do not clear lines on reconnect. Do clear lines when open() is called for a different id.

**Tests** (fake globalThis.WebSocket plus fetch plus stub location):

- open GETs the work-item snapshot URL with credentials
- second open while in-flight does not double-fetch
- 401 => status no_session
- fake WS receives a message then caught_up => line appears, status ready
- send("hi") sends `{ type: "chat", body: "hi" }`
- after a chat seq 2, close code 1006 => new WebSocket URL contains last_seq=2
- close 4001 => no second WebSocket

Stub location as protocol http: and host 127.0.0.1:8787. Fake WebSocket: remember url, send payloads, expose emitMessage and emitClose(code).

- [ ] **Step 1: Failing tests**

- [ ] **Step 2: room store tests — expect FAIL**

- [ ] **Step 3: Implement**

- [ ] **Step 4: Full package tests — expect PASS**

- [ ] **Step 5: Commit** with message: `feat: pinia room store with last_seq reconnect`

---

### Task 8: Open a card into a room view

**Files:**
- Create: `src/app/RoomView.vue`
- Modify: `src/app/KanbanBoard.vue`
- Modify: `src/app/App.vue`

**KanbanBoard:** cards are links, not inert. Keep tokens, no hex, no Prime. Use router-link class card with query `{ ...route.query, item: item.id }` and the item title as text. Style .card as now (display block; color inherit; text-decoration none). Composer unchanged. No drag, no stage.

**App.vue:** read item query. Lazy-load the room (spec: lazy room screen) with defineAsyncComponent importing ./RoomView.vue. Render RoomView when itemQuery is set, else KanbanBoard when hasBoardQuery. Keep workspace/project fill-in. Keep No session / No workspace. Header still shows display_name.

**RoomView.vue:**

- onMounted / watch item query => room.open(id)
- onUnmounted => room.close()
- Chrome: item.title, muted stage_key. No owner control, no stage PATCH.
- Back: router.replace with the same query minus item.
- Tape: list lines in seq order (var(--fg)). Empty tape is empty, not a skeleton.
- Status: loading / reconnecting => muted Connecting. error => danger Could not open room. no_session => No session.
- Composer: input + submit => room.send. Clear draft on send. Disabled when not ready.

No Markdown, no Activity filter, no attachments.

- [ ] **Step 1: Vue plus click**

- [ ] **Step 2: Full package tests — expect PASS**

- [ ] **Step 3: Production app build — expect PASS**

- [ ] **Step 4: Commit** with message: `feat: open kanban card into room view`

---

### Task 9: Smoke + STATUS

**Files:**
- Modify: `docs/STATUS.md`
- Modify: `AGENTS.md` (Now => Activity plan not written)
- Modify: `docs/superpowers/plans/2026-08-26-projthread-v1.md` (**Now:** write plan 4 Activity)

- [ ] **Step 1: Local smoke**

Build assets, apply local D1 migrations (do not apply remote), run seed:local, start wrangler dev.

Hand checks:

1. Mint Farm principal 01FARM00000000000000000002 via /admin (existing flow).
2. Open / => kanban. Create a card if needed.
3. Click the card => URL has item=. Title chrome matches the card. Back returns to the board without waking DOs to render the list.
4. Submit a chat line => it appears. Refresh / reconnect => same lines replay (not lost).
5. GET /api/rooms/<id> without cookie must be 401 (no 101).
6. GET /api/work-items/<id> without cookie => 401; with cookie => 200 snapshot.
7. A session without membership cannot upgrade (403).
8. Stop wrangler. Confirm wrangler.jsonc still has no R2 / Vectorize / KV.

If wrangler complains the Room class is missing from the entry, the Worker entry forgot `export { Room }` — fix and re-smoke.

- [ ] **Step 2: STATUS** — use the **STATUS.md after this slice** block above.

- [ ] **Step 3: Commit** with message: `docs: room slice live on wrangler dev`

Stop. Do not write or execute the Activity plan in this session.
