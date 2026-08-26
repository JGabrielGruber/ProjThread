# Working model — 26 Aug 2026

Not a spec. Session-recoverable correction of the Grok Chat draft against ancestor code and Cloudflare limits. Unmarked items are **proposals**. Marked **locked** items are José’s calls this session.

## Problem

Work arrives as conversation (high volume, low reuse). Action needs a shallow card. Current status alone is too thin to know *why*. The live log is too hot to scan. The wiki is too cold for a one-line reason. Durable understanding that must be reused lives in a graph (nodes + typed edges). Mixing those densities into one document blows agent context and human boards.

ProjThread is the system that keeps those layers distinct and linked.

## Information density (the actual product)

**Locked:** the **stream is the product**. Index cards are details. Corpus is what you keep after the stream cools. Slack / Grok Bot, not Jira.

| Layer | Entity | Store | Role |
| --- | --- | --- | --- |
| Stream | Live room session + message log | Durable Object | Primary UX: talk. Hot. Not the catalog. |
| Index snapshot | **work_item** | D1 | Current title, stage, owner. The card chrome. |
| Stream skeleton | **Activity** (`work_item_event`) | D1 SoR; marker on the DO tape | Decisions, occurrences, notes, card moves. **Interleaved in the room at the seq they happened.** Preview of the chat archive. |
| Corpus | **Node** + relationship | D1, workspace-scoped | Wiki / knowledge graph. Link to projects and work items. Reusable. Not the chat archive. |

**Locked:** DO is the live log. Batched checkpoint of that log to R2 is a named future, not v1.

**Locked:** Nodes are the **workspace** corpus (one graph per place). v1 creates them by hand when needed. Link to many projects and work items. Future (Paid): agents digest a room tail into nodes and keep summaries.

**Locked:** Activity lives **on this work item** and is **rendered in the room timeline** at the moment it happened (same tape as chat, distinct kind of row). Filter the room to Activity-only and you have a **preview of the chat archive** — the chapter markers without the talk. Nodes are not that preview; they are the wiki.

Working types (v1): `stage_changed` | `owner_changed` | `decision` | `occurrence` | `note`. Body required for `decision` and stage changes. Optional `ref_node_id`.

**Promotion line:** about this work item and belongs on the tape → Activity. Must be found from other rooms, versioned, or linked in the graph → Node (Activity may point at it). Do not grow Activity into a second wiki.

**Write path:** D1 insert of `work_item_event` first (SoR). Then the room DO appends a **system frame** `{ kind: "activity", event_id }` so the live log has a seq hole. Clients render the event inline. Do not merge two lists by wall clock; **room seq** is the order of “when it happened.” If the DO class is later thrown away, D1 Activity still reconstructs the skeleton; exact interleaving with lost chat waits for the R2 checkpoint.

## Hierarchy

**Locked:** 1:1 in the UX — one work item, one live room. No second ticket object.

**Locked:** two stores, one id.

```
Organization                      tenant
  └── Workspace                   the place (members, stages, settings)
        └── Project               forest: parent_id NULL = root
              └── Project         …
                    └── work_item required project_id
                          ├── Activity
                          ├── Room session (DO)
                          └── links → Node
        └── Node                  workspace-scoped corpus
              └── links           Node ↔ Project, Node ↔ work_item (M2M)
```

**Locked:** Workspace ≠ Project. Category in dotproj was the wrong noun; that partition is Project.

**Locked:** every work item has a `project_id`. No junk drawer on the Workspace.

**Locked:** **project forest** — `project.parent_id` (NULL = root). Workspace mints a root project. Inter-project work is a work item on the lowest common ancestor. Cycle-free (adjacency list, check on write).

**Deferred:** `work_item.parent_id` (child rooms / sub-conversations). Cool; not v1. Distinct from Channels.

Cross-project *links* that are not containment can be a Node relationship, not a parent.

The board is `SELECT` on `work_item` (usually filtered by project). The room is one timeline: chat + Activity, seq order. Card chrome is the D1 snapshot.

### Deferred: Channels

José: keep the idea, do not build it now.

