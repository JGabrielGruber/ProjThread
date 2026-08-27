# ProjThread Chrome Implementation Plan

> For Grok Build: one session, compact. Scout only if a file is not where this plan says. Do not add tests this plan did not ask for. Do not dispatch reviewer or superpowers:subagent-driven-development sub-agents. Stop when STATUS is updated.

**Goal:** Stop looking like unstyled admin forms. Same tokens, a real shell, board/wiki/config that use --surface and fill the viewport, wiki edit on a surface, overlay status so loading does not jiggle the page. Jose dogfood 27 Aug: sort of crude (kanban, wiki list, wiki read, wiki edit, config, rename modal); in-flow Loading lines shove layout.

**Architecture:** Client-only. No Worker, D1, DO, HTTP, or query-param routing changes. item still wins, then wiki, then config, then board. Reuse Modal.vue. Tiny Toast.vue for overlay status. No new npm deps.

**Tech Stack:** Vue 3 + existing tokens. No Tailwind, Daisy, Nord, PrimeVue, no drag library.

This slice is smaller than Skin: no SW, no icons, no theme plumbing.

## Locked calls (do not re-litigate)

- **Kit:** Tokens + our Vue only. No new CSS framework.
- **Drag:** No HTML5 drag. Move stays: pick a stage, then existing reason Modal.
- **Card move UI:** Remove the select from the card face. Card is title (link to room). A compact Move control opens the existing reason modal with a stage select inside the modal. Same moveCard + reason required.
- **Nav:** Header is an app shell. Active control uses aria-current=page + class is-active (accent border + --surface). Inactive uses --muted text, --border. Theme cycle stays a control, not a page. Farm is the display name, not a nav target.
- **Shell:** min-height 100dvh. Header sticky. Main fills remaining width. Stop padding the whole app like a document (1.5rem everywhere).
- **Board:** Columns stretch (min-height fill). Column + card background --surface, border --border. Composer Add stays backlog-only, already a Modal.
- **Wiki list:** Rows, not a form dump. Create is a button that opens Modal (title, type, content). Do not keep the create fields always visible under the list.
- **Wiki read:** Keep --measure + line-height. Wrap the article on --surface. Link field stays on the **read** view only.
- **Wiki edit:** In-place on the node view, **not** a Modal (source is long). `--surface` panel: title + type on one row, textarea fills remaining height, Save / Read as actions. Same field tokens as the create Modal. Do not rebuild markdown, no split preview, no WYSIWYG.
- **Status toast:** Overlay, not in-flow. Tiny `Toast.vue` (Teleport to body, `position: fixed` bottom, `--surface` / `--border` / `--shadow`). `role="status"` `aria-live="polite"`. One instance in `App.vue`. Visible store only: `loading` / `error` / `no_session`. Hide on `ready` / `idle`. No success flashes. Errors stay until the next action. Copy: Wiki/Config/Board **Loading** / **Could not load …** / **No session**; Room **Connecting** / **Could not open room** / **No session**. Strip in-flow `<p>` status from Wiki, Config, Room, Kanban. z-index below Modal (toast 10, modal 20).
- **Config:** max-width 40rem. Members / projects / stages are --surface sections. Keep list+dialog. Do not add directory/remove/reparent.
- **Modal:** Darken backdrop (color-mix closer to 75% --bg). Panel already --surface + --shadow.
- **Room:** Inherit shell only. Do not restyle the tape this slice. Connecting/error leave the tape; they go to the toast.
- **Worker:** Untouched.
- **Tests:** Existing node --test PASS. No Vue tests.

## File map

Dest: docs/superpowers/plans/2026-08-27-projthread-chrome.md (product plan, fine on public git).

- docs/superpowers/plans/2026-08-27-projthread-chrome.md — this plan
- src/app/App.vue — shell, active nav, one Toast from the visible store
- src/app/Toast.vue — overlay status (new, same size class as Modal)
- src/app/KanbanBoard.vue — columns/cards surface; Move in modal not on card; drop in-flow error
- src/app/WikiView.vue — list vs create-modal; read surface; edit surface; drop in-flow status
- src/app/ConfigView.vue — surface sections, max-width; drop in-flow status
- src/app/RoomView.vue — drop in-flow Connecting/error; do not restyle tape
- src/app/Modal.vue — stronger backdrop
- docs/STATUS.md, AGENTS.md, v1 index — after smoke

