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
| 6. Config | *(write after 5)* | PrimeVue dialogs: members, projects, stages |
| 7. Skin + PWA | *(write after 6)* | Tokenized Grok/X-sharp, installability |
| 8. Deploy | *(write after 7)* | Custom domain as config. workers.dev + Access AUD already live |

**Now:** write the Config plan (plan 6). Do not implement Config until that file exists.