A **Channel** is a long-lived stream that contains many work items (Slack `#egg-production`). That is a *containment* change: one DO (or one DO + child threads) fans in many cards. It is **not** a WebRTC feature.

- Text channels, like rooms, are still server-coordinated. On Cloudflare that stays a Durable Object + WebSocket. The browser is not the server.
- **WebRTC** is a media transport (voice, video, screen). If we ever want that, it is a third named absence (likely Cloudflare Calls / an SFU), sitting *beside* the text DO, not instead of it.

Do not fold WebRTC into “we will do channels.” Channel spec, when it exists, starts from containment and fan-out, not from P2P.

### Deferred: child rooms

José: keep `work_item.parent_id` (a room under a room). Not v1. Not a substitute for the project forest.

### Deferred: R2 transcript checkpoint

José: keep batched checkpoint of the DO live log to R2 for the future. Not v1. Survival of *meaning* is Nodes + work-item events. Survival of the raw chat across a DO-class rewrite waits for this.

Ontology (node types, relationship types, tags) comes from Knowkey. v1 can ship a small built-in vocabulary; it does not need a full ontology editor.

## What the draft got right

- Tenant = Organization. Working unit under it. Task stays shallow. Knowledge is a separate entity.
- Humans and agents are both participants (Knowkey already has `AuthorType`: user, chatbot, agent, service).
- First users: farm / egg-production systematization, and José Gabriel Gruber Consultoria — two organizations, one operator.
- Cloudflare-native: Worker + D1 + static assets, as proven on PalmEngine/blog.
- MCP 2026-07-28 **exists** and is stateless (Streamable HTTP, `createMcpHandler`; `McpAgent` is deprecated). That is the *future* adapter, not v1.
- Access as a high-privilege gate is a real pattern (PalmEngine admin). **Locked for v1:** Access on admin, which **vends** application sessions.

## What the draft got wrong or premature

### 1. MCP is not v1

José: a functional PWA + HTTP API is the first useful system. MCP wraps that API later. Grok Chat / Bots / Cursor joining via MCP is a **client** problem after the resource model is stable.

### 2. Live UX, D1 metadata — **do not treat the Durable Object as SoR**

José: discussion is the focus (so the room is live), but we must not be attached to Durable Objects for anything we cannot afford to lose or must query as a set. DO SQLite *is* persistent across hibernation; that is not the issue. The issue is **queryability, blast radius, and replaceability**:

- A board (`WHERE stage = ?`) cannot fan out to N objects.
- Status must exist before anyone has connected, and after we swap the live transport.
- Nodes and work-item metadata are the durable business record.

**Locked physical split:**

| Concern | Store | Rule |
| --- | --- | --- |
| `work_item` identity, title, current stage, owner, timestamps | D1 | Snapshot SoR. Writes hit D1 **first**. |
| `work_item_event` (name open) | D1 | Append-only reasoned history. Same transaction as the snapshot write when the event is a stage/owner change. |
| Node, relationships, work_item↔node | D1 | Archive/wiki. |
| Principals, membership, workspace | D1 | |
| Connected sockets, presence, serial fan-in, **message transcript** | Durable Object | Live log + coordination. `getByName(work_item.id)`. |
| Transcript checkpoint | R2 | Named future. Not v1. |

Card chrome **reads D1** (snapshot). The timeline **reads the DO tape** (messages + activity markers). Event bodies are SoR in D1; the DO frame is a pointer (`event_id`) so the object is not the SoR. After D1 commit, the DO appends the frame and broadcasts it like any other seq.

**Event shape (proposal):** append-only `work_item_event`: `type`, `from`, `to`, `body`, `actor_id`, `ref_node_id?`, `created_at`.

| `type` | When |
| --- | --- |
| `stage_changed` | Card move; `from`/`to` + `body` as the reason |
| `owner_changed` | Assignment |
| `decision` | A choice that binds this work item (“we will cull at week 18”) |
| `occurrence` | Something happened (“fox at the north fence”) |
| `note` | Insight that is not a decision, occurrence, or move |

