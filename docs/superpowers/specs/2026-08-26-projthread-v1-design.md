# ProjThread v1 — design

**Date:** 2026-08-26  
**Status:** approved 2026-08-26 (not implemented)  
**Working notes:** `docs/context/2026-08-26-working-model.md` (spirit). This file is the spec.

## Goal

A Cloudflare-native workspace where **humans (and later agents) talk in a live room**, keep a **shallow card** for that work, and promote durable understanding into a **workspace wiki**. Densities stay distinct so neither a board nor an agent context eats the whole conversation.

First data (not product scope): farm / egg-production systematization, and José Gabriel Gruber Consultoria — two `organization` rows, one operator.

v1 is a **usable PWA + HTTP API**. MCP, Grok Bots as native agents, Vectorize, and destination login are later adapters over this contract.

## Product

The stream is the product. Slack / Grok Bot, not Jira. Work items are kanban cards (list on mobile); opening a card is the room.

| Layer | Entity | Store | Role |
| --- | --- | --- | --- |
| Stream | Room session + message log | Durable Object | Talk. Hot. |
| Snapshot | `work_item` | D1 | Title, stage, owner. Card chrome and board. |
| Skeleton | **Activity** (`work_item_event`) | D1 SoR; marker on DO tape | Decisions, occurrences, notes, card moves. Interleaved at **room seq**. Activity-only filter = preview of the chat archive. |
| Corpus | **Node** | D1, workspace-scoped | Wiki. Reusable. Not the chat archive. |

**1:1:** one work item, one room, same id. No separate Task table in the UX.

**Promotion:** about this work item and belongs on the tape → Activity. Must be found from other rooms, versioned, or linked in the graph → Node (Activity may `ref_node_id`). Do not grow Activity into a second wiki.

## Hierarchy

```
Organization                 tenant
  └── Workspace              the place (members, stages)
        └── Project          forest (`parent_id` NULL = root)
              └── work_item  required `project_id`
                    ├── Activity
                    └── Room DO (same id)
        └── Node             workspace wiki
              └── links      Node ↔ Project, Node ↔ work_item (M2M)
```

Workspace ≠ Project. Product name ≠ the Project entity. In dotproj, Category was this partition; here it is a container.

- Creating a workspace **mints a root project** and default stages `backlog`, `doing`, `done` (keys; labels may be renamed). No global 7-step pipeline.
- Inter-project work is a work item on the **lowest common ancestor**.
- `project.parent_id` writes are **cycle-checked**.

## Architecture

**One Worker, one origin.** `APP_ORIGIN` is configuration (deploy may be `agrosiste.com`). No hostname literals in application code.

| Request | Who | Gate |
| --- | --- | --- |
| `/` PWA assets | Static | Public in v1 |
| `/admin`, `/admin/*` | Static admin SPA + history shell | Access |
| `/api/admin/*` | Worker | Access JWT (`Cf-Access-Jwt-Assertion`). Local: `ADMIN_DEV_SECRET` like PalmEngine |
| `/api/*` (app) | Worker | Session cookie → D1 `session` → `principal` + membership |
| WS `/api/rooms/:id` | Worker upgrade → Room DO | Same cookie |

`assets.run_worker_first`: `/api/*`, `/admin` (HTML shell). Page loads of the PWA are not Worker requests.

**Bindings (v1):** `DB` (one D1), `Room` (SQLite-backed Durable Object). Unbound: Vectorize, R2, Queue, KV, Workers AI.

**Same origin.** Admin is not another hostname in v1.

**Future (not v1):** `/` marketing + login; PWA gated at `/app`; still one Worker.

## Client

**Vue 3 + Pinia** (or equivalent tiny stores). José’s **discipline** from `dotproj/pwa/src/pages/home/index.jsx`, translated:

- Store is client SoR. Single-flight (`if (loading) return`).
- Skeleton only when the list is empty; refetch does not blank the board.
- Async work has `showStatus` / `showError` (slugs). Never silent failure.
- ETag / skip apply if unchanged.
- URL holds selection (`item`, project, `q`).
- Lazy routes: room, wiki, config.
- Debounce search. No poll. No WS frame per keystroke.

| Surface | Kit |
| --- | --- |
| Kanban, room, wiki | **Our Vue.** Tokenized Grok/X/SpaceX-sharp (dark-first, high contrast, dense). Wiki **read** is long-form (phone-calm Markdown), not kanban density. **No hex in components** — semantic CSS variables (`--bg`, `--fg`, `--muted`, `--accent`, `--danger`, `--radius`, `--font`). Light is a second token set. |
| PWA config (projects, members, stages) | **Our Vue + tokens.** **List + dialog**, not DataGrid. PrimeVue is out (v5 is not OSS). |
| Super-admin `/admin` | **Our Vue + tokens.** Access. Session mint, orgs, principals. |

