# ProjThread MCP façade Implementation Plan

> For Grok Build: one session, one slice. Compact after each task. Scout only if a file is not where this plan says. Do not add tests the plan did not ask for. Stop when STATUS is updated. Do not dispatch reviewer or superpowers:subagent-driven-development sub-agents. Do not start OAuth. Do not start room MCP.

**Goal:** Grok Bot (and Grok Build via `/mcp`) sees an intent-shaped catalog: briefing, search/read, labeled writes, Activity as working memory. Efficient and hard to misuse. Same Worker, same Bearer. No room tools.

**Architecture:** Keep `createMcpHandler` + HTTP wrap so membership and validation stay in `handleMe` / `handleCatalog` / `handleWiki`. Replace the fifteen endpoint tools with a façade compiled in `src/worker/mcp.ts`. Workspace is implicit when the principal has exactly one membership. Project is never bound to the D1 session. Server `instructions` plus `docs/agent-facing.md` are the process skill.

**Tech Stack:** Existing Worker, `src/worker/mcp.ts` / `mcp.test.ts`, `node --test --experimental-strip-types`. No new deps, no bindings, no PWA, no HTTP route changes except what the wrap already calls.

**Constraints source:** `docs/agent-tooling-brief.md` (normative for this slice). Do not add tools beyond the locked catalog unless a test in this plan fails.

---

## Locked calls (do not re-litigate)

| Topic | Call |
| --- | --- |
| Catalog | Replace HTTP-wrap names. No aliases for `me`, `list_*`, `get_work_item`, `get_node`, `create_node`, `update_node`, `update_work_item_title`, `list_work_items`, `list_projects`, `list_stages`. Overlap is worse than a missing rare endpoint. |
| Workspace | If `GET /api/me` memberships length is 1, omit `workspace_id`. If the agent passes one, it must be a membership. If length ≠ 1 and the tool needs a workspace, `isError` with hint to pass `workspace_id` from `session_briefing`. |
| Project | Not tied to the Bearer or to MCP state. `card_create` / `card_search` take `project_id` when the intent needs it. `session_briefing` lists the forest once. |
| Transport / auth | Unchanged: `/mcp`, Bearer only, cookie ignored, stateless JSON. |
| Room / OAuth / FTS / propose queue / meta-tools / Config / Deploy | Out. Substring filter on title/summary (wiki) and title (cards). Wiki writes are canonical (`wiki_write`), not a review queue. |
| Node markdown | `wiki_read` / `wiki_create` / `wiki_write` / `compose_node` / `cite_node`: `content[0].text` is raw markdown. Envelope JSON in `content[1].text` **must not** repeat `node.content`. Errors stay one JSON text part, `isError: true`. |
| Activity | `activity_log` is `decision` \| `occurrence` \| `note` only. Stage changes are `card_move`. May wake Room via existing `appendSystem` (same as PWA). |
| Idempotent create | `card_create`: if a card on that `project_id` already has the same `title` (exact), return that row and `{ already_exists: true }`. Do not insert. |
| Hits cap | Search and briefing cards: at most **50**. If truncated, include `"truncated": true`. |
| `card_rename` | Restores PATCH title. Approved table omitted it; without it the agent cannot retitle. Not a general `card_update`. |

### Tool set (fifteen)

| Tool | Args | Return (default) | Side effects |
| --- | --- | --- | --- |
| `session_briefing` | `workspace_id?` | See below | none |
| `wiki_search` | `query` (min 1), `type?`, `workspace_id?` | `{ hits: [{ id, title, type, summary, updated_at }] }` | none |
| `wiki_read` | `node_id` | markdown + envelope | none |
| `wiki_create` | `title`, `type?`, `summary?`, `content?`, `work_item_id?`, `workspace_id?` | markdown + envelope | write |
| `wiki_write` | `node_id`, optional patch fields (at least one of title/type/summary/content) | markdown + envelope | write (canonical wiki) |
| `compose_node` | `node_id`, `child_id`, `position?` | markdown + envelope | write |
| `cite_node` | `node_id`, `to_id` | markdown + envelope | write |
| `attach_node_work_item` | `node_id`, `work_item_id` | HTTP JSON compact | write |
| `card_search` | `query?`, `project_id?`, `stage_key?`, `workspace_id?` | `{ hits: [{ id, title, stage_key, project_id, updated_at }] }` | none |
| `card_get` | `work_item_id`, `limit?` (default 10, max 20) | `{ card, events }` last N events (existing ASC order, slice `-N`) | none |
| `card_create` | `project_id`, `title`, `workspace_id?` | `{ already_exists, card }` | write unless exists |
| `card_rename` | `work_item_id`, `title` | compact card | write |
| `card_move` | `work_item_id`, `from`, `to`, `body` | `{ event, card }` | write; may wake room |
| `activity_log` | `work_item_id`, `type`, `body`, `ref_node_id?` | `{ event, card }` | write; may wake room |
| `activity_recent` | `work_item_id`, `limit?`, `type?` | `{ events }` | none |

