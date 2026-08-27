# ProjThread Wiki Implementation Plan

> For Grok Build: one session, one slice. Compact after each task. Scout only if a file is not where this plan says. Do not add tests the plan did not ask for. Stop when STATUS is updated. Do not dispatch reviewer or superpowers:subagent-driven-development sub-agents.

**Goal:** Smallest dogfood-useful workspace wiki: D1 `node` (markdown body), create/list/get/patch in a workspace, phone-calm Markdown **read** (textarea source edit), M2M link to a work item. Nodes are the workspace corpus, not the chat archive. No wiki bodies on the Room DO tape.

**Architecture:** D1 is SoR. New `WikiStore` + `wiki-http` — do **not** add node methods to `CatalogStore`, do not rebuild catalog/room/activity. Worker `POST/GET /api/workspaces/:id/nodes`, `GET/PATCH /api/nodes/:id`, `POST /api/nodes/:id/work-items`. Membership via existing catalog. Client: lazy `WikiView` on query `wiki=1` / `node=`. Render Markdown on the client; persist source only.

**Tech Stack:** Existing Vue 3 + Pinia, Worker + D1, `node --test --experimental-strip-types`. Add **`marked`** (app-only render). No vitest, no `cloudflare:test`, no PrimeVue, no R2, no Vectorize, no MCP, no Channels, no Chores.

This slice is **smaller than Activity**: no DO/tape/RPC, no RoomView/KanbanBoard edits, no CatalogStore stub churn.

---

## Locked calls (do not re-litigate)

| Topic | Call |
| --- | --- |
| SoR | D1 `node` (+ `node_work_item`). Never write wiki `content` to Room SQLite or WS frames. |
| Store | New `WikiStore` in `src/worker/wiki.ts`. **Do not** extend `CatalogStore`. `wiki-http` calls `catalog.getMembership` + `catalog.getWorkItem` only. |
| Bindings | No new wrangler bindings. `wrangler.jsonc` unchanged (DB + Room only). Blob columns exist; R2 stays unbound. |
| payload_kind | Insert **markdown only**. POST/PATCH `blob` → **400**. Blob columns always NULL this slice. |
| Semantic `type` | `note` or `decision` or `process` or `research`. Omit on POST → `note`. |
| Body | `content` is Markdown source. Do not persist rendered HTML. |
| Flavor | CommonMark + GFM subset (headings, paragraphs, emphasis, lists, links, block quotes, fenced code, tables). |
| HTML | Strip raw HTML tags **on save** (outside fenced code blocks). Render drops `html` tokens. |
| Images | Off. Image markdown may stay in source; renderer emits no img tags. No R2, no external image fetch. |
| Links | Render `http:`/`https:` only; other hrefs → text. |
| Limits | Title required, trim, max **200** UTF-8 bytes. Summary optional, max **512**. Content optional, max **32768**. Over → **400**. |
| List vs get | List omits `content` and blob columns. GET returns full `node` + `work_item_ids`. |
| Create + link | POST body may include `work_item_id`. Same-workspace item → insert node + M2M. |
| Link API | `POST /api/nodes/:id/work-items` with `{ work_item_id }`. PK conflict → **200** same payload (idempotent). New → **201**. Item missing / other workspace → **400**. |
| `node_project` | **Table only.** No HTTP, no UI. |
| Promote | **Deferred.** Do not create a node from Activity/chat. Do not write `ref_node_id`. Do not edit `RoomView`. |
| Auth | No cookie **401**; not a member **403**; missing workspace/node **404**. Same cookie as catalog. |
| PATCH | `title` / `summary` / `content` / `type` only. Cannot change `workspace_id`, `payload_kind`, blob columns. |
| Client | Query params (existing PWA). `item` still wins over wiki. `wiki=1` = list; `node=:id` = read/edit. Lazy `WikiView` like `RoomView`. |
| Edit UX | Source **textarea** + rendered **read**. No WYSIWYG, no split preview. |
| Vite | Do not import `src/worker` or `src/room` from `src/app`. Do not import `marked` from `src/worker`. |
| Tests | `node --test --experimental-strip-types`. No Vue test runner. No extra cases beyond this plan. |
| Catalog/room | Do not modify `catalog.ts`, `catalog-http.ts`, `RoomView.vue`, `KanbanBoard.vue`, `src/room/*`, `wrangler.jsonc`. |