Do not edit src/worker, src/room, sw.js. Do not add token names (use existing).

## Out of this slice

- HTML5 / pointer drag between columns: easy to gold-plate; Move+modal is enough.
- Room tape chrome / Grok-sidebar layout: spec destination; not this pass.
- Wiki split preview / WYSIWYG: named absence. Edit is a surface form, not a Modal.
- Toast queue / success snacks / history: one live status line is enough.
- Promote, owner picker: other deferred.
- Custom domain: parked.
- MCP / specialist team: waiting.
- Prime / Tailwind / Daisy / Nord: locked out.

## STATUS.md after this slice

**Live:** keep current live sentence + chrome shell, board cards without on-card stage select, wiki create in Modal, wiki edit on surface, overlay status toast, config sections on surface.
**Now:** no open slice. Deploy still parked. Do not start a slice STATUS does not name.
**Landed plans:** existing + chrome (this file).

## Task 1: Maps

1. Plan file at docs/superpowers/plans/2026-08-27-projthread-chrome.md
2. STATUS Now: execute the Chrome plan. Do not start Deploy. Live unchanged.
3. AGENTS Now: Chrome plan. PrimeVue stays out.
4. Index: add row after Skin: Chrome (shell, board cards, wiki create modal, config sections). Now: execute chrome only.
5. Commit: docs: chrome plan (shell, board cards, wiki create/edit, status toast)

## Task 2: Shell + toast + Modal backdrop

Files: src/app/App.vue, src/app/Toast.vue, src/app/Modal.vue, src/app/RoomView.vue, src/app/KanbanBoard.vue, src/app/WikiView.vue, src/app/ConfigView.vue

1. App main is a column shell, min-height 100dvh, not a padded article.
2. Header: principal name, Kanban, Wiki, Config, theme. is-active + aria-current=page from itemQuery/wikiQuery/configQuery/hasBoardQuery (Kanban active when board or room).
3. Toast.vue: Teleport body, fixed bottom center, --surface, hide when message is empty. App.vue computes message from the visible store (item → room, wiki → wiki, config → config, else board). Map loading (room: Connecting; else Loading), error (existing copy), no_session (No session).
4. Remove in-flow status `<p>` from Room, Wiki, Config, Kanban. Leave tape/lists in place while loading.
5. Modal backdrop stronger. npm test PASS. npm run build:app PASS.

## Task 3: Board cards

Files: src/app/KanbanBoard.vue

1. Drop per-card select. Card = title link + Move button.
2. Move button sets pending item; modal includes stage select (not current stage as the only option) + reason input. Reason still required. Reuse confirmMove / moveCard.
3. Column + card --surface. Board fills width. npm test PASS. npm run build:app PASS.

## Task 4: Wiki + Config

Files: src/app/WikiView.vue, src/app/ConfigView.vue

1. Wiki list: title + type. Create opens Modal with the existing composer fields. List view has no always-on textarea.
2. Wiki read: article on --surface, still --measure. Link form stays on read.
3. Wiki edit: --surface panel; title + type one row; textarea grows; Save / Read. Not a Modal.
4. Config: max-width, three --surface sections. Dialogs already Modal; leave behavior.
5. npm test PASS. npm run build PASS.

## Task 5: Smoke + STATUS

1. wrangler dev / workers.dev: nav active matches the view. Kanban cards have no stage dropdown. Move still requires a reason. Wiki list is not a form; create is a modal; edit is a surface form on the node (not a modal). Config sections read as blocks. Modal visibly dims. Loading/Connecting/error sit in a bottom toast and do not insert a line that shoves the page.
2. STATUS / AGENTS / index as specified. Commit: feat: app shell, board cards, wiki create/edit, status toast
3. Do not start Deploy or MCP.

