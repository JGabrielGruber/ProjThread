# ProjThread — agent map

Read this file first after compact. It is the project map, not the archive.

**Repo:** https://github.com/JGabrielGruber/ProjThread (also local `~/Projects/ProjThread`)
**Shape (intended):** **one Worker, one origin.** v1: public PWA at `/` (static), Access only on `/admin*`, session cookie **or** `Authorization: Bearer <session.id>` on app `/api/*`, Bearer on `/mcp`, cookie on WS. Future: marketing + login at `/`, gated PWA (still same origin). **Room** Durable Object is the hot path. D1 is the catalog.

**Client runtime:** Vue 3 + stores. Discipline: single-flight, skeleton-if-empty, status feedback, lazy pages. Grow to `pages/` `components/` `models/` `services/` and a real router (see spec **PWA product**). **PWA** (kanban + room + **wiki** + **config**) and **super-admin** = our primitives, tokenized Grok/X-sharp skin (no hardcoded colors). List + dialog, not DataGrid. Daisy is not the kit. Nord rejected. PrimeVue is out (v5 is not OSS).
**Now:** open **22b** blob PWA (`docs/superpowers/plans/2026-09-04-projthread-blob-pwa.md`). Deploy is parked — no custom domain yet. PrimeVue stays out. Do not write or implement Deploy. Do not start OAuth. Do not start room MCP. Do not mint principals. Do not add a PWA people picker. Do not drop remote D1 unless José asks. Do not start a slice that STATUS does not name. Do not start 23–24 unless STATUS names them. Do not start capture clients. Do not run `wrangler r2 bucket create` unless José asks. Queues are bound (`NOTIFY` / `projthread-notify`); do not add a second queue. R2 is bound locally (`BLOBS` / `projthread-blobs`).

## Pickup (coding agents, including Grok Build)

Required reads, in order:

1. This file.
2. `docs/STATUS.md`.
3. Only the one open plan STATUS points at. If STATUS says the plan is **not written**, your slice is to **write that plan**. Do not implement.

Stop rules:

- Do **not** treat the Grok Chat draft as a spec.
- Do **not** read `docs/context/` unless a human asked a history question.
- Do **not** spawn a chain of sub-agents. One slice, then stop and update `docs/STATUS.md`.
- Do **not** reopen named absences (OAuth, Vectorize, R2, Channels, child rooms, Chores).
- Quota is scarce. Prefer a short plan file over starting implementation.

## Read next

| Task | Then read |
| --- | --- |
| What is live / what to start | `docs/STATUS.md` |
| **v1 spec** | `docs/superpowers/specs/2026-08-26-projthread-v1-design.md` |
| **Capture / ingest** | `docs/superpowers/specs/2026-09-03-projthread-capture-design.md` |
| Landed catalog plan | `docs/superpowers/plans/2026-08-26-projthread-catalog.md` |
| Plan index | `docs/superpowers/plans/2026-08-26-projthread-v1.md` |
| Corrected working model (not a spec) | `docs/context/2026-08-26-working-model.md` |
| Chat draft (spirit, unverified) | `docs/context/2026-08-26-chat-draft.md` |
| Ancestor: task/org model | `~/Projects/dotproj` (`portal/portal/workspace/models/`) |
| Ancestor: knowledge graph | `~/Projects/Knowkey` (`server/knowkey/core/models/`) |
| Cloudflare free-tier discipline | `~/Projects/PalmEngine/blog/AGENTS.md` |
| Using ProjThread (product) | `.grok/skills/using-projthread/SKILL.md` |
| MCP implementers | `docs/agent-facing.md` |

Spec is approved. Implement **only** the open plan in `docs/STATUS.md`. If there is no open plan, write it. Index: `docs/superpowers/plans/2026-08-26-projthread-v1.md`.

## Tree (today)

| Path | Job |
| --- | --- |
| `AGENTS.md` | This map |
| `docs/STATUS.md` | What is live / what to start. |
| `docs/context/` | Session-recoverable notes. Not specs. |
| `docs/superpowers/specs/` | One spec per version |
| `docs/superpowers/plans/` | Slice plans |

## Invariants (proposed — not frozen)