`session_briefing` when workspace is known:

```json
{
  "principal": { "id": "", "type": "agent", "display_name": "" },
  "workspace": { "id": "", "name": "", "role": "member" },
  "projects": [{ "id": "", "name": "", "parent_id": null }],
  "stages": [{ "key": "backlog", "label": "Backlog", "position": 0 }],
  "cards": [{ "id": "", "title": "", "stage_key": "", "project_id": "", "updated_at": "" }],
  "truncated": false
}
```

When memberships length ≠ 1 and `workspace_id` is omitted, **do not** `isError`. Return `{ principal, memberships: [{ workspace_id, workspace_name, role }] }` so the agent can call again with an id. No projects/cards.

Card list for briefing/`card_search` without `project_id`: `GET` projects, then `GET .../work-items?project_id=` **once per root** (`parent_id === null`) so descendants are not duplicated.

Wiki search match: case-insensitive substring on `title` and `summary` (null summary skips). `query` required.

### Descriptions (exact)

Every tool: what / when / not-when / side effects. Put these strings in `registerTool` (trim whitespace only, do not rewrite).

- `session_briefing`: `Tool to compile who you are and the workspace board (projects, stages, compact cards). Use at session start or when board context is missing. Do not use to read a wiki page or a single card (wiki_read / card_get). Side effects: none. If this principal has one membership, omit workspace_id.`
- `wiki_search`: `Tool to search wiki nodes by title/summary substring. Use to find a page id. Do not use to read markdown (wiki_read) or list cards. Side effects: none. Hits only; no content.`
- `wiki_read`: `Tool to read one wiki page. Use when you have a node_id from search or briefing. Do not use to search. Side effects: none. content[0] is markdown.`
- `wiki_create`: `Tool to create a wiki page. Use when no existing page should hold this. Do not use to patch (wiki_write) or to log a card decision (activity_log). Side effects: write.`
- `wiki_write`: `Tool to patch canonical wiki (title, type, summary, content). Use only after wiki_read on this node in this turn. Do not use to create. Side effects: write; overwrites the page.`
- `compose_node`: `Tool to include a wiki node as an ordered child. Use for outline parts. Do not use to cite (cite_node) or attach a card. Side effects: write.`
- `cite_node`: `Tool to cite another wiki node (ref, not include). Use for pointers. Do not use to nest outline children. Side effects: write.`
- `attach_node_work_item`: `Tool to link a wiki node to a card. Use when the page is about that work item. Do not use to compose or cite nodes. Side effects: write.`
- `card_search`: `Tool to find cards (id, title, stage, project). Use before create to avoid duplicates, or to pick an id. Do not use for wiki. Side effects: none.`
- `card_get`: `Tool to get one card plus last N Activity events. Use when working a known work_item_id. Do not use to list the board (session_briefing / card_search). Side effects: none.`
- `card_create`: `Tool to create a card on a project (starts in backlog). Use after card_search. If the same title already exists on that project, returns it and already_exists true. Side effects: write unless exists.`
- `card_rename`: `Tool to retitle a card. Use when the work_item_id is known. Do not use to move stages (card_move). Side effects: write.`
- `card_move`: `Tool to move a card between stages. Use when the stage should change; body is the required reason. Do not use to log a decision without a move (activity_log). Side effects: write; writes Activity; may wake the room.`
- `activity_log`: `Tool to append a typed Activity event (decision, occurrence, note). Use for working memory the next session must see. Do not use for stage changes (card_move) or wiki pages (wiki_write). Side effects: write; may wake the room.`
- `activity_recent`: `Tool to read recent Activity on a card (failed-approach precheck). Use before repeating an approach. Do not use to write. Side effects: none.`

Annotations: read tools `readOnlyHint: true`, `idempotentHint: true`. Writes `readOnlyHint: false`. `card_create` `idempotentHint: true`. `card_move` / `activity_log` `idempotentHint: false`.

### Errors