## File map

Copy this plan into the repo at docs/superpowers/plans/2026-08-26-projthread-wiki.md in Task 1 if it is not already there.

Do not add node methods to catalog.ts. Do not bind R2. Do not touch Room DO.

File map (path -- job):
- migrations/0004_wiki.sql -- node, node_work_item, unused node_project, idx_node_workspace
- src/lib/wiki-text.ts -- stripRawHtml, utf8Bytes, reject helpers
- src/lib/wiki-text.test.ts -- strip + limits
- src/worker/wiki.ts -- types, WikiStore, d1WikiStore, memoryWikiStore
- src/worker/wiki.test.ts -- memory create/list/get/patch/link
- src/worker/wiki-http.ts -- HTTP routes
- src/worker/wiki-http.test.ts -- 401/403/404/400/201/200
- src/worker/index.ts -- dispatch nodes before catalog
- src/app/markdown.ts -- marked render; drop html/image; http(s) links
- src/app/stores/wiki.ts -- Pinia list/open/create/save/link
- src/app/stores/wiki.test.ts -- fetch URLs + single-flight
- src/app/WikiView.vue -- list, create, 65ch read, textarea edit, link field
- src/app/App.vue -- header Wiki control + lazy WikiView
- package.json -- add marked in Task 5
- docs after landing -- STATUS, AGENTS, v1 index

## Out of this slice (explicit)

| Deferred | Why |
| --- | --- |
| Promote (Activity/chat to node + optional note with ref_node_id) | Spec slice 5 names it; cut to keep this smaller than Activity. ref_node_id stays nullable text, unresolved. |
| node_project HTTP/UI | Table reserved. Work-item link is the dogfood path. |
| GET nodes by work_item / room chrome | Would rebuild RoomView. Open wiki from App header. |
| Split preview, WYSIWYG | Spec allows source-only. |
| Blob upload, R2, in-Markdown images | Named absences. Columns NULL. |
| Node versioning, graph canvas, ontology editor | Named absences (Knowkey later). |
| Markdown on the chat tape | Spec: wiki concern, not the tape. |
| Wiki bodies on Room DO | Locked. |
| Vectorize, MCP, Channels, child rooms, PrimeVue, Chores | Named absences / later plans. |
| Config (members/projects/stages PrimeVue) | Plan 6. |
| Skin + PWA installability | Plan 7. |
| Deploy (APP_ORIGIN, Access, remote D1) | Plan 8. |

## STATUS.md after this slice

When Task 6 lands (not when this file is only written):

**Live:** local wrangler — Farm seed, membership, kanban moves (stage_changed), room chat + Activity markers on DO tape (reconnect last_seq), Activity-only from D1, wiki markdown nodes + work-item links (no promote)
**Now:** write the **Config plan** (PrimeVue dialogs: members, projects, stages). Do not implement Config until that plan exists.
**Next after the plan:** implement only what the Config plan names.
**Landed plans:** docs/superpowers/plans/2026-08-26-projthread-catalog.md, room, activity, wiki (this file)
**Index:** docs/superpowers/plans/2026-08-26-projthread-v1.md
**Spec:** docs/superpowers/specs/2026-08-26-projthread-v1-design.md

---

### Task 1: Maps

Files: this plan at docs/superpowers/plans/2026-08-26-projthread-wiki.md, docs/STATUS.md, AGENTS.md, docs/superpowers/plans/2026-08-26-projthread-v1.md

If docs/STATUS.md Plan: is already this path and Now: is execute the Wiki plan, skip this task.

- [ ] Step 1: Ensure the plan file is at docs/superpowers/plans/2026-08-26-projthread-wiki.md (copy from pickup if needed).
- [ ] Step 2: STATUS Now: execute the Wiki plan. Do not start Config. Plan: this file. Live unchanged (Activity still the live product).
- [ ] Step 3: AGENTS Now: Wiki plan (see STATUS). Do not claim Wiki is live.
- [ ] Step 4: Index Wiki row file 2026-08-26-projthread-wiki.md. Ships: nodes, Markdown reader, work-item links; promote deferred. Now: execute plan 5 only. Leave Config as (write after 5).
- [ ] Step 5: Commit (docs only) message: docs: wiki plan (markdown nodes, work-item links, promote deferred)