**Not this layer:** full chat, wiki pages, embeddings, empty “status changed”, workspace-wide timeline with no work item (deferred).

**v1 Worker:** static PWA, REST catalog on D1, WebSocket upgrade to the room DO. No poll. No DO RPC to paint the board.

**Sleeve:** hibernatable WebSockets; persist-status-then-fan-out; resume cursor for the stream; alarm later for digest-to-node; no frame per keystroke.

Agents later use the same socket protocol. Digesting rooms into nodes is a **Paid** job, not v1.

### 3. Vectorize and R2 are not day-one bindings

Vectorize **is** on Workers Free (intro docs), despite a stale “paid only” line on the pricing page. Still: embedding on the 10 ms Worker CPU path is hostile. Knowkey used pgvector 1536-d; that was a different runtime.

v1 search: D1 `LIKE` / FTS5 if needed, plus exact filters. Vectorize when semantic search over the corpus is an actual slice.

R2: not v1. Named futures: file attachments, and batched **transcript checkpoint** from the DO log. Text attachments stay out until then.

### 4. “Fully multi-tenant from day one” ≠ subdomain SaaS

**Do:** `organization_id` on every tenant-scoped row. Membership. Never trust a client-supplied org without a principal check.

**Do not (v1):** Workers for Platforms, per-tenant D1, wildcard `*.agrosiste.com` as the isolation mechanism.

Subdomains are **routing cosmetics**. Cookie domain, CORS, TLS, and Worker custom-domain routes all get worse. Path `/api/...` + `APP_ORIGIN` config is enough. `agrosiste.com` (or a subdomain of it) is a deploy target, not an identifier in code.

D1 Free: **10 databases**, 500 MB each. One database, many tenants, until a tenant earns a database.

### 5. Seven-stage global pipeline is less true than dotproj

dotproj stages are **per-workspace keys**, not a product-wide enum. A farm chore board and a consultoria delivery board will not share `Discussing → Planned → Ready for Approval`.

v1: `stage` is a workspace-defined label/key (small default set). Do not encode a 7-step state machine in the Worker.

### 6. IAM — **locked: Access vends the app session**

José: Cloudflare Access on **admin**; from there mint a session cookie for a **principal of the operator’s choice**. The PWA, `/api/*` (app), and WebSocket upgrade never require Access. They require the session.

This is the PalmEngine split, with admin as the **session issuer**. José: **workaround / test harness, not the destination login.** It exists so we can put a browser-shaped client (José, and later a Bot driving the PWA) into the app plane without Google OAuth and without Access on every room. Intended human login is a later spec. Do not build a public signup.

| Plane | Gate | Who |
| --- | --- | --- |
| Operator / tenant-admin (`/admin`, `/api/admin/*`) | Access JWT (`Cf-Access-Jwt-Assertion`). Local: `ADMIN_DEV_SECRET` bypass like the blog. | José the operator |
| Application (PWA, catalog API, room WS) | Opaque **HttpOnly** session cookie → D1 `session` row → `principal` | A human principal the operator selected |
| Agents (later) | Bearer token, not a cookie | `principal.type = agent` |

**Mint path:** Access-authenticated `POST /api/admin/sessions` `{ principal_id }` inserts a D1 session (id, principal_id, expires_at, minted_by) and `Set-Cookie`. Same origin as the PWA so the cookie is first-party (`APP_ORIGIN`). Redirect into the app.

**Why a D1 session row, not only HMAC:** you are vending identity for “a user of my choice.” Revoke, list, expiry must exist. Stateless cookies cannot be revoked without rotating the signing secret.

**Same origin.** Do not put admin on another hostname in v1 (cookie domain, CORS, WS). Worker: Access on `/admin*` + `/api/admin*`; cookie on the rest of `/api/*` and the WS upgrade.

This is session vending, not a public login form. Other humans (and browser-shaped Bots under test) get in when the operator mints them a session. They do not need a Cloudflare Access seat. The `session` table remains the right primitive when a real login exists — that flow will insert the same row.

### 7. Chief of Staff is an application, not infrastructure

