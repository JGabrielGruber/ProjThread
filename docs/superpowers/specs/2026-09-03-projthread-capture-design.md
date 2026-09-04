# ProjThread — field capture and wiki ingest

**Date:** 2026-09-03  
**Status:** drafted (José + Grok). Not an implementation slice.  
**Amends:** `docs/superpowers/specs/2026-08-26-projthread-v1-design.md` (wiki payloads, named absences for Queues / JSON nodes / capture).  
**v1 remains:** live room, shallow card, markdown wiki, catalog MCP. This spec adds **how the world enters the wiki** and what must exist first.

## Goal

A human walking someone else’s product (a friend’s app, Palm, anything not ProjThread) can drop a **report** into the workspace wiki. Agents wake, classify, and only then file a **card**. Cards stay the focus surface. The dump is a wiki graph.

First consumer: José, asynchronously. First agent wake: Grok Bot webhook **outside** MCP, then pull `/mcp`.

## Product

The stream is still the product. Capture is **ingest**, not a second tracker and not Marker.io.

| Layer | Job |
| --- | --- |
| **Card** | Precious focus. One work item, one room. Capture does **not** land here. |
| **Activity** | Working memory on a card, after something graduates. |
| **Wiki node** | The dump. Reports, attachments, metadata, later files. Agents index. |
| **Capture clients** | Desktop: browser extension (foreign origin). Mobile: installed PWA as an OS **share target** (text, URL, later media). Both are proper app clients, not dump forms. |

José makes noise (reports). Agents index, `ref`, and attach to a card when noise becomes work (`node_work_item`). No required wiki folder tree.

## Report graph

A report is vertices + edges already in v1. Do not add columns on `node` for “report fields.”

| Node | `payload_kind` | Role |
| --- | --- | --- |
| Root | `markdown` | The sentence the human meant. `summary` is agent-facing. |
| Metadata | `json` | Structured facts about the capture (URL, viewport, selection pointers, flags). Own node. |
| Extract | `json` | DOM/network snippets, later. Size-capped. Not a file store. |
| Screenshot / file | `blob` | After R2. Caption may live in `content` as markdown. |

Edges:

- **`includes`** — ordered parts *of this report*.
- **`ref`** — classification and kinship (existing process page, theme, another report). Cycles allowed.
- **`node_project`** — point the report at a project at capture time (helps agents). Table exists; **write HTTP shipped** (`POST /api/nodes/:id/projects`, GET `project_ids`, MCP `attach_node_project`; PWA filter-only).
- **`node_work_item`** — only when it graduates to a card.

Capture-time classification is light: semantic `type` (`note` / `research` is enough), a summary line, a **project** (select or create), optional `ref`s the human already knows. Agents do indexing. Do not invent a report ontology.

## Payloads (`type` ≠ `payload_kind`)

Amend v1: `payload_kind` is `markdown` \| `json` \| `blob`.

| Kind | `content` | When |
| --- | --- | --- |
| `markdown` | CommonMark + GFM subset (v1). SoR. | Prose, including the report root. |
| `json` | Canonical JSON text. Object or array only. Parse on write; persist `JSON.stringify` of the parsed value. No HTML strip (that would corrupt JSON). Same byte cap as markdown content (32 KiB) so it cannot replace R2. | Metadata and structured extracts. |
| `blob` | Optional markdown caption. Bytes in R2 (`blob_key`, `mime_type`, `byte_size`, `filename`). | Files. Unbound until the R2 slice. |

`summary` stays the agent-facing / card-facing field for every kind.

**Do not** store JSON as fenced markdown. That is a schema lie and a long-term footgun.

`payload_kind` is immutable after insert (PATCH of `payload_kind` stays **400**). POST `blob` stays **400** until R2. Omit `payload_kind` → `markdown` (today’s clients).

Wiki search stays title/summary substring. Do not search JSON bodies.

MCP: `wiki_create` / `wiki_write` grow `payload_kind`. `wiki_read` keeps raw body in `content[0]` (JSON text when json). Search hits still omit bodies.

PWA: JSON **reader** is first-class (pretty, phone-calm, not a form schema). Edit is source textarea, same as markdown. Invalid JSON on save is **400**.

