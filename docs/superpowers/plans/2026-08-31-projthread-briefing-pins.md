# ProjThread briefing pins Implementation Plan

> For Grok Build: one session, one slice. Compact after each task. Scout only if a file is not where this plan says. Do not add tests the plan did not ask for. Stop when STATUS is updated. Do not dispatch reviewer or superpowers:subagent-driven-development sub-agents. Do not start OAuth. Do not start room MCP. Do not start workspace-setup or Config MCP.

**Goal:** `session_briefing` returns wiki **pins** (id + title, no bodies) so a cold bot gets the workspace map. How-we-work lives on those wiki nodes, not in a Grok skill.

**Architecture:** `pinned` on `node`. Human toggles in PWA wiki. Briefing lists pinned hits. MCP `instructions` + `using-projthread` shrink to ontology + “read the pins.” Tool descriptions drop the use/do-not-use essays (one sentence + side effects). Still wrap catalog/wiki HTTP. No new MCP tool.

**Tech Stack:** Existing Worker, D1 migration `0006`, Vue wiki list. `node --test --experimental-strip-types`. No new bindings.

---

## Locked calls (do not re-litigate)

| Topic | Call |
| --- | --- |
| What a pin is | A wiki node marked for cold start. Titles only on the briefing. Bodies via `wiki_read`. |
| Schema | `node.pinned INTEGER NOT NULL DEFAULT 0` (`0` \| `1`). No position column. Briefing order: `updated_at` DESC, then `id` DESC. Cap **10**. |
| HTTP | `PATCH /api/nodes/:id` may include `pinned` (boolean). Same membership as today. Unpin: `pinned: false`. Pin does not require title/content. |
| Not `wiki_write` | MCP `wiki_write` stays title/type/summary/content. Do not add `pinned` there (wrong density). No `wiki_pin` tool. Catalog stays fifteen. |
| Who pins | Human in PWA wiki list (pin/unpin). Bot does not pin in this slice. |
| Briefing shape | Existing payload **plus** `"pins": [{ "id", "title", "type", "summary" }]`. Always an array (empty if none). Never node `content`. Multi-membership listing (no workspace yet) still has no pins. |
| Skill / instructions | Wiki holds process. Skill + MCP `instructions`: what ProjThread is, start with briefing, **read the pins**, then search. Do not name Farm pages (“Lead map”). |
| Descriptions | Each façade tool: first clause (`Tool to …`) + `Side effects: …` from today’s string. Drop when/not-when (pins + instructions carry judgment). |
| Seed / D1 wipe | Out. Operator later, after workspace-setup. |

### Briefing `pins` (workspace known)

```json
"pins": [{ "id": "", "title": "", "type": "process", "summary": null }]
```

### MCP `instructions` (exact)

```
ProjThread is a live workspace, not a ticket tracker. A card is the work (one card, one chat room — chat is not on this server). Wiki is reusable knowledge. Activity on a card is working memory. Start with session_briefing; wiki_read the pins — that is how this workspace works. Then search. One membership: omit workspace_id.
```

### Skill body (replace `.grok/skills/using-projthread/SKILL.md` after the frontmatter)

Keep the frontmatter `name` / `description` (still do not fire when editing this repo). Body:

```markdown
# Using ProjThread

ProjThread is a **live workspace**. People and agents talk in a **room**. Each piece of work is one **card**; opening the card *is* the room. Not Jira.

This MCP server is catalog + wiki. **Chat is not here.**

| Layer | Holds |
| --- | --- |
| **Wiki** | Reusable knowledge. How *this* workspace works lives here, on **pins**. |
| **Card** | The work: title, stage, project. |
| **Activity** | Working memory on that card (`decision`, `occurrence`, `note`). |

1. `session_briefing` (omit `workspace_id` if one membership).
2. `wiki_read` each **pin** (id from briefing). Do not invent process the pins already hold.
3. Search then read (`wiki_search` → `wiki_read`, `card_search` → `card_get`). File cards after search. Log working memory with `activity_log`. `wiki_write` only after `wiki_read` this turn.

Ids are stable. Names are for search.
```

---

## File map

- `migrations/0006_wiki_pin.sql` — `pinned`
- `src/worker/wiki.ts` — row/list/patch + memory store
- `src/worker/wiki-http.ts` — PATCH `pinned`
- `src/worker/wiki.test.ts`, `wiki-http.test.ts`
- `src/worker/mcp.ts` — briefing `pins`; instructions; short descriptions
- `src/worker/mcp.test.ts` — pins on briefing; empty pins
- `src/app/stores/wiki.ts` + test — PATCH pinned
- `src/app/WikiView.vue` — pin/unpin on the list
- `.grok/skills/using-projthread/SKILL.md`
- docs after landing — STATUS, AGENTS, spec, this plan checkboxes, v1 index **Now**