It is an agent principal that calls the same API. It cannot exist before tasks, messages, and nodes have a stable contract. Do not schedule it in v1.

### 8. Worker CPU is 10 ms on Free

PalmEngine stayed alive by keeping handlers tiny and by not running the Worker on HTML. ProjThread will run the Worker/DO on every live message. Catalog handlers stay thin (10 ms). Room CPU is the DO’s 30s budget. Still: no LLM and no embedding on Free. Compose context **in the client / agent** from Node summaries + a bounded room tail, not a dump of the whole log.

## v1 intent (proposal)

A usable PWA that behaves like a **room list**, not a kanban that happens to have comments:

- Operator opens `/admin` (Access). Mints a session for a principal. Lands in the PWA with a cookie.
- Organizations → workspaces → **projects** → rooms.
- Open a room: live WebSocket timeline (chat + Activity interleaved by seq). Card chrome is the D1 snapshot (title, stage, owner). Activity-only filter = preview of the chat archive.
- Create / edit a **Node** when content does not fit the card; link node ↔ work_item. Thin: title, summary, content, type. No ontology editor, no Vectorize.
- HTTP catalog on D1 + WS room protocol. MCP later wraps both.

Not v1: MCP, CoS bot, Vectorize, R2, chores (do not port), Palm, destination login, agent load, agent digest of rooms.

**Load classes**

| Class | Plan | Who is in the room |
| --- | --- | --- |
| Solo human | Workers Free | José, hibernated WS, catalog REST |
| Agents | Workers Paid | Same protocol, many writers, LLM later |

Do not build a second product for Paid. Build one protocol that Free can idle.

## Stack (v1)

| Piece | Choice | Why |
| --- | --- | --- |
| Runtime | One Worker + assets | PWA HTML/JS not billed as Worker |
| Catalog / SoR | One D1 | Orgs, workspaces, projects, `work_item` status, activity, nodes, principals |
| Live session | Durable Object + hibernatable WS | Coordination only; not metadata SoR |
| UI | PWA (SPA) | Installable client for the room |
| Config | `wrangler.jsonc` vars: `APP_ORIGIN`, no domain literals | Test on `agrosiste.com` without painting it into code |
| Auth | Access (admin) → D1 session cookie (app) | PalmEngine split; operator vends principals |
| Vectorize / R2 / Queue / KV | Unbound | |

UI toolkit: undecided. Recent Cloudflare work on PalmEngine admin is Vue 3 + DaisyUI. dotproj PWA is React. Do not copy Django.

## First tenants (data, not product scope)

1. Farm / egg-production systematization  
2. José Gabriel Gruber Consultoria  

Same codebase. Two `organization` rows.

## Open questions

1. ~~Thread v1 transport~~ **Locked:** live room UX. DO is coordination + live log, not metadata SoR.
2. ~~Task vs Room~~ **Locked:** 1:1 UX. D1 `work_item` is the snapshot. Channels deferred.
3. ~~Nodes~~ **Locked:** thin corpus in v1 (manual). Agent digest later.
4. ~~Transcript~~ **Locked:** DO is the live log. R2 batched checkpoint deferred.
5. ~~Activity~~ **Locked:** work-item-local typed events, interleaved in the room at room seq. Preview of the chat archive. Wiki remains Nodes.
6. ~~Working-unit name~~ **Locked:** Workspace = the place. Project = former Category. Product name ≠ this entity.
7. ~~Unfiled rooms / parent~~ **Locked:** always `project_id`. **Project forest** (`parent_id`). Child rooms deferred.
8. ~~Node scope~~ **Locked:** workspace-scoped graph. M2M links to projects and work items.
9. ~~Human auth~~ **Locked for v1 as a workaround:** Access on `/admin`; admin mints D1-backed session cookies for a chosen `principal` (including browser-shaped Bot tests). App plane is the cookie. Destination login unspecified. Agents’ native path later: Bearer. No Google OAuth in v1.
10. ~~Chores~~ **Named absence.** dotproj’s Chore was poorly specified; José: that gap is why dotproj died and Palm began. Do not port it. Recurring work, if it returns, is a new spec under Palm’s lineage — not a ProjThread v1 entity.

