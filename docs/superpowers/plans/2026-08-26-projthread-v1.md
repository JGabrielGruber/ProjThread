# ProjThread v1 — plan index

> **For agentic workers:** Do **not** implement the whole v1 in one run. Execute the **open plan** named in `docs/STATUS.md`. Spec: `docs/superpowers/specs/2026-08-26-projthread-v1-design.md`.

v1 is one product, several **independent plans**. Each plan ships working, testable software. Do not start plan N+1 until N is marked done in `docs/STATUS.md`.

| Plan | File | Ships |
| --- | --- | --- |
| **1. Foundation** | `2026-08-26-projthread-foundation.md` | One Worker, assets, D1, Access, session vending, `/api/me`, empty PWA “no session” |
| 2. Catalog | `2026-08-26-projthread-catalog.md` | Org, workspace, project forest, stages, work_item CRUD, kanban |
| 3. Room | `2026-08-26-projthread-room.md` | Durable Object + hibernatable WS, chat tape, resume `last_seq` |
| 4. Activity | `2026-08-26-projthread-activity.md` | D1-then-DO events, interleaved seq, Activity-only filter |
| 5. Wiki | `2026-08-26-projthread-wiki.md` | Nodes, Markdown reader, work-item links; promote is not in this landing |
| 6. Config | `2026-08-26-projthread-config.md` | PWA dialogs — members list/add, create/rename projects, stage labels/order; our Vue + tokens (PrimeVue dropped: v5 is not OSS); owner picker not in this landing |
| 7. Skin + PWA | `2026-08-27-projthread-skin.md` | Tokens (dark+light), tiny Modal, PWA manifest+SW |
| 7b. Chrome | `2026-08-27-projthread-chrome.md` | App shell, board cards (Move in modal), wiki create modal + edit surface, overlay status toast, config sections |
| 8. Deploy | *(parked — no custom domain yet)* | Custom domain as config. workers.dev + Access AUD already live |
| **9. Node rel** | `2026-08-28-projthread-node-rel.md` | `node_rel` `includes` + `ref` HTTP; attach stays `node_work_item`; no PWA |
| **10. Session Bearer** | `2026-08-28-projthread-session-bearer.md` | App HTTP Bearer = existing `session.id`; admin Issue token (`set_cookie: false`); no MCP |
| **11. Catalog MCP** | `2026-08-28-projthread-catalog-mcp.md` | Same-origin `/mcp`; Bearer session; wrap catalog/wiki HTTP; no room, no OAuth |
| **12. Catalog MCP harden** | `2026-08-28-projthread-catalog-mcp-harden.md` | Node tools: raw markdown in `content[0]`; `compose_node` + `cite_node`; no room, no OAuth |
| **13. MCP façade** | `2026-08-31-projthread-mcp-facade.md` | Intent tools: briefing, search/read, Activity, implicit workspace; no room, no OAuth |
| **14. Briefing pins** | `2026-08-31-projthread-briefing-pins.md` | Wiki pins on `session_briefing`; process lives on those nodes; no Config MCP |
| **15. PWA structure** | `2026-08-31-projthread-pwa-structure.md` | Real routes, `pages/` `components/` `models/` `services/`; extract primitives; no new CRUD |
| **16. Operator CRUD** | `2026-09-01-projthread-operator-crud.md` | Mutations the PWA still lacks; workspace on session; project tree filter chrome; reverse attach on the room; HTTP where missing |
| **17. Empty tenant** | `2026-09-02-projthread-empty-tenant.md` | First-workspace PWA; retire Farm seed. Remote D1 drop is ops |
| **18. Config MCP** | `2026-09-02-projthread-config-mcp.md` | Bot members/projects/stages/`workspace_create`; wrap catalog HTTP; no principal mint |

**Now:** no open slice. Capture spec approved (`2026-09-03-projthread-capture-design.md`). Park plan 8. Do not start OAuth. Do not start room MCP. Do not mint principals. Do not add a PWA people picker. Do not drop remote D1 unless José asks. Do not start slices 22–24. Do not bind R2. Do not add a second queue.

| Plan | File | Ships |
| --- | --- | --- |
| **19. payload_kind json** | `2026-09-03-projthread-payload-json.md` | JSON wiki nodes (HTTP, PWA reader, MCP). Blob still 400. **Landed** (local; remote after `0008`). |
| **20. `node_project` write** | `2026-09-03-projthread-node-project.md` | POST attach project; GET `project_ids`; MCP wrap. **Landed.** |
| **21. Notify** | `2026-09-04-projthread-notify.md` | Queue doorbell; subscription X on kinds Y,Z; n=1; Config. **Landed** (local; remote after `0009` + `wrangler queues create` + deploy). |
| 22. R2 + blob | *(not written)* | Upload; screenshot files |
| 23. Capture extension | *(not written)* | Proper client; project select/create; report graph |
| 24. PWA share target | *(not written)* | OS share: text/url; media after R2 |

**Later (named, no plan file yet):**

| Work | When |
| --- | --- |
| Operator CRUD (16) | Landed |
| Empty tenant (17) | Landed (local + workers.dev). Farm seed file gone. Remote Farm rows wait on José |
| Config MCP (18) | Landed (local + workers.dev, version `ce62acca-1f40-4198-b67f-b72f95ffcac7`) |
| Deploy briefing pins + remote `0006` | Done (`0006`+`0007` on remote; version `2be119b6-9da2-43f5-b07a-692acfc5fb9d`) |
| Reset Grok Bot memory | Ops, anytime |