Do not modify `catalog-http.ts`, room, admin, wrangler, package.json. Do not add Config MCP.

---

## Out of this slice (explicit)

| Deferred | Why |
| --- | --- |
| Pin order / `pin_position` | `updated_at` is enough for ≤10 |
| Bot sets pins | Human wiki first |
| `pinned` on `wiki_write` | Not wiki prose |
| Config MCP / empty tenant / drop Farm D1 | Next named work, not this |
| OAuth / room MCP / Deploy / FTS | Absences / parked |

---

## STATUS.md after this slice

**Live:** … + briefing **pins** (wiki entry points, no bodies); MCP instructions tell the bot to read pins.
**Now:** no open slice. Next named work is **workspace setup** (plan not written). Park Deploy. Do not start OAuth. Do not start room MCP. Do not start Config MCP until setup is named in STATUS.
**Next:** write the workspace-setup plan when José wants to leave Farm seed (admin/config empty tenant; Bot Config later).
**Parked (product):** PWA outline / attachment chrome. Config MCP. Empty-tenant / drop Farm D1 (ops after setup). Distinct agent OAuth tokens. Room MCP.

---

### Task 1: Maps

Files: this plan, `docs/STATUS.md`, `AGENTS.md`, `docs/superpowers/plans/2026-08-26-projthread-v1.md`, spec parked catalog MCP.

- [x] STATUS **Now:** execute this plan.
- [x] AGENTS **Now:** briefing-pins plan (see STATUS).
- [x] Index plan **14** row.
- [x] Spec: pins are plan 14; process lives on pinned wiki; Grok skill stays ontology.

---

### Task 2: Failing tests (wiki + MCP)

Files: `src/worker/wiki.test.ts`, `wiki-http.test.ts`, `mcp.test.ts`.

- [x] Memory wiki: insert two nodes, `updateNode` `{ pinned: 1, updated_at }`, `listNodes` includes `pinned: 1` / `0`.
- [x] HTTP: member `PATCH /api/nodes/:id` `{ pinned: true }` → 200, `node.pinned === 1` (or `true` — match existing JSON numbers). Outsider 403. `PATCH` `{ pinned: true }` with no title is enough.
- [x] MCP: pin a node via catalog/wiki store, `session_briefing` `{}` → `pins[0].title` set, `pins[0].content` undefined, briefing text has no body string. Unpin / never pinned → `pins` equals `[]`. Two-membership briefing (no workspace_id) still has no `pins` key or empty — **lock: omit `pins` when returning memberships-only.**

Run: `node --test --experimental-strip-types src/worker/wiki.test.ts src/worker/wiki-http.test.ts src/worker/mcp.test.ts` — expect fail (no column / no `pins`).

---

### Task 3: Migration + wiki HTTP

- [x] `migrations/0006_wiki_pin.sql`: `ALTER TABLE node ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;`
- [x] `NodeRow` / `NodeListRow` / `NodePatch` gain `pinned: number` (`0` \| `1`). SELECT lists include `pinned`. `applyPatch` applies it.
- [x] `patchNode`: if `pinned` present, must be boolean; store `1`/`0`. Allow PATCH that is only `{ pinned }`.
- [x] Tests pass for wiki + wiki-http.

---

### Task 4: Briefing + contract copy

- [x] `listRootCards` path unchanged. After stages/cards, `GET` workspace nodes (existing wrap), filter `pinned`, sort, cap 10, project `{ id, title, type, summary }`.
- [x] `MCP_INSTRUCTIONS` exact string above.
- [x] Descriptions: mechanical trim (Tool-to sentence + Side effects sentence).
- [x] Replace skill body as locked.
- [x] `mcp.test.ts` green. `npm test` green.

---

### Task 5: PWA pin

- [x] Wiki store: `setPinned(id, pinned: boolean)` PATCH `{ pinned }`.
- [x] Wiki list: control to pin/unpin; show which rows are pinned. No outline chrome. Desktop + compact nav still work.
- [x] Store test for the PATCH body.

---

### Task 6: Land status

- [x] STATUS / AGENTS / spec / index **Now** as “STATUS.md after this slice”.
- [ ] Remote D1: apply `0006` when deploying (José asks). Do not drop Farm data.

Do not deploy unless José asks.