### Task 2: D1 node + WikiStore

Files: create migrations/0004_wiki.sql, src/worker/wiki.ts, src/worker/wiki.test.ts. Do not modify catalog.ts or any CatalogStore stub.

Step 1: Migration 0004_wiki.sql. Match spec schema for node, node_work_item, node_project. Indexes: idx_node_workspace on node(workspace_id).

node columns: id PK text; workspace_id and organization_id not null (FK workspace, organization); type check note/decision/process/research; payload_kind check markdown/blob; title not null; summary; content; blob_key; mime_type; byte_size integer; filename; created_at; updated_at.
node_work_item: node_id + work_item_id composite PK, both FK. node_project: node_id + project_id composite PK, both FK. Do not write node_project in code. No FK from work_item_event.ref_node_id. Apply local D1 migrations only at smoke (Task 6).

Step 2: Types + store in wiki.ts. Export NodeType, PayloadKind, NodeRow (all columns), NodeListRow (omit content and blob fields), NodePatch (optional type/title/summary/content plus updated_at), WikiStore.
WikiStore methods: listNodes(workspaceId) -> NodeListRow[] ordered updated_at DESC, id DESC, no content; getNode(id) -> NodeRow or null; insertNode(row); updateNode(id, patch) -> boolean; listNodeWorkItemIds(nodeId) -> string[]; linkNodeWorkItem(nodeId, workItemId) -> inserted or exists (INSERT OR IGNORE then inspect). Export d1WikiStore(db) and memoryWikiStore() for tests only. HTTP create+link is two awaits (insertNode then linkNodeWorkItem), not a third helper. v1 callers pass payload_kind markdown and blob fields null.

Step 3: Failing tests in wiki.test.ts. insertNode markdown note n1 in ws-1 titled Farm notes, content "# Hi".
1. listNodes(ws-1) length 1, title match, no content key. listNodes(other) is empty.
2. getNode(n1) content "# Hi", payload_kind markdown, blob fields null.
3. getNode(missing) is null.
4. updateNode(n1, content "# Ho") then get content "# Ho". updateNode(missing) false.
5. linkNodeWorkItem(n1, wi-1) inserted; list ids [wi-1]. Second call exists; still one id.

- [ ] Step 4: Implement until src/worker/wiki.test.ts PASS. Full test suite still PASS (no CatalogStore changes).
- [ ] Step 5: Commit feat: D1 node table and wiki store

### Task 3: HTTP nodes (D1 only)

Files: create src/lib/wiki-text.ts, src/lib/wiki-text.test.ts, src/worker/wiki-http.ts, src/worker/wiki-http.test.ts. Modify src/worker/index.ts only (dispatch).

Step 1: wiki-text.ts exports NODE_TITLE_MAX_BYTES=200, NODE_SUMMARY_MAX_BYTES=512, NODE_CONTENT_MAX_BYTES=32768, utf8Bytes, stripRawHtml, rejectTitle, rejectSummary, rejectContent.
stripRawHtml: split on fenced code (triple backticks). Inside fences, unchanged. Outside: drop HTML comments, then tags matching a letter-tag pattern; keep inner text. Title empty after trim -> empty. Content/summary null is fine. Over byte cap -> too_large.

Step 2: Failing lib tests.
1. stripRawHtml of Hi plus a script tag around x plus bang -> keeps inner text x, drops tags.
2. fenced block containing a p tag still contains that p tag.
3. Title empty/whitespace -> empty; 200 ascii a ok; 201 -> too_large.
4. Content 32768 ascii a ok; 32769 -> too_large.

Step 3: handleWiki. Copy session gate from catalog-http.ts (parseSessionId, resolveSession). Do not import handleCatalog. wiki-http uses catalog.getMembership and catalog.getWorkItem only.