HTTP 4xx/5xx from wrap → `isError: true`, JSON `{ status, error }` as today, plus `hint` when the façade knows the next argument (`workspace_id`, `query`, `project_id`). Workspace missing: `{ "error": "workspace_required", "hint": "Pass workspace_id from session_briefing." }`. Empty wiki query: `{ "error": "query_required", "hint": "wiki_search needs query; do not list the whole wiki." }`. `wiki_write` with no patch fields: `{ "error": "patch_required", "hint": "Pass at least one of title, type, summary, content." }`.

### Skill

`docs/agent-facing.md` (human + Grok Build). Same text, compressed, on `new McpServer({ name, version, instructions })` so Grok Bot sees it without the repo.

---

## File map

- `docs/superpowers/plans/2026-08-31-projthread-mcp-facade.md` — this plan
- `src/worker/mcp.ts` — façade tools, workspace helper, projections, instructions
- `src/worker/mcp.test.ts` — full catalog memory store; new names; briefing; implicit workspace; search hits; envelope without `node.content`; idempotent create; activity
- `docs/agent-facing.md` — process skill
- docs after landing — STATUS, AGENTS, spec parked catalog MCP, v1 index

Do not modify `src/worker/wiki-http.ts`, `src/worker/catalog-http.ts`, `src/room/*`, `src/app/*`, `src/admin/*`, migrations, `wrangler.jsonc`, `package.json`.

---

## Out of this slice (explicit)

| Deferred | Why |
| --- | --- |
| Stamp `workspace_id` on Issue token | Unique membership covers Farm; multi-workspace tokens later |
| Stateful MCP / `McpAgent` / project-on-session | Named absences; project changes inside a conversation |
| OAuth / distinct agent tokens | Absence |
| Room / WS tools | Cookie-only tape. Named absence |
| FTS / Vectorize | Substring first |
| Propose-then-review wiki queue | No PWA |
| `search_tools` | Catalog is fifteen |
| Config (members, projects, stages) | Not agent start path |
| Deploy | Parked |

---

## STATUS.md after this slice

**Live:** … + `/mcp` façade (briefing, wiki/card search, Activity log/recent, implicit workspace when one membership; node markdown still `content[0]`).
**Now:** no open slice. Park Deploy until a custom domain exists. Do not start OAuth. Do not start room MCP.
**Next:** when a domain exists, write the Deploy plan. Until then, wait.
**Parked (product):** PWA outline / attachment chrome. Distinct agent OAuth tokens. Room MCP. HTTP-wrap MCP names (replaced).

---

### Task 1: Maps

Files: this plan, `docs/STATUS.md`, `AGENTS.md`, `docs/superpowers/plans/2026-08-26-projthread-v1.md`, spec parked catalog MCP.

- [x] STATUS **Now:** execute this plan. Do not implement Deploy. Do not start OAuth. Do not start room MCP.
- [x] AGENTS **Now:** mcp-facade plan (see STATUS).
- [x] Index plan **13** row: `2026-08-31-projthread-mcp-facade.md`.
- [x] Spec **Parked: catalog MCP** — plan 13 is the agent-facing façade; OAuth and room MCP stay absences. Old wrap names are gone.

---

### Task 2: Failing tests

Files: modify `src/worker/mcp.test.ts`.

- [x] **Step 1: Replace `memoryCatalog`**

Copy `memoryCatalog` from `src/worker/catalog.test.ts` (complete `CatalogStore`). Widen principal `type` to `"human" | "agent" | "service"`. Keep `memberContext` / `farmBundle` / `mintSession`. `insertTenantBundle` must seed default stages and the bundle project (catalog.test already does).

Drop the `byPrincipal` argument and the `unused()` stubs.

- [x] **Step 2: Stub `env.Room`** so `activity_log` / `card_move` do not throw.

Replace `const env = { APP_ORIGIN: ORIGIN } as Env` with:

```ts
const env = {
  APP_ORIGIN: ORIGIN,
  Room: {
    getByName() {
      return {
        fetch: async () => new Response(),
        async appendSystem({ event_id }: { event_id: string }) {
          return {
            seq: 1,
            kind: "activity" as const,
            body: "",
            actor_id: null,
            event_id,
            created_at: "2026-01-01T00:00:00.000Z",
          };
        },
      };
    },
  },
} as Env;
```

- [x] **Step 3: Replace `TOOL_NAMES`**