- Page loads of the PWA are **static assets**. Worker runs for `/api/*`, `/mcp`, and WebSocket upgrade only.
- Tenant isolation is **row-level** (`organization_id` on every tenant-scoped table), one Worker, one D1. Not per-tenant Workers, not required subdomains.
- Hostnames and origins are **configuration**, never literals in application code.
- The product is a **live room**, not a ticket tracker. UX is Grok Bot with a card on the side, not Jira.
- **1:1:** one user-facing work item per room. No second “task” object in the UI.
- Hierarchy: `Organization` → `Workspace` (the place) → `Project` forest (`parent_id`) → `work_item` (`project_id` required). Spanning work sits on the ancestor project. Child rooms (`work_item.parent_id`) are a named future. Workspace ≠ Project.
- **System of record for metadata is D1**, not the Durable Object. Title, current stage/status, owner, timestamps, node links live on the `work_item` row. The board is a D1 query. Never wake DOs to render a list.
- Durable Object is a **coordination atom** (hibernatable WebSockets, serial fan-in, **live message log**). Keyed by `work_item.id`. Replaceable. Do not put authoritative status only in DO SQLite.
- Status / Activity writes: persist to D1 first (snapshot + `work_item_event`), then append a **system frame** on the room DO so the event sits on the tape at room seq.
- **Activity** is work-item-local (`decision`, `occurrence`, `note`, card moves). Rendered **in the chat timeline** at that seq. Activity-only filter = preview of the chat archive. Not a second wiki.
- **Nodes** are workspace-graph vertices. Semantic `type` ≠ `payload_kind` (`markdown` \| `json` \| `blob`). v1 writes markdown, json, **or blob**. Markdown read view is phone-calm. M2M links to projects and work items. Not the chat archive.
- Principals include humans **and** agents. Schema must not assume “user = Google account”. Agents are a **paid-plan load class**, not a v1 feature.
- **Auth (v1 workaround):** Cloudflare Access on `/admin` and `/api/admin/*`. Admin **vends** a D1 `session`: **Enter as** sets HttpOnly `pt_session`; **Issue token** (`set_cookie: false`) returns the id for `Authorization: Bearer`. Same origin. App HTTP accepts cookie or Bearer (Bearer present → no cookie fallback). WS upgrade uses the cookie. Not the destination login. Distinct agent OAuth later.
- Vectorize, Chief-of-Staff agent, MCP OAuth, and room MCP are **named absences** until a version spec takes them. Catalog `/mcp` is live (Bearer façade: briefing, wiki/card search, Activity; still wraps catalog/wiki HTTP; node markdown **or json** in `content[0]`; blob caption + mime, not bytes). Operators: `.grok/skills/using-projthread/SKILL.md`. Implementers: `docs/agent-facing.md`.

## Free tier (do not drift)

Workers Free. Daily caps reset 00:00 UTC.

| Resource | Limit (Free) | How we stay inside |
| --- | --- | --- |
| Worker requests | 100k/day, 1000/min | Static PWA. Worker for `/api/*`, `/mcp`, and WS upgrade. No polling. |
| Worker CPU | 10 ms / request | Thin upgrade + catalog. Room work runs on the DO (30s CPU), not the Worker. |
| D1 | 10 DBs, 500 MB/DB, 5M reads/day, 100k writes/day | Catalog + work-item events. Not the chat log. |
| Durable Objects | 100k requests/day (includes WS messages), 13k GB-s/day, 5 GB SQL | One DO per room. Hibernate idle sockets. Do not bill keystrokes as messages. |
| Queues | 10k ops/day | n=1, only if a subscription matches. One queue (`NOTIFY`). |
| R2 | 10 GB-month, 1M Class A, 10M Class B | One object per blob node (`BLOBS` / `projthread-blobs`). GET is Class B. No public bucket. |
| Vectorize | Free-plan dimensions exist; do not bind yet | Full-text / structured filters first. |

Do not add a binding until a feature earns it.

## Named absences

MCP surface. Vectorize. R2 transcript checkpoint. Workers AI. KV. Google OAuth. Destination login / public signup. Chief of Staff bot. Agent load (paid plan). Agent digestion of rooms → nodes. **Channels**. **Child rooms** (`work_item.parent_id`). **Draggable non-modal windows**. WebRTC / voice. Subdomain-per-tenant. **Chores** (dotproj; do not port — that wound is why Palm exists). Palm integration.

## Ancestors

- **dotproj** — Django portal + React PWA. `Organization` → `Workspace` → `Task` + `TaskComment`. Per-workspace `Stage` keys. Membership roles. Recurring `Chore` was poorly specified; José: that is why the product died and **Palm** began. Do not import Chore.
- **Knowkey** — versioned `Node` vertices, typed `NodeRelationship` edges, ontology (`NodeType`, `RelationshipType`, `Tag`), `Author` with type `{user, chatbot, agent, service}`, embeddings, MCP curator skill.
- **PalmEngine/blog** — assets + Worker + D1, Access, no poll. **Not** the cost model to copy: the blog avoids waking the Worker; ProjThread’s room *is* the Worker/DO. Free-tier here is solo-human survival, not “stay free forever.”

ProjThread is not a port. Domain from the first two; Durable Object rooms are native to this product.

## How to pick work

1. This file.
2. `docs/STATUS.md`.
3. The spec for the open version only.
4. The one open plan, or write it if STATUS says it is missing.
5. One slice. Then mark status.