No PrimeVue on any surface. Config and admin use the same tokenized controls as the product screens.

First load may be fat. After boot, smooth on a phone and on 180 Hz.

## Auth

**v1 is session vending** — a workaround / test harness (José, and a Bot driving the PWA in a browser). Not the destination login. No Google OAuth. No public signup.

1. Operator passes Access, opens `/admin`.
2. `POST /api/admin/sessions { principal_id }` → D1 `session` (id, principal_id, expires_at, minted_by) → `Set-Cookie` HttpOnly, Secure, SameSite=Lax, path `/`. v1: operator may mint for any `principal` row they can see in admin (created there). No self-serve.
3. PWA and WS use that cookie. Revoke/list in admin.

Cookie name: `pt_session` (opaque session id, not a signed blob). Expiry: 30 days. Destination login later **inserts the same row**.

Agents’ native path later: Bearer on `principal.type = agent`. Schema has `principal.type` ∈ {`human`, `agent`, `service`} from day one.

## Data flow

**Catalog.** Cookie → membership → D1. Board never RPCs a Durable Object.

**Open room.** `GET` snapshot + Activity bodies from D1. WS upgrade. DO replays `seq > last_seq`. Tape = chat lines + `{ kind: "activity", event_id }` **in seq order** (not wall clock). Chrome = snapshot.

**Speak.** WS `chat` → DO SQLite append → `seq` → fan-out. No D1 write. Chat `body` max 8 KiB. Activity `body` max 2 KiB. Typing indicators, if any, are coalesced — not one WS frame per keystroke.

**Activity.** `POST /api/work-items/:id/events` → **D1 first** (event; and snapshot if stage/owner) → RPC `Room.appendSystem({ event_id })` → seq + broadcast. Reject empty `body` on `stage_changed` and `decision`.

**Wiki.** `POST/PATCH /api/nodes` on D1. M2M `node_project`, `node_work_item`. Promote: create node + link + optional Activity `note` with `ref_node_id`. Manual in v1. See **Wiki reader** below.

**Workspace create.** Insert workspace + default stages + **root project**.

## Wiki reader and payloads

A Node is a **vertex in the workspace graph**, not “a markdown file.” Two independent axes:

| Axis | Column | Job |
| --- | --- | --- |
| Semantic | `type` | Why it is in the corpus: `note` \| `decision` \| `process` \| `research` (v1 built-in) |
| Payload | `payload_kind` | What the body is: `markdown` \| `blob` |

A decision can be a Markdown page **or** a signed PDF. Same links to projects and work items. `summary` is always the agent-facing / card-facing field (Knowkey), including for blobs.

**v1 writes `markdown` only.** `blob` is schema-ready: nullable `blob_key`, `mime_type`, `byte_size`, `filename`. **R2 stays unbound** until a slice that uploads. Do not stuff files into `content` as base64.

When `payload_kind = markdown`:

- `content` is Markdown, system of record. Do not persist rendered HTML.
- Flavor: **CommonMark + a GFM subset** — headings, paragraphs, emphasis, lists, links, block quotes, fenced code, tables. No raw HTML in the source (strip on save and on render).
- **Read view is first-class.** Measure ~65ch, generous line-height, tokenized type. Our Vue, not Prime. Phone-calm (this spec is the quality bar).
- **Edit view** may be source-only. Split preview is allowed; WYSIWYG is not v1.
- Render **on the client**; sanitize after parse.
- Images **inside** Markdown: default off (no R2). External `https` images stay off until a slice says on.

When `payload_kind = blob` (later): reader is preview-by-mime or download; `content` may hold a Markdown caption. Not v1.

Chat messages stay plain text in v1. Markdown (and files) are **wiki** concerns, not the tape.

## Activity types (v1)

| `type` | Fields | `body` |
| --- | --- | --- |
| `stage_changed` | `from`, `to` | required |
| `owner_changed` | `from`, `to` | optional |
| `decision` | | required |
| `occurrence` | | required |
| `note` | | required |

Optional `ref_node_id`. Append-only.

## Schema (D1)

Text ids (ULID). Timestamps ISO-8601. Tenant-scoped tables carry `organization_id`. Membership is checked on every app request; never trust client-supplied org/workspace/project without it.