## Notify

MCP cannot push. Polling `wiki_search` burns D1 and the 100k request budget on empty ticks. Cron on Workers Free is still **10 ms CPU**. `waitUntil(fetch(webhook))` on `wiki_create` keeps the catalog isolate alive (up to 30s after 201), couples the write to Grok, and has no retry backbone.

**Producer is cheap. Consumer is expensive.** (Palm Engine blog v5.) Catalog HTTP: D1 write + maybe `queue.send` + 201. No outbound HTTP on that request.

**Subscription** (workspace-scoped, owner-configured) is the unit:

- URL + Standard Webhooks signing secret  
- `kinds[]` — “call webhook **X** on **Y**, maybe **Y** and **Z**”  
- `enabled`

**n = 1.** No producer coalesce, no `T_send` window. Coalesce is an **inbox** feature (Palm batches because the operator reads one inbox row). Without a per-principal inbox, `n=5` is a delayed bag of ids; the Bot still has to invent “what became new,” and the webhook body is untrusted *data*, not a mailbox.

Cost we accept: one report graph is several wakes. The Bot routine is: treat JSON as data, `wiki_read` this `node_id`, classify.

Closed kind enum (first notify slice):

| Kind | Fires |
| --- | --- |
| `node.created` | `wiki_create` |
| `node.updated` | `wiki_write` |
| `node.included` | `compose_node` |
| `node.cited` | `cite_node` |

Card/Activity kinds stay unnamed.

Queue: one binding. Workers Free since 2026-02-04: **10k operations/day**, 24h retention. A message is typically write+read+delete (~3 ops). If no subscription matches the kind, **zero** sends. Consumer: load subscribers for that kind, sign Standard Webhooks, POST a small doorbell `{ kind, node_id, workspace_id }` (not the node body). Retries on 5xx. Grok Bot webhook is **outside** MCP; 202 means the automation was accepted. Wrangler `max_batch_size` / `max_batch_timeout` stay in deploy (save invocations, not queue ops).

v1 named “Queues not assumed.” Binding them is this notify slice, not a silent add.

## Inbox per principal (later)

Named, not in the first notify slice.

Materialized deltas keyed by `principal_id` (Palm `admin_notifications` shape). Then `N` / `T_send` coalesce belong **there**. Webhook becomes a true doorbell (“your inbox moved”). MCP grows `inbox_list` / ack. A capture graph can be one knock.

Do not port VAPID or a human admin inbox unless we want that surface. Do not stuff a junk inbox into the webhook payload.

## Capture clients

Two surfaces, one graph. Neither is a leftover form. Same session, workspace, project picker, tokenized Grok/X-sharp skin, same report write (markdown root, json metadata, `includes` / `ref`, `node_project`).

### Extension (desktop / foreign origin)

The page being captured is **not** ProjThread. Bookmarklets and an in-page portal on the host only work when we own that origin. The extension is the client that can see DOM, selection, and (later) a screenshot on someone else’s site.

Must:

- Sign in / paste session once; persist.  
- **Select or create a project** (existing `POST /api/workspaces/:ws/projects`) before or while filing. Pointing a project is the highest-leverage human classification.  
- File the report graph.  
- Screenshot + scribble when R2 exists; until then, text + json is a valid report.  
- Optional on-device distill (client CPU). Worker stores nodes. No Workers AI.

### PWA share target (mobile)

The installed PWA is an OS share target so a phone can hand ProjThread **text**, a **URL**, and later **media** without sitting in the kanban. This is the mobile ingest path, not a cousin of the extension.

Lock:

- Web Share Target on the existing manifest (`share_target`). Level 1: `title`, `text`, `url` (GET onto an app-shell route is enough — no extra Worker). Level 2: image/files via POST multipart **after** R2.  
- Share lands on a **first-class PWA route** (same chrome: project select/create, edit the sentence, file the graph). Not a raw query string the human cannot fix.  
- Session is the PWA cookie/Bearer already on the device. If there is no session, the share landing says so; it does not invent a principal.  
- Service Worker may intercept **only** the share POST to park files (Cache/IDB) and redirect to the GET landing. It still must **not** intercept `/api/*` or WebSocket.  
- Text+URL reports are valid without R2 (json metadata holds the shared URL/text). Images are `payload_kind=blob` and wait on slice 22.  
- Same quality bar as the extension. Share-sheet friction kills mobile ingest.

