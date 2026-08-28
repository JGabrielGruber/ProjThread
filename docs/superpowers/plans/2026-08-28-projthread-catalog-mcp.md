# ProjThread Catalog MCP Implementation Plan

> For Grok Build: one session, one slice. Compact after each task. Scout only if a file is not where this plan says. Do not add tests the plan did not ask for. Stop when STATUS is updated. Do not dispatch reviewer or superpowers:subagent-driven-development sub-agents.

**Goal:** Grok Bot (and any Bearer client) can read/write cards and wiki nodes through a same-origin `/mcp` Streamable HTTP adapter. No room, no OAuth, no new bindings.

**Architecture:** Worker route `/mcp`. Gate with `parseBearerSessionId` only (cookie ignored). Stateless `createMcpHandler` from `agents/mcp/server` (`responseMode: "json"`). Tools construct internal Requests to `handleMe` / `handleCatalog` / `handleWiki` so membership and validation stay in one place.

**Tech Stack:** Existing Worker + D1, `agents` + `@modelcontextprotocol/server@2.0.0` + `zod`, `node --test --experimental-strip-types`. No KV, no OAuth provider, no `McpAgent`, no Room/WS Bearer, no PrimeVue, no PWA edits.

---

## Locked calls (do not re-litigate)

| Topic | Call |
| --- | --- |
| Path | Exact `/mcp`. Add `"/mcp"` to `assets.run_worker_first`. |
| Transport | `createMcpHandler`, factory per request. `legacy: "stateless"`. `responseMode: "json"`. |
| Auth | `Authorization: Bearer <session.id>` required on POST. Empty/missing/non-Bearer → 401. Cookie never counted. OPTIONS may skip the gate (CORS). |
| Session | Same D1 row as plan 10. `resolveSession` before the handler. |
| Tools | Wrap existing HTTP. Do not reimplement D1. |
| Room | Out. `move_work_item` may wake Room via existing catalog `appendSystem` (same as PWA move). No chat tools. |
| Access | Unchanged. Do not put Access on `/mcp`. |
| OAuth / KV / McpAgent | Named absences. |

### Tool set

| Tool | Wraps |
| --- | --- |
| `me` | `GET /api/me` |
| `list_projects` | `GET /api/workspaces/:id/projects` |
| `list_stages` | `GET /api/workspaces/:id/stages` |
| `list_work_items` | `GET /api/workspaces/:id/work-items?project_id=` |
| `get_work_item` | `GET /api/work-items/:id` |
| `create_work_item` | `POST /api/workspaces/:id/work-items` `{ title, project_id }` |
| `update_work_item_title` | `PATCH /api/work-items/:id` `{ title }` |
| `move_work_item` | `POST /api/work-items/:id/events` `{ type: "stage_changed", from, to, body }` |
| `list_nodes` | `GET /api/workspaces/:id/nodes` |
| `get_node` | `GET /api/nodes/:id` |
| `create_node` | `POST /api/workspaces/:id/nodes` |
| `update_node` | `PATCH /api/nodes/:id` |
| `attach_node_work_item` | `POST /api/nodes/:id/work-items` `{ work_item_id }` |

HTTP 4xx/5xx from the wrap → MCP tool `isError: true` with `{ status, error }` JSON text. Do not throw past the handler.

---

## File map

- `docs/superpowers/plans/2026-08-28-projthread-catalog-mcp.md` — this plan
- `src/worker/mcp.ts` — Bearer gate + `createMcpHandler` factory
- `src/worker/mcp.test.ts` — 401s, initialize, tools/list, `me`, `create_node`
- `src/worker/index.ts` — route `/mcp`, pass `ExecutionContext`
- `wrangler.jsonc` — `run_worker_first` includes `/mcp`
- `package.json` — `agents`, `@modelcontextprotocol/server@2.0.0`, `zod`
- docs after landing — STATUS, AGENTS, spec, v1 index

Do not modify `src/worker/room-http.ts`, `src/room/*`, `src/app/*`, `src/admin/*`, migrations.

---

## Out of this slice (explicit)

| Deferred | Why |
| --- | --- |
| OAuth / distinct agent tokens | Clients that cannot send Bearer. |
| Room / WS tools | Cookie-only tape. |
| Members, project create, stage replace, node `includes`/`ref` | Config / graph; not “nodes and cards”. |
| `McpAgent`, KV, Vectorize, R2 | Bindings not earned. |
| Deploy | Parked on custom domain. |

---

## STATUS.md after this slice

**Live:** … + same-origin `/mcp` (stateless Streamable HTTP; Bearer session; catalog/wiki tools).
**Now:** no open slice. Park Deploy until a custom domain exists. Do not start OAuth.
**Next:** when a domain exists, write the Deploy plan. Until then, wait.
**Parked (product):** PWA outline / attachment chrome. Distinct agent OAuth tokens. Room MCP.

---

### Task 1: Maps

Files: this plan, `docs/STATUS.md`, `AGENTS.md`, `docs/superpowers/plans/2026-08-26-projthread-v1.md`, spec.

- [x] STATUS **Now:** execute this plan. Do not implement Deploy. Do not start OAuth.
- [x] AGENTS **Now:** catalog-mcp plan (see STATUS). Drop “Do not start MCP.”
- [x] Index plan **11** row: `2026-08-28-projthread-catalog-mcp.md`.
- [x] Spec **Parked: catalog MCP** — this slice; OAuth stays absence.

---

### Task 2: Failing tests

Files: create `src/worker/mcp.test.ts`. Reuse admin mint + wiki/catalog memory stores from `wiki-http.test.ts` / `catalog-http.test.ts` patterns. Call `handleMcp` (will not exist yet).

- [x] 401 without Authorization; 401 with cookie only; 401 with `Bearer` and no token; 401 with unknown session id.
- [x] Live Bearer `POST /mcp` `server/discover` (MCP 2026-07-28 `_meta` envelope) → 200 JSON-RPC result (not 404). `initialize` is not the modern handshake.
- [x] `tools/list` includes the thirteen names above.
- [x] `tools/call` `me` returns the principal.
- [x] `tools/call` `create_node` on a member workspace returns a node; cookie-only still 401.

Run: `node --test --experimental-strip-types src/worker/mcp.test.ts`  
Expected: fail on missing `./mcp.ts` or missing `handleMcp`.

---

### Task 3: Implement

- [x] `npm i agents @modelcontextprotocol/server@2.0.0 zod`
- [x] `src/worker/mcp.ts` as locked above. Stub `ExecutionContext` if tests have no workers types: `{ waitUntil() {}, passThroughOnException() {} }`.
- [x] `src/worker/index.ts`: `if (url.pathname === "/mcp") return handleMcp(...)`. Add `ctx` to `fetch`.
- [x] `wrangler.jsonc` `run_worker_first`: `"/mcp"`.
- [x] Re-run `mcp.test.ts` then full `npm test`.

---

### Task 4: Docs after green

- [x] STATUS Live/Now/Next/Parked as in this plan. Landed plans include this file.
- [x] AGENTS: Worker also `/mcp`; MCP catalog wrap is live; OAuth still absence. Stop rule: do not start OAuth / Vectorize / R2 / Channels / child rooms / Chores.
- [x] Spec auth table: `/mcp` Bearer. Parked catalog MCP shipped. Named absences drop bare “MCP.” keep OAuth, room MCP.
- [x] Index Now: plan 11 landed. Park plan 8. Do not start OAuth.