Routes: GET/POST /api/workspaces/:ws/nodes (list/create). GET/PATCH /api/nodes/:id. POST /api/nodes/:id/work-items (link). Workspace resource must be exactly nodes. Membership: catalog.getMembership. For /api/nodes/:id load node first; 404 if missing, then membership on node.workspace_id.

POST JSON: type optional (default note), title required, summary optional, content optional, work_item_id optional, payload_kind omit or markdown (any other value 400). Apply stripRawHtml to content (and title/summary if they contain tags). Then reject limits. newId() + timestamps. Blob columns null. payload_kind markdown.
If work_item_id present: catalog.getWorkItem must exist and workspace_id match; else 400. Then insertNode + linkNodeWorkItem. Response 201 { node, work_item_ids }.
PATCH JSON: subset of type, title, summary, content. Ignore unknown extra keys. Empty title after trim -> 400. payload_kind in body -> 400. Strip HTML on string fields.
POST link: { work_item_id }. Validate item same workspace. inserted -> 201; exists -> 200. Both return { node, work_item_ids }.

index.ts: wiki = d1WikiStore(env.DB). Before the catalog workspaces/work-items branch, if pathname starts with /api/nodes OR matches /api/workspaces/:id/nodes exactly, return handleWiki(request, env, store, catalog, wiki).

Step 4: HTTP tests. Copy memoryStore / mintCookie / farmBundle / memberContext from catalog-http.test.ts. Slim CatalogStore: real getMembership + getWorkItem + insertTenantBundle + seedWorkItem helper; every other method unused. Pass memoryWikiStore() as the wiki arg. Use handleAdmin + stubCatalog only for minting.

Cases: (1) GET workspace nodes without cookie 401. (2) outsider cookie 403. (3) GET /api/nodes/missing 404. (4) GET list member 200 { nodes: [] }. (5) POST title Egg with content that includes a b tag -> 201, title Egg, content without b tags, inner x kept, payload_kind markdown; list length 1 and list row has no content. (6) GET node has content; work_item_ids empty. (7) POST empty title 400. (8) POST payload_kind blob 400. (9) POST type nope 400. (10) PATCH title+content 200. (11) POST with work_item_id of seeded same-workspace item 201, ids length 1. (12) missing/other-workspace work_item_id 400 and no extra node. (13) POST work-items first 201, second 200, still one id.

- [ ] Step 5: Implement. Test suite PASS.
- [ ] Step 6: Commit feat: wiki HTTP create/list/get/patch and work-item link

### Task 4: Pinia wiki store

Files: create src/app/stores/wiki.ts and src/app/stores/wiki.test.ts. Same discipline as board: if (loading) return; status loading/ready/error/no_session; credentials include.
WikiListNode: id, workspace_id, type, payload_kind, title, summary, created_at, updated_at. WikiNode adds organization_id + content. Store fields: workspaceId, nodes, node, workItemIds, status, error, loading.
Methods: loadList(workspaceId) GET /api/workspaces/:id/nodes; 401 -> no_session. openNode(id) GET /api/nodes/:id sets node + workItemIds. createNode POST workspace nodes; 201 sets node+ids and prepends list row without content. saveNode PATCH current node. linkWorkItem POST /api/nodes/:id/work-items { work_item_id }.

Failing tests (Pinia + fake fetch, same as board.test.ts):
1. loadList(ws1) GETs /api/workspaces/ws1/nodes with credentials include; nodes from payload.
2. Second loadList while in-flight does not double-fetch (calls === 1).
3. 401 -> status no_session.
4. createNode({ title: Egg, content: "# Hi" }) POSTs that JSON to /api/workspaces/ws1/nodes.
5. openNode(n1) GETs /api/nodes/n1; sets content.
6. linkWorkItem(wi-1) POSTs { work_item_id: wi-1 } to /api/nodes/n1/work-items.

- [ ] Step 2: Implement. Test suite PASS.
- [ ] Step 3: Commit feat: wiki Pinia store list/open/create/link

### Task 5: WikiView + App nav + marked

Files: create src/app/markdown.ts, src/app/WikiView.vue. Modify src/app/App.vue. Add marked as a dependency (latest via the package manager; do not invent a version). Do not add DOMPurify. Worker must not import marked.

