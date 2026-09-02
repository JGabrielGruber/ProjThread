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
| **18. Config MCP** | *(not written)* | Bot members/projects/stages; after human setup |

**Now:** no open slice. Next named work is write Config MCP (plan 18, not written). Park plan 8. Do not start OAuth. Do not start room MCP. Do not drop remote D1 unless José asks.

**Later (named, no plan file yet):**

| Work | When |
| --- | --- |
| Operator CRUD (16) | Landed |
| Empty tenant (17) | Landed locally. Farm seed file gone. Remote Farm rows wait on José |
| Config MCP (18) | After human empty-tenant |
| Deploy briefing pins + remote `0006` | Ops, when José asks |
| Reset Grok Bot memory | Ops, anytime |