```sql
-- principals, sessions, membership
principal(id, type, display_name, created_at)
session(id, principal_id, minted_by, expires_at, revoked_at, created_at)
organization(id, name, created_at)
workspace(id, organization_id, name, created_at)
membership(workspace_id, principal_id, role)  -- owner | member
stage(workspace_id, key, label, position)

project(
  id, workspace_id, organization_id,
  parent_id,  -- NULL = root; same workspace
  name, created_at
)

work_item(
  id, project_id, workspace_id, organization_id,
  title, stage_key, owner_id,
  created_at, updated_at
)

work_item_event(
  id, work_item_id, organization_id,
  type, from_value, to_value, body,
  actor_id, ref_node_id, created_at
)

node(
  id, workspace_id, organization_id,
  type,           -- semantic: note | decision | process | research
  payload_kind,   -- markdown | blob  (v1 insert: markdown only)
  title, summary,
  content,        -- Markdown when payload_kind = markdown; optional caption when blob
  blob_key, mime_type, byte_size, filename,  -- NULL in v1; R2 later
  created_at, updated_at
)
node_project(node_id, project_id)
node_work_item(node_id, work_item_id)
```

Indexes: work_item by `(workspace_id, project_id, stage_key)`; events by `(work_item_id, created_at)`; nodes by `workspace_id`.

**Room DO SQLite** (not D1): `message(seq INTEGER PK, kind, body, actor_id, event_id, created_at)`. `kind` ∈ {`chat`, `activity`}. Hibernatable WebSockets. `getByName(work_item.id)`.

## Errors and reconnect

| Case | Behavior |
| --- | --- |
| No / expired / revoked session | 401 on HTTP; WS close 4001. PWA shows “no session” (not marketing). |
| Principal not in workspace | 403 |
| Cycle on `project.parent_id` | 400 |
| Empty required Activity `body` | 400 |
| D1 Activity commit, DO `appendSystem` fails | Event remains SoR. Worker retries once. Tape may miss the marker until retry; Activity-only view still lists it from D1. **Do not roll back D1.** |
| WS drop | Client reconnects with `last_seq`; DO dumps `seq > last_seq`. No poll. |
| Catalog in-flight | Single-flight; previous list stays on screen. |

Worker catalog handlers stay inside **10 ms CPU** (Free). Room work is the DO (30 s CPU). No embeddings, no LLM on the request path.

## Testing

- Worker HTTP: `node:test` (PalmEngine pattern) — Access vs cookie vs 401/403, session mint/revoke, membership, project cycle, Activity D1-first.
- Pinia: single-flight, skeleton-if-empty, ETag skip.
- Room DO: append chat, append activity marker, resume from `last_seq` (wrangler/vitest durable object test or a thin fake).
- No browser E2E required for v1 slices; smoke the PWA by hand on `wrangler dev`.

## Tree

| Path | Job |
| --- | --- |
| `src/worker` | Routing, Access, session, D1 catalog, WS upgrade |
| `src/room` | Durable Object class |
| `src/app` | PWA (kanban, room, wiki, config) |
| `src/admin` | Super-admin SPA |
| `src/lib` | Shared types, token names, API contracts |
| `migrations/` | D1 SQL |
| `docs/STATUS.md` | Slice table after this spec |

## Slices (implementation order, not this spec’s job to execute)

0. Repo tree, wrangler, D1, empty Worker + asset shells  
1. Super-admin: Access, principals, session mint/revoke  
2. Catalog schema: org, workspace, project forest, stages, work_item CRUD, kanban  
3. Room DO + WS tape (chat only)  
4. Activity D1-then-DO, interleaved render, Activity-only filter  
5. Wiki: nodes + links + promote from room + Markdown read/edit (`payload_kind=markdown`). Blob columns exist; no upload.  
6. PWA config (list + dialog): members, projects, stages  
7. Tokens (Grok/X-sharp), PWA installability  
8. Deploy: `APP_ORIGIN`, Access, D1, custom domain as config  

## Named absences

MCP. Destination login / public signup. Google OAuth. Bearer agents. Agent digest of rooms → nodes. Chief of Staff. Vectorize. R2 (files **and** transcript checkpoint). Queues. KV. Channels. Child rooms. Draggable non-modal windows. WebRTC / voice. Subdomain-per-tenant. **Chores** (do not port from dotproj; that wound is why Palm exists). Palm integration. **PrimeVue** (v5 is not OSS; do not re-add). PrimeVue DataGrid Pro. Ontology editor. Graph canvas. Nord. DaisyUI as product chrome. Wiki WYSIWYG. Wiki **blob upload** / R2 / in-Markdown images. Markdown on the chat tape. Node versioning (Knowkey).

## Load classes

| Class | Plan | Who |
| --- | --- | --- |
| Solo human | Workers Free | José, hibernated WS |
| Agents | Workers Paid | Same protocol, many writers |

One protocol. Do not build a second product for Paid.