Do not start either client until json payloads exist, `node_project` can be written, and notify is specified (ideally live, or the dump has no wake). Text share may ship before R2; media share may not.

## Ordered slices

Do not implement this spec in one run. Each row is its own plan in `docs/STATUS.md`.

| # | Slice | Ships | Bindings |
| --- | --- | --- | --- |
| **19** | `payload_kind=json` | Migration CHECK `markdown\|json\|blob`; POST/PATCH json; PWA JSON reader + source edit; MCP `payload_kind`. Blob still 400. | none |
| **20** | `node_project` write | `POST /api/nodes/:id/projects` `{ project_id }` (idempotent like work-item attach); GET node includes `project_ids`; MCP wrap; PWA may stay read-filter only. | none |
| **21** | Notify | D1 subscriptions; Queue producer on the four kinds; consumer doorbell; Config (not admin dump) to add X on Y,Z. n=1. Plan: `docs/superpowers/plans/2026-09-04-projthread-notify.md`. | `NOTIFY` queue |
| **22a** | R2 + blob HTTP | Multipart upload; `GET`/`PUT` bytes; MCP caption + mime, not pixels. Plan: `docs/superpowers/plans/2026-09-04-projthread-blob-http.md`. **Landed** (local bind). | R2 |
| **22b** | Blob PWA | Wiki create file + preview-by-mime. Plan: `docs/superpowers/plans/2026-09-04-projthread-blob-pwa.md`. **Landed.** | none new |
| **23** | Capture extension | Proper client. Project select/create. Report graph. Screenshot without scribble. Plan: `docs/superpowers/plans/2026-09-04-projthread-capture-extension.md`. **Landed.** | none new |
| **24** | PWA share target | Manifest `share_target`; text/url landing route; files after 22. Same graph and project picker. SW still skips `/api/*` and WS. | none new |

**19** is the first implementation plan: `docs/superpowers/plans/2026-09-03-projthread-payload-json.md`. **20:** `docs/superpowers/plans/2026-09-03-projthread-node-project.md`. **21:** `docs/superpowers/plans/2026-09-04-projthread-notify.md`. **22a:** `docs/superpowers/plans/2026-09-04-projthread-blob-http.md`. **22b:** `docs/superpowers/plans/2026-09-04-projthread-blob-pwa.md`. **23:** `docs/superpowers/plans/2026-09-04-projthread-capture-extension.md`.

Capture without 19 is a workaround. Capture without 20 cannot point a project without fake-attaching a card. Capture without 21 is a dump nobody wakes for. Capture without 22 can still ship **text+json** (extension and share-target text). Media/screenshots need 22.

## Free tier (do not drift)

| Resource | How this spec stays inside |
| --- | --- |
| Worker CPU 10 ms / HTTP | Catalog path: D1 + optional `queue.send`. Sign + `fetch(webhook)` only on the **queue consumer**. |
| Worker 100k req/day | No poll. Static PWA. Extension uses `/api/*` like the PWA. |
| Queue 10k ops/day | n=1, only if a subscription matches. Do not notify every keystroke; wiki writes are already discrete. |
| D1 | JSON in `content`, 32 KiB cap. Not HAR archives. |
| R2 | Bound `BLOBS` / `projthread-blobs` (local). One object per blob node. Remote bucket create is ops. |
| Workers AI / Vectorize / KV | Unbound. Distill on the client if at all. |

## Still out

OAuth, room MCP, mint principals, PWA people picker, Deploy/custom domain, Vectorize, KV, Channels, child rooms, Chores, PrimeVue, wiki WYSIWYG, markdown-as-JSON, notify on the create HTTP path, cron/wiki poll, in-page portal on foreign origins, Workers AI, trusting webhook bodies as instructions.

## Success

A human on a friend’s site (extension) or from the phone share sheet (PWA) files a report in a few seconds, pointed at a project, without opening the board. A Grok Bot wakes, reads the graph, and either `ref`s existing wiki or files a card. The board does not fill with dumps.