```ts
const TOOL_NAMES = [
  "session_briefing",
  "wiki_search",
  "wiki_read",
  "wiki_create",
  "wiki_write",
  "compose_node",
  "cite_node",
  "attach_node_work_item",
  "card_search",
  "card_get",
  "card_create",
  "card_rename",
  "card_move",
  "activity_log",
  "activity_recent",
] as const;
```

- [x] **Step 4: Helper `callTool`** (same file)

```ts
function callTool(
  sessionId: string,
  name: string,
  args: Record<string, unknown>,
) {
  return postMcp(
    { authorization: `Bearer ${sessionId}` },
    "tools/call",
    { name, arguments: args },
    name,
  );
}

async function toolResult(
  res: Response,
): Promise<{
  isError?: boolean;
  content: { type: string; text: string }[];
}> {
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    result?: { content?: { type: string; text: string }[]; isError?: boolean };
  };
  return {
    isError: body.result?.isError,
    content: body.result?.content ?? [],
  };
}
```

- [x] **Step 5: Rewrite existing tool tests**

- `tools/list names the catalog wrap` → `tools/list names the façade` (still compares sorted `TOOL_NAMES`).
- Delete `tools/call me returns the principal`.
- `create_node` → `wiki_create`. Arguments: `{ title, type, content }` **without** `workspace_id` (Farm has one membership). Envelope `content[1]` JSON: `assert.equal(payload.node.content, undefined)` and `assert.equal(content[0].text, "Twice daily.")`.
- Markdown unescape test: `wiki_create` then `wiki_read` (was `get_node`).
- `compose_node` / `cite_node` / cycle tests: create via `wiki_create`.

- [x] **Step 6: Add cases** after the cycle test