Domain forks from this session are closed.

11. ~~Runtime shape~~ **Locked:** one Worker, one origin (PalmEngine pattern + Room DO). Not two Workers. Not Pages Functions.
12. **PWA vs marketing:** v1 PWA shell is **public** (static `/`, no Access). API and WS stay session-gated. Future: marketing site + login screen; PWA access gated. Still one origin (`/` marketing, `/app` PWA, `/admin` Access) — not a second Worker.
13. **UI runtime (locked in spirit from José / `dotproj/pwa/src/pages/home/index.jsx`):** smoothness is **discipline**, not a lighter library. First load may be fat. After boot, the PWA must stay smooth on any device.

Invariants (from the hand-crafted home page + `task.store`):

- Store is SoR on the client. Select with `useShallow`. `memo` / `useMemo` / `useCallback` on the hot list.
- **Single-flight:** `if (get().isLoading) return` — one in-flight fetch of a given kind.
- Async + **user feedback** (`showStatus` / `showError` slugs). Never a silent spinner-only failure.
- Skeleton only when there is **no cached list**; refetch must not blank the board.
- ETag / skip apply if unchanged.
- URL holds selection (`task`, filters), not only RAM.
- Heavy screens **lazy-loaded** (room, wiki, admin grids). Chrome can be MUI; the tape must not mount a kitchen-sink kit per message.
- Debounce search and other chatty inputs.

**View library:** **Locked: Vue 3 + stores** (Pinia or PalmEngine-style modules). Grok-safer render budget. Daisy is **not** the kit. Do not copy the blog admin’s Daisy as a default.

**Three client surfaces** (do not flatten):

| Surface | Who | Job | Component density |
| --- | --- | --- | --- |
| Super-admin `/admin` | Operator, Access | Orgs, session mint, tenant plumbing | Sparse |
| PWA config | Workspace members, session | Projects forest, members, stages, tables, forms, pickers | **High** (little ERP; PrimeVue OK) |
| PWA board | Same session | Work items as **kanban cards** (list on mobile) | Cards / columns; **ours** |
| PWA room | Same session | Live tape + Activity | Lean tape; **ours** |
| PWA wiki | Same session | Workspace **Nodes**: search, read, edit, link to projects/work items | Document + backlinks; **ours**. Not Prime. Not the chat archive. |

The wiki is a first-class product surface. A Node is a graph vertex: semantic `type` and `payload_kind` (`markdown` \| `blob`) are different axes. v1 writes Markdown only; blob columns reserved (R2 later). **Read view** for markdown is phone-calm long-form. Source edit; no WYSIWYG. No ontology editor, no graph canvas, no Vectorize, no upload. Graph *structure* is in D1; the UI is search + document + “linked from.”

The PWA is the complex product. Super-admin is not “workspace settings.”

**Visual style:** **Locked (spirit).** Product surface follows the **Grok / X / SpaceX** direction — sharp, high contrast, easy to focus, still dense/rich. Brief, not a pixel clone. José confirmed 26 Aug 2026.

**Theming, not hex.** No color literals in components. Semantic CSS variables (`--bg`, `--fg`, `--muted`, `--accent`, `--danger`, `--radius`, `--font`). Dark-first; light is a token set, not a rewrite. Prime’s gospel stays on the ERP island and does not leak tokens into the board/room/wiki.

**Vue kit (locked in spirit):** **PrimeVue on the little-ERP / config surface only.** Gospel (Aura/Lara/Nora) is allowed there. Product surface (kanban + room + **wiki**) is **our Vue**, no Prime classes. No PrimeVue **DataGrid Pro** — v1 config is **list + dialog**, as dotproj did. Community DataTable only if a simple grid earns it.

Extendability is **kit isolation**, not fighting Pass Through on the tape. Prime’s PT/unstyled exists if a config widget must be restyled. Super-admin may use Prime too (SaaS look is fine).

**Deferred:** non-modal **draggable windows** (several work items open on desktop). Not v1. Not a reason to pick a kit.