src/app/markdown.ts: marked with gfm true. Custom renderer: html -> empty string; image -> empty string; link only if href matches http or https, else plain text. parse sync (async false). Export renderMarkdown(src). No unit test file (not in this plan).

WikiView.vue (our Vue, tokens only, no Prime, no hex). Query: node id, workspace id (same queryString helper as App). On workspace: wiki.loadList. On node: wiki.openNode.
List when no node query: titles + type. Click sets query node, keeps workspace/project, drops item. Create form: title, type select (four types), content textarea, optional work_item_id input aria-label Work item id, submit createNode then navigate to new id.
Read/edit when node set: default read. Article.wiki-read max-width 65ch, line-height 1.65, v-html of renderMarkdown(content). Button Edit shows title + type + textarea source + Save (saveNode). Button Read returns to rendered view. Link form: work_item_id + Link (linkWorkItem). Show workItemIds. Back: drop node, keep wiki=1. Status text like RoomView. Disable submit unless ready.

App.vue: defineAsyncComponent WikiView like RoomView. wikiQuery = query wiki===1 or node set. Template: RoomView if itemQuery; else WikiView if wikiQuery; else KanbanBoard if hasBoardQuery. Header Wiki control replaces query with workspace, project, wiki=1 (drop item and node). Do not edit RoomView.vue or KanbanBoard.vue.

- [ ] Step 5: Test suite PASS. App build still works (marked bundled in app, not worker).
- [ ] Step 6: Commit feat: wiki read view and source edit

### Task 6: Smoke + STATUS

Files: docs/STATUS.md, AGENTS.md, docs/superpowers/plans/2026-08-26-projthread-v1.md

- [ ] Step 1: Test suite PASS.
- [ ] Step 2: Apply local D1 migrations (projthread). Re-seed if the DB was reset. Build app+admin, then wrangler dev.

Step 3: HTTP smoke with Farm cookie from /admin, principal 01FARM00000000000000000002, workspace 01FARM00000000000000000003. Create or reuse a card id WI.
Empty title POST nodes -> 400. Create markdown with work_item_id WI -> 201, payload_kind markdown, content without raw tags, work_item_ids includes WI. List returns the node without fat content. GET /api/nodes/NODE returns body. POST payload_kind blob -> 400. Outsider GET list -> 403.
PWA: Wiki from header -> list -> create -> read is long-form (not kanban density) -> Edit textarea saves -> link a work item id. Room chat/Activity unchanged. Board moves unchanged.

- [ ] Step 4: STATUS / AGENTS / index to the after this slice block. Now is write Config plan, not implement Config. Index Wiki ships line must say promote is not in this landing.
- [ ] Step 5: Commit docs: wiki slice live (markdown nodes, work-item links)

Stop. Do not start Config. Do not add promote.

## Spec coverage (self-check)

| Spec | This slice |
| --- | --- |
| Node = workspace corpus, not chat archive | Yes |
| D1 SoR; no wiki on Room tape | Yes |
| type != payload_kind; v1 markdown; blob columns reserved | Yes |
| POST/PATCH nodes | Yes (workspace prefix matches catalog) |
| M2M node_work_item | Yes |
| M2M node_project | Table only |
| Promote + Activity ref_node_id | Deferred |
| Read view phone-calm Markdown; source edit | Yes |
| Client render; strip HTML; images off | Yes |
| Our Vue, no Prime on wiki | Yes |
| Index nodes by workspace | Yes |
| Vectorize / MCP / R2 / Channels / Chores / PrimeVue product | Out |

## Confirmed against main (do not rediscover)

- Migrations on main: 0001_auth.sql, 0002_catalog.sql, 0003_activity.sql. No node table.
- catalog.ts has no node types; work_item_event.ref_node_id is nullable text, no FK.
- wrangler.jsonc: DB + Room only. Do not add bindings.
- PWA routing is query params (workspace, project, item), not vue-router paths. Wiki follows that.
- RoomView.vue / KanbanBoard.vue already ship Activity; leave them.
- package.json has no markdown parser yet; add marked in Task 5 for the app only.