```ts
  it("session_briefing without workspace_id uses the sole membership", async () => {
    const { sessionId, sessions, catalog, wiki, bundle, principal } =
      await memberContext();
    await catalog.insertWorkItem({
      id: "wi-1",
      project_id: bundle.project.id,
      workspace_id: bundle.workspace.id,
      organization_id: bundle.organization.id,
      title: "Collect eggs",
      stage_key: "doing",
      owner_id: null,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    });
    const result = await toolResult(
      await handleMcp(
        callTool(sessionId, "session_briefing", {}),
        env,
        sessions,
        catalog,
        wiki,
      ),
    );
    assert.notEqual(result.isError, true);
    const payload = JSON.parse(result.content[0]?.text ?? "{}") as {
      principal: { id: string };
      workspace: { id: string };
      cards: { id: string; title: string; stage_key: string }[];
      memberships?: unknown;
    };
    assert.equal(payload.principal.id, principal.id);
    assert.equal(payload.workspace.id, bundle.workspace.id);
    assert.equal(payload.memberships, undefined);
    assert.equal(payload.cards[0]?.title, "Collect eggs");
    assert.equal(payload.cards[0]?.stage_key, "doing");
  });

  it("session_briefing with two memberships lists them until workspace_id is passed", async () => {
    const { sessionId, sessions, catalog, wiki, bundle, principal } =
      await memberContext();
    await catalog.insertTenantBundle({
      organization: {
        id: "org-consult",
        name: "Consultoria",
        created_at: "2026-01-01T00:00:00.000Z",
      },
      workspace: {
        id: "ws-consult",
        organization_id: "org-consult",
        name: "Consultoria",
        created_at: "2026-01-01T00:00:00.000Z",
      },
      project: {
        id: "proj-consult",
        workspace_id: "ws-consult",
        organization_id: "org-consult",
        parent_id: null,
        name: "Consultoria",
        created_at: "2026-01-01T00:00:00.000Z",
      },
      principal: {
        id: principal.id,
        type: "agent",
        display_name: principal.display_name,
        created_at: "2026-01-01T00:00:00.000Z",
      },
      membership: {
        workspace_id: "ws-consult",
        principal_id: principal.id,
        role: "member",
      },
    });
    const listed = await toolResult(
      await handleMcp(
        callTool(sessionId, "session_briefing", {}),
        env,
        sessions,
        catalog,
        wiki,
      ),
    );
    const listedPayload = JSON.parse(listed.content[0]?.text ?? "{}") as {
      memberships: { workspace_id: string }[];
      cards?: unknown;
    };
    assert.equal(listedPayload.memberships.length, 2);
    assert.equal(listedPayload.cards, undefined);

    const wikiFail = await toolResult(
      await handleMcp(
        callTool(sessionId, "wiki_search", { query: "feed" }),
        env,
        sessions,
        catalog,
        wiki,
      ),
    );
    assert.equal(wikiFail.isError, true);
    assert.match(wikiFail.content[0]?.text ?? "", /workspace_required/);

    const farm = await toolResult(
      await handleMcp(
        callTool(sessionId, "session_briefing", {
          workspace_id: bundle.workspace.id,
        }),
        env,
        sessions,
        catalog,
        wiki,
      ),
    );
    const farmPayload = JSON.parse(farm.content[0]?.text ?? "{}") as {
      workspace: { id: string };
    };
    assert.equal(farmPayload.workspace.id, bundle.workspace.id);
  });

  it("wiki_search returns hits without content", async () => {
    const { sessionId, sessions, catalog, wiki } = await memberContext();
    await handleMcp(
      callTool(sessionId, "wiki_create", {
        title: "Feed schedule",
        content: "Twice daily. Secret ration.",
      }),
      env,
      sessions,
      catalog,
      wiki,
    );
    const result = await toolResult(
      await handleMcp(
        callTool(sessionId, "wiki_search", { query: "feed" }),
        env,
        sessions,
        catalog,
        wiki,
      ),
    );
    assert.notEqual(result.isError, true);
    const payload = JSON.parse(result.content[0]?.text ?? "{}") as {
      hits: { title: string; content?: string }[];
    };
    assert.equal(payload.hits[0]?.title, "Feed schedule");
    assert.equal(payload.hits[0]?.content, undefined);
    assert.equal(result.content[0]?.text.includes("Secret ration"), false);
  });

  it("card_create is idempotent on title in the same project", async () => {
    const { sessionId, sessions, catalog, wiki, bundle } = await memberContext();
    const first = await toolResult(
      await handleMcp(
        callTool(sessionId, "card_create", {
          project_id: bundle.project.id,
          title: "Collect eggs",
        }),
        env,
        sessions,
        catalog,
        wiki,
      ),
    );
    const firstPayload = JSON.parse(first.content[0]?.text ?? "{}") as {
      already_exists: boolean;
      card: { id: string; title: string };
    };
    assert.equal(firstPayload.already_exists, false);
    const second = await toolResult(
      await handleMcp(
        callTool(sessionId, "card_create", {
          project_id: bundle.project.id,
          title: "Collect eggs",
        }),
        env,
        sessions,
        catalog,
        wiki,
      ),
    );
    const secondPayload = JSON.parse(second.content[0]?.text ?? "{}") as {
      already_exists: boolean;
      card: { id: string };
    };
    assert.equal(secondPayload.already_exists, true);
    assert.equal(secondPayload.card.id, firstPayload.card.id);
  });

  it("activity_log then activity_recent round-trips a decision", async () => {
    const { sessionId, sessions, catalog, wiki, bundle } = await memberContext();
    const created = await toolResult(
      await handleMcp(
        callTool(sessionId, "card_create", {
          project_id: bundle.project.id,
          title: "Nest boxes",
        }),
        env,
        sessions,
        catalog,
        wiki,
      ),
    );
    const card = JSON.parse(created.content[0]?.text ?? "{}") as {
      card: { id: string };
    };
    const logged = await toolResult(
      await handleMcp(
        callTool(sessionId, "activity_log", {
          work_item_id: card.card.id,
          type: "decision",
          body: "Rejected hourly collection; twice daily stays.",
        }),
        env,
        sessions,
        catalog,
        wiki,
      ),
    );
    assert.notEqual(logged.isError, true);
    const recent = await toolResult(
      await handleMcp(
        callTool(sessionId, "activity_recent", {
          work_item_id: card.card.id,
        }),
        env,
        sessions,
        catalog,
        wiki,
      ),
    );
    const payload = JSON.parse(recent.content[0]?.text ?? "{}") as {
      events: { type: string; body: string }[];
    };
    assert.equal(payload.events.at(-1)?.type, "decision");
    assert.match(payload.events.at(-1)?.body ?? "", /twice daily/i);
  });
```

- [x] **Step 7: Run tests; expect fail** because façade tools are not registered.

```bash
node --test --experimental-strip-types src/worker/mcp.test.ts
```

Expected: `tools/list` mismatch and missing `wiki_create` / `session_briefing`.

---

### Task 3: Façade in `mcp.ts`

Files: modify `src/worker/mcp.ts`.

- [x] **Step 1: Instructions + helpers**

`new McpServer({ name: "projthread", version: "1.0.0", instructions: MCP_INSTRUCTIONS })` with:

```ts
const MCP_INSTRUCTIONS = `ProjThread catalog. Start with session_briefing. Search then read (wiki_search → wiki_read, card_search → card_get). File cards with card_create after search; log decisions with activity_log, not wiki. wiki_write only after wiki_read this turn. One membership: omit workspace_id. Chat tape is not on this server.`;
```

Add:

- `async function me(deps)` → `wrap(deps, "/api/me")` then parse `{ principal, memberships }`.
- `async function workspaceId(deps, explicit?: string): Promise<string | { error: string; hint: string }>` as locked above.
- `function compactCard(item)` → `{ id, title, stage_key, project_id, updated_at }`.
- `function nodeEnvelope(text: string)` — parse GET JSON, clone `node` without `content`, `blob_key`, `mime_type`, `byte_size`, `filename`. Markdown from original `node.content`.
- `function jsonResult(obj)` / `function errorResult(obj)` (`isError: true`).
- `async function listRootCards(deps, workspaceId)` — GET projects, filter `parent_id == null`, GET work-items per root, concat, compact.
- `function parseWrapJson(result)` — if `isError` return it; else `JSON.parse(content[0].text)`.

Keep existing `wrap` / `nodeToolResult` but change `nodeToolResult` to strip `content` from the envelope (tests require `payload.node.content === undefined`). Apply that strip for `wiki_create` / `wiki_write` / `wiki_read` / compose / cite.

- [x] **Step 2: Replace `createServer` tools** with the locked catalog. `workspace_id` always `z.string().optional()`. `activity_log` type `z.enum(["decision", "occurrence", "note"])`. `wiki_search` `query: z.string().min(1)`. `limit` `z.number().int().min(1).max(20).optional()`.

`card_create` flow: resolve workspace (from `getProject` → `workspace_id` if `project_id` given: `GET` is not enough; wrap `GET /api/workspaces/:ws/work-items?project_id=` needs workspace. Resolve workspace first (implicit or arg), then GET work-items, then POST if no title match.)

If `getProject` is easier: wrap does not expose GET project. Use resolved workspace + list.

`card_get`: wrap GET work-item + GET `.../events`, slice last `limit`.

`activity_log`: POST `{ type, body, ref_node_id }` to `/api/work-items/:id/events`. Project `{ event, card: compactCard(work_item) }` from the 201 body.

`card_move`: existing events POST `stage_changed`.

Do not register old names.

- [x] **Step 3: Run** `node --test --experimental-strip-types src/worker/mcp.test.ts` — pass. Then `npm test`.

---

### Task 4: Skill file

Files: create `docs/agent-facing.md`. Modify `AGENTS.md` Read next (one row).

- [x] **Step 1: Write `docs/agent-facing.md`**

```markdown
# Agent-facing ProjThread

How to use `/mcp`. Tools execute; this file is judgment.

1. **Start** with `session_briefing`. If you have one membership, omit `workspace_id`. If you get `memberships` and no `cards`, call again with a `workspace_id`.
2. **Search then read.** `wiki_search` → `wiki_read`. `card_search` → `card_get`. Do not dump the wiki into context.
3. **File work as a card.** `card_search` first. `card_create` is idempotent on title in a project. Do not invent a second card for the same work.
4. **Working memory is Activity.** `activity_log` (`decision` / `occurrence` / `note`). `activity_recent` before repeating an approach. Stage changes are `card_move` (reason required).
5. **Wiki writes are canonical.** `wiki_write` only after `wiki_read` on that node this turn. Create with `wiki_create` when no page should hold it. Compose vs cite: `compose_node` nests; `cite_node` points; `attach_node_work_item` links a card.
6. **Never:** room/chat tools (they are not here), Vectorize, OAuth, overwriting wiki without a read, using wiki as a diary of failed attempts.

Ids are stable. Names are for search.
```

- [x] **Step 2:** AGENTS **Read next** add: `| Agent MCP process | \`docs/agent-facing.md\` |`

---

### Task 5: Land status

Files: `docs/STATUS.md`, `AGENTS.md`, spec parked catalog MCP, this plan checkboxes, v1 index **Now** line.

- [x] **Live** includes façade bullets from “STATUS.md after this slice”.
- [x] **Now:** no open slice. Park Deploy. Do not start OAuth. Do not start room MCP.
- [x] Index **Now:** plan 13 landed.
- [x] Spec parked: façade names; wrap names gone; absences unchanged.
- [x] `npm test` green.

Do not deploy unless José asks. workers.dev can wait; local tests are the gate.
