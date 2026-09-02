# ProjThread Config MCP Implementation Plan

> For Grok Build: one session, one slice. Compact after each task. Scout only if a file is not where this plan says. Do not add tests the plan did not ask for. Stop when STATUS is updated. Do not dispatch reviewer or superpowers:subagent-driven-development sub-agents. Do not start OAuth. Do not start room MCP. Do not mint principals. Do not add a people picker in the PWA. Do not add a UI kit. Do not add card/node/project archive or delete. Do not drop remote D1. Do not change catalog HTTP.

**Goal:** Grok Bot maintains workspace structure (members, projects, stages, extra workspaces) through `/mcp`. José reads the wiki. Same Worker, same Bearer wrap. No room tools.

**Architecture:** Keep `createMcpHandler` + HTTP wrap. Membership, last-owner, cycle, and stage-key checks stay in `handleCatalog`. Nine intent tools call existing catalog routes. `principal_id` is an id (briefing / `members_list`), not a display name. Admin still vends sessions.

**Tech Stack:** Existing Worker, `src/worker/mcp.ts` / `mcp.test.ts`, `node --test --experimental-strip-types`. No new deps, no bindings, no PWA, no HTTP, no migration.

---

## Locked calls (do not re-litigate)

| Topic | Call |
| --- | --- |
| Wrap | Catalog HTTP only. Do not wrap `/api/admin/*`. Do not add catalog routes. Do not re-add wrap names (`list_members`, `list_projects`, …). |
| Identity | No principal mint. `members_add` requires an existing `principal_id`. Unknown id → wrap `400`. Display name is not a key. |
| First workspace | PWA setup stays. `workspace_create` wraps the same `POST /api/organizations`. Caller becomes owner. No new principal. Do **not** `PATCH /api/me` (sole membership already resolves `workspaceId()`). |
| Workspace arg | Same `workspaceId()` as today: explicit membership, else bound session, else sole membership, else `workspace_required`. `workspace_create` has no `workspace_id`. `project_rename` / `project_reparent` take `project_id` only (HTTP membership on the project). |
| Stages | Keys stay `backlog` / `doing` / `done`. `stages_replace` sends the **full** list (labels + positions). Different key set → HTTP `400`. |
| Members mutate | `PATCH`/`DELETE` already require caller **owner**. Last owner → `400` `{ error: "last_owner" }`. `POST` members is any member (today). |
| Briefing | Unchanged. Still projects + stages + cards + pins. Members are `members_list`, not a briefing field. |
| Room / OAuth / PWA / people picker / UI kit / Deploy / drop Farm | Out. |
| Transport | Unchanged: `/mcp`, Bearer only, cookie ignored, stateless JSON. |

### Tool set (nine new; façade fifteen stay)

| Tool | Args | Wrap | Side effects |
| --- | --- | --- | --- |
| `workspace_create` | `name` | `POST /api/organizations` `{ name }` | write |
| `members_list` | `workspace_id?` | `GET /api/workspaces/:ws/members` | none |
| `members_add` | `principal_id`, `role?` (`owner` \| `member`), `workspace_id?` | `POST /api/workspaces/:ws/members` | write |
| `members_set_role` | `principal_id`, `role`, `workspace_id?` | `PATCH /api/workspaces/:ws/members/:principal_id` `{ role }` | write |
| `members_remove` | `principal_id`, `workspace_id?` | `DELETE /api/workspaces/:ws/members/:principal_id` | write |
| `project_create` | `name`, `parent_id?`, `workspace_id?` | `POST /api/workspaces/:ws/projects` | write |
| `project_rename` | `project_id`, `name` | `PATCH /api/projects/:id` `{ name }` | write |
| `project_reparent` | `project_id`, `parent_id` (`string` \| `null`) | `PATCH /api/projects/:id` `{ parent_id }` | write |
| `stages_replace` | `stages: [{ key, label, position }]`, `workspace_id?` | `PATCH /api/workspaces/:ws/stages` `{ stages }` | write |

`tools/list` names = existing fifteen **plus** these nine (24). Sort in the assertion as today.

Returns: pass wrap JSON through (`json` mode). `DELETE` 204 empty body → wrap already emits `"{}"`. Errors: wrap `isError` + `{ status, error }` as today.

### Descriptions (exact)

Trim whitespace only.

- `workspace_create`: `Tool to create an organization + workspace + root project + default stages; caller becomes owner. Use when this principal needs a new place. Do not use to add a member or a project inside an existing workspace. Side effects: write. Does not mint a principal.`
- `members_list`: `Tool to list workspace members (principal_id, display_name, type, role). Use before add/role/remove. Do not use to search wiki or cards. Side effects: none.`
- `members_add`: `Tool to add an existing principal to the workspace. Use a principal_id from briefing or members_list, not a display name. Do not use to create a login. Side effects: write. Unknown principal_id is an error.`
- `members_set_role`: `Tool to set a member role (owner or member). Caller must be owner. Do not use to add or remove. Side effects: write. Last owner demotion is an error.`
- `members_remove`: `Tool to remove a member. Caller must be owner. Do not use to change role. Side effects: write. Last owner removal is an error.`
- `project_create`: `Tool to create a project (optional parent_id). Use after session_briefing. Do not use to rename or reparent. Side effects: write.`
- `project_rename`: `Tool to retitle a project. Use when project_id is known. Do not use to move it in the forest (project_reparent). Side effects: write.`
- `project_reparent`: `Tool to set a project's parent_id (string or null for root). Use to place it in the forest. Do not use to rename. Side effects: write. Cycle or other-workspace parent is an error.`
- `stages_replace`: `Tool to replace workspace stage labels and positions. Pass the full list; keys must stay backlog, doing, done. Do not invent keys. Side effects: write.`

Annotations: `members_list` `READ`. Writes `WRITE`. `members_set_role` / `members_remove` / `stages_replace` `idempotentHint: false`.

### Instructions (replace MCP_INSTRUCTIONS)

Exact:

```
ProjThread is a live workspace, not a ticket tracker. A card is the work (one card, one chat room — chat is not on this server). Wiki is reusable knowledge. Activity on a card is working memory. Start with session_briefing; wiki_read the pins — that is how this workspace works. Then search. Session may bind workspace; omit workspace_id when bound or when there is one membership. Maintain members, projects, stages, and extra workspaces with workspace_create, members_*, project_*, stages_replace. principal_id is an id, not a display name.
```

---

## File map

- `src/worker/mcp.ts` — nine tools; `MCP_INSTRUCTIONS`
- `src/worker/mcp.test.ts` — `TOOL_NAMES`; memory catalog membership/project/workspace helpers that currently throw; config tool tests
- `.grok/skills/using-projthread/SKILL.md` — agents maintain structure; `principal_id` not display name
- `docs/agent-facing.md` — Config MCP wrap note
- `docs/STATUS.md`, `AGENTS.md`, index, spec PWA item 4

Do not modify `catalog-http.ts`, `catalog.ts` (D1), room, admin, app, wrangler, migrations, package.json.

---

## Out of this slice (explicit)

| Deferred | Why |
| --- | --- |
| Mint principal / people picker / display-name add | José: agents maintain; admin still vends people |
| Members on `session_briefing` | Extra field on a stable tool; `members_list` exists |
| Bind session after `workspace_create` | Sole membership already resolves; second workspace must stay explicit |
| Wiki pin MCP | Pins are wiki; PWA toggle shipped |
| Card owner MCP | Not members/projects/stages |
| Room MCP / OAuth / Deploy / drop Farm | Absences / parked / ops |

---

## STATUS.md after this slice

**Live:** … + `/mcp` Config tools (workspace create, members list/add/role/remove, project create/rename/reparent, stages replace; still wrap catalog HTTP; `principal_id` not display name).
**Now:** no open slice. Park Deploy. Do not start OAuth. Do not start room MCP. Do not drop remote D1 unless José asks.
**Next:** wait (Deploy parked; OAuth and room MCP absences).
**Parked:** Config MCP **shipped**. Distinct agent OAuth tokens. Room MCP.

---

### Task 1: Maps

Files: this plan, `docs/STATUS.md`, `AGENTS.md`, `docs/superpowers/plans/2026-08-26-projthread-v1.md`, spec **PWA product** item 4.

- [x] STATUS **Now:** execute this plan. Do not implement Deploy. Do not start OAuth. Do not start room MCP. Do not mint principals. Do not add a PWA people picker.
- [x] AGENTS **Now:** config-mcp plan (see STATUS). Drop “Do not start Config MCP”.
- [x] Index plan **18** row: `2026-09-02-projthread-config-mcp.md`.
- [x] Spec item 4: this plan. Parked briefing-pins line: Config MCP is this plan.

---

### Task 2: Memory catalog — methods Config wrap needs

Files: `src/worker/mcp.test.ts`.

`memoryCatalog()` currently throws on `updateMembershipRole`, `deleteMembership`, `countOwners`, `updateProjectParent`, `insertWorkspaceFor`. Copy the bodies from `src/worker/catalog-http.test.ts` memory catalog (same maps). Import `newId` from `../lib/id.ts`.

- [x] **Step 1: Replace the five throw stubs**

`updateMembershipRole` / `deleteMembership` / `countOwners` / `updateProjectParent`: same as catalog-http test memory store.

`insertWorkspaceFor(principalId, name)`: same as catalog-http test (org + workspace + `DEFAULT_STAGES` + root project + owner membership). Return `{ organization, workspace, project }` with the 201 shape (no `created_at` on the return object).

- [x] **Step 2: Run existing MCP tests — still pass**

Run: `node --test --experimental-strip-types src/worker/mcp.test.ts`

Expected: PASS (no new tools yet).

- [x] **Step 3: Commit**

```bash
git add src/worker/mcp.test.ts
git commit -m "test: memory catalog methods Config MCP wrap needs"
```

---

### Task 3: Failing tools/list

Files: `src/worker/mcp.test.ts`.

- [x] **Step 1: Extend TOOL_NAMES**

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
  "workspace_create",
  "members_list",
  "members_add",
  "members_set_role",
  "members_remove",
  "project_create",
  "project_rename",
  "project_reparent",
  "stages_replace",
] as const;
```

- [x] **Step 2: Run tools/list test — fail**

Run: `node --test --experimental-strip-types src/worker/mcp.test.ts`

Expected: FAIL `tools/list names the façade` — missing the nine names.

- [x] **Step 3: Do not implement yet. Commit the assertion**

```bash
git add src/worker/mcp.test.ts
git commit -m "test: Config MCP tools/list expects 24 names"
```

---

### Task 4: Register the nine tools

Files: `src/worker/mcp.ts`.

- [x] **Step 1: Replace MCP_INSTRUCTIONS** with the locked string (one line, same template-literal style as today).

- [x] **Step 2: Register tools after `activity_recent`, before `return server`.**

Use existing `workspaceId`, `wrap`, `compactJson`, `READ`, `WRITE`. `parent_id` on create: omit from body when undefined (`compactJson`). `project_reparent`: `parent_id: z.union([z.string(), z.null()])`. `stages`: `z.array(z.object({ key: z.string(), label: z.string(), position: z.number() }))`. `members_add` role: `z.enum(["owner", "member"]).optional()`.

```ts
  server.registerTool(
    "workspace_create",
    {
      description:
        "Tool to create an organization + workspace + root project + default stages; caller becomes owner. Use when this principal needs a new place. Do not use to add a member or a project inside an existing workspace. Side effects: write. Does not mint a principal.",
      inputSchema: { name: z.string() },
      annotations: WRITE,
    },
    async ({ name }) =>
      wrap(deps, "/api/organizations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      }),
  );

  server.registerTool(
    "members_list",
    {
      description:
        "Tool to list workspace members (principal_id, display_name, type, role). Use before add/role/remove. Do not use to search wiki or cards. Side effects: none.",
      inputSchema: { workspace_id: z.string().optional() },
      annotations: READ,
    },
    async ({ workspace_id }) => {
      const ws = await workspaceId(deps, workspace_id);
      if (typeof ws !== "string") return ws;
      return wrap(deps, `/api/workspaces/${ws}/members`);
    },
  );

  server.registerTool(
    "members_add",
    {
      description:
        "Tool to add an existing principal to the workspace. Use a principal_id from briefing or members_list, not a display name. Do not use to create a login. Side effects: write. Unknown principal_id is an error.",
      inputSchema: {
        principal_id: z.string(),
        role: z.enum(["owner", "member"]).optional(),
        workspace_id: z.string().optional(),
      },
      annotations: WRITE,
    },
    async ({ principal_id, role, workspace_id }) => {
      const ws = await workspaceId(deps, workspace_id);
      if (typeof ws !== "string") return ws;
      return wrap(deps, `/api/workspaces/${ws}/members`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: compactJson({ principal_id, role }),
      });
    },
  );

  server.registerTool(
    "members_set_role",
    {
      description:
        "Tool to set a member role (owner or member). Caller must be owner. Do not use to add or remove. Side effects: write. Last owner demotion is an error.",
      inputSchema: {
        principal_id: z.string(),
        role: z.enum(["owner", "member"]),
        workspace_id: z.string().optional(),
      },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ principal_id, role, workspace_id }) => {
      const ws = await workspaceId(deps, workspace_id);
      if (typeof ws !== "string") return ws;
      return wrap(
        deps,
        `/api/workspaces/${ws}/members/${encodeURIComponent(principal_id)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ role }),
        },
      );
    },
  );

  server.registerTool(
    "members_remove",
    {
      description:
        "Tool to remove a member. Caller must be owner. Do not use to change role. Side effects: write. Last owner removal is an error.",
      inputSchema: {
        principal_id: z.string(),
        workspace_id: z.string().optional(),
      },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ principal_id, workspace_id }) => {
      const ws = await workspaceId(deps, workspace_id);
      if (typeof ws !== "string") return ws;
      return wrap(
        deps,
        `/api/workspaces/${ws}/members/${encodeURIComponent(principal_id)}`,
        { method: "DELETE" },
      );
    },
  );

  server.registerTool(
    "project_create",
    {
      description:
        "Tool to create a project (optional parent_id). Use after session_briefing. Do not use to rename or reparent. Side effects: write.",
      inputSchema: {
        name: z.string(),
        parent_id: z.string().optional(),
        workspace_id: z.string().optional(),
      },
      annotations: WRITE,
    },
    async ({ name, parent_id, workspace_id }) => {
      const ws = await workspaceId(deps, workspace_id);
      if (typeof ws !== "string") return ws;
      return wrap(deps, `/api/workspaces/${ws}/projects`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: compactJson({ name, parent_id }),
      });
    },
  );

  server.registerTool(
    "project_rename",
    {
      description:
        "Tool to retitle a project. Use when project_id is known. Do not use to move it in the forest (project_reparent). Side effects: write.",
      inputSchema: {
        project_id: z.string(),
        name: z.string(),
      },
      annotations: WRITE,
    },
    async ({ project_id, name }) =>
      wrap(deps, `/api/projects/${project_id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      }),
  );

  server.registerTool(
    "project_reparent",
    {
      description:
        "Tool to set a project's parent_id (string or null for root). Use to place it in the forest. Do not use to rename. Side effects: write. Cycle or other-workspace parent is an error.",
      inputSchema: {
        project_id: z.string(),
        parent_id: z.union([z.string(), z.null()]),
      },
      annotations: WRITE,
    },
    async ({ project_id, parent_id }) =>
      wrap(deps, `/api/projects/${project_id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ parent_id }),
      }),
  );

  server.registerTool(
    "stages_replace",
    {
      description:
        "Tool to replace workspace stage labels and positions. Pass the full list; keys must stay backlog, doing, done. Do not invent keys. Side effects: write.",
      inputSchema: {
        stages: z.array(
          z.object({
            key: z.string(),
            label: z.string(),
            position: z.number(),
          }),
        ),
        workspace_id: z.string().optional(),
      },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ stages, workspace_id }) => {
      const ws = await workspaceId(deps, workspace_id);
      if (typeof ws !== "string") return ws;
      return wrap(deps, `/api/workspaces/${ws}/stages`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stages }),
      });
    },
  );
```

- [x] **Step 3: Run tools/list — pass**

Run: `node --test --experimental-strip-types src/worker/mcp.test.ts`

Expected: PASS (list matches; no behavior tests yet).

- [x] **Step 4: Commit**

```bash
git add src/worker/mcp.ts
git commit -m "feat: Config MCP tools wrap catalog HTTP"
```

---

### Task 5: Behavior tests

Files: `src/worker/mcp.test.ts` (append inside `describe("handleMcp")`).

`memberContext` farm membership is **member**. For owner-only tools, after context:

```ts
await catalog.updateMembershipRole(bundle.workspace.id, principal.id, "owner");
```

Second principal for add/remove: `mintSession(sessions)` (same store so `getPrincipal` hits).

- [x] **Step 1: Write these tests (and only these)**

`workspace_create returns org, workspace, root project; caller is owner`

```ts
  it("workspace_create returns org, workspace, root project; caller is owner", async () => {
    const { sessionId, sessions, catalog, wiki, principal } =
      await memberContext();
    const result = await toolResult(
      await handleMcp(
        callTool(sessionId, "workspace_create", { name: "Palm Engine" }),
        env,
        sessions,
        catalog,
        wiki,
      ),
    );
    assert.notEqual(result.isError, true);
    const payload = JSON.parse(result.content[0]?.text ?? "{}") as {
      organization: { name: string };
      workspace: { id: string; name: string };
      project: { name: string; parent_id: string | null };
    };
    assert.equal(payload.organization.name, "Palm Engine");
    assert.equal(payload.workspace.name, "Palm Engine");
    assert.equal(payload.project.name, "Palm Engine");
    assert.equal(payload.project.parent_id, null);
    const listed = await toolResult(
      await handleMcp(
        callTool(sessionId, "members_list", {
          workspace_id: payload.workspace.id,
        }),
        env,
        sessions,
        catalog,
        wiki,
      ),
    );
    const members = JSON.parse(listed.content[0]?.text ?? "{}") as {
      members: { principal_id: string; role: string }[];
    };
    assert.equal(members.members.length, 1);
    assert.equal(members.members[0]?.principal_id, principal.id);
    assert.equal(members.members[0]?.role, "owner");
  });
```

`members_add unknown principal_id is isError 400`

```ts
  it("members_add unknown principal_id is isError 400", async () => {
    const { sessionId, sessions, catalog, wiki } = await memberContext();
    const result = await toolResult(
      await handleMcp(
        callTool(sessionId, "members_add", { principal_id: "Gruber" }),
        env,
        sessions,
        catalog,
        wiki,
      ),
    );
    assert.equal(result.isError, true);
    const payload = JSON.parse(result.content[0]?.text ?? "{}") as {
      status: number;
      error: string;
    };
    assert.equal(payload.status, 400);
    assert.equal(payload.error, "bad_request");
  });
```

`members_add existing principal then members_list includes them`

```ts
  it("members_add existing principal then members_list includes them", async () => {
    const { sessionId, sessions, catalog, wiki, bundle } =
      await memberContext();
    const extra = await mintSession(sessions);
    const added = await toolResult(
      await handleMcp(
        callTool(sessionId, "members_add", {
          principal_id: extra.principal.id,
          role: "member",
        }),
        env,
        sessions,
        catalog,
        wiki,
      ),
    );
    assert.notEqual(added.isError, true);
    const payload = JSON.parse(added.content[0]?.text ?? "{}") as {
      member: { principal_id: string; role: string };
    };
    assert.equal(payload.member.principal_id, extra.principal.id);
    assert.equal(payload.member.role, "member");
    const listed = await toolResult(
      await handleMcp(
        callTool(sessionId, "members_list", {
          workspace_id: bundle.workspace.id,
        }),
        env,
        sessions,
        catalog,
        wiki,
      ),
    );
    const members = JSON.parse(listed.content[0]?.text ?? "{}") as {
      members: { principal_id: string }[];
    };
    assert.ok(
      members.members.some((row) => row.principal_id === extra.principal.id),
    );
  });
```

`members_set_role as member is isError 403`

```ts
  it("members_set_role as member is isError 403", async () => {
    const { sessionId, sessions, catalog, wiki, principal } =
      await memberContext();
    const result = await toolResult(
      await handleMcp(
        callTool(sessionId, "members_set_role", {
          principal_id: principal.id,
          role: "owner",
        }),
        env,
        sessions,
        catalog,
        wiki,
      ),
    );
    assert.equal(result.isError, true);
    const payload = JSON.parse(result.content[0]?.text ?? "{}") as {
      status: number;
    };
    assert.equal(payload.status, 403);
  });
```

`owner members_set_role and members_remove; last owner is 400`

```ts
  it("owner members_set_role and members_remove; last owner is 400", async () => {
    const { sessionId, sessions, catalog, wiki, bundle, principal } =
      await memberContext();
    await catalog.updateMembershipRole(
      bundle.workspace.id,
      principal.id,
      "owner",
    );
    const extra = await mintSession(sessions);
    const added = await toolResult(
      await handleMcp(
        callTool(sessionId, "members_add", {
          principal_id: extra.principal.id,
          role: "member",
        }),
        env,
        sessions,
        catalog,
        wiki,
      ),
    );
    assert.notEqual(added.isError, true);
    const promoted = await toolResult(
      await handleMcp(
        callTool(sessionId, "members_set_role", {
          principal_id: extra.principal.id,
          role: "owner",
        }),
        env,
        sessions,
        catalog,
        wiki,
      ),
    );
    assert.notEqual(promoted.isError, true);
    const removed = await toolResult(
      await handleMcp(
        callTool(sessionId, "members_remove", {
          principal_id: extra.principal.id,
        }),
        env,
        sessions,
        catalog,
        wiki,
      ),
    );
    assert.notEqual(removed.isError, true);
    const last = await toolResult(
      await handleMcp(
        callTool(sessionId, "members_remove", {
          principal_id: principal.id,
        }),
        env,
        sessions,
        catalog,
        wiki,
      ),
    );
    assert.equal(last.isError, true);
    const payload = JSON.parse(last.content[0]?.text ?? "{}") as {
      status: number;
      error: string;
    };
    assert.equal(payload.status, 400);
    assert.equal(payload.error, "last_owner");
  });
```

`project_create, project_rename, project_reparent` — create child of Farm, rename, cycle Farm under child (400 while child still points at Farm), then reparent child to null.

```ts
  it("project_create, project_rename, project_reparent", async () => {
    const { sessionId, sessions, catalog, wiki, bundle } =
      await memberContext();
    const created = await toolResult(
      await handleMcp(
        callTool(sessionId, "project_create", {
          name: "Keep",
          parent_id: bundle.project.id,
        }),
        env,
        sessions,
        catalog,
        wiki,
      ),
    );
    assert.notEqual(created.isError, true);
    const createdPayload = JSON.parse(created.content[0]?.text ?? "{}") as {
      project: { id: string; name: string; parent_id: string | null };
    };
    assert.equal(createdPayload.project.name, "Keep");
    assert.equal(createdPayload.project.parent_id, bundle.project.id);
    const renamed = await toolResult(
      await handleMcp(
        callTool(sessionId, "project_rename", {
          project_id: createdPayload.project.id,
          name: "Palm",
        }),
        env,
        sessions,
        catalog,
        wiki,
      ),
    );
    const renamedPayload = JSON.parse(renamed.content[0]?.text ?? "{}") as {
      project: { name: string };
    };
    assert.equal(renamedPayload.project.name, "Palm");
    const cycle = await toolResult(
      await handleMcp(
        callTool(sessionId, "project_reparent", {
          project_id: bundle.project.id,
          parent_id: createdPayload.project.id,
        }),
        env,
        sessions,
        catalog,
        wiki,
      ),
    );
    assert.equal(cycle.isError, true);
    const cyclePayload = JSON.parse(cycle.content[0]?.text ?? "{}") as {
      status: number;
    };
    assert.equal(cyclePayload.status, 400);
    const reparented = await toolResult(
      await handleMcp(
        callTool(sessionId, "project_reparent", {
          project_id: createdPayload.project.id,
          parent_id: null,
        }),
        env,
        sessions,
        catalog,
        wiki,
      ),
    );
    const reparentedPayload = JSON.parse(
      reparented.content[0]?.text ?? "{}",
    ) as { project: { parent_id: string | null } };
    assert.equal(reparentedPayload.project.parent_id, null);
  });
```

`stages_replace relabels; extra key is 400`

```ts
  it("stages_replace relabels; extra key is 400", async () => {
    const { sessionId, sessions, catalog, wiki } = await memberContext();
    const ok = await toolResult(
      await handleMcp(
        callTool(sessionId, "stages_replace", {
          stages: [
            { key: "backlog", label: "Inbox", position: 0 },
            { key: "doing", label: "Doing", position: 1 },
            { key: "done", label: "Done", position: 2 },
          ],
        }),
        env,
        sessions,
        catalog,
        wiki,
      ),
    );
    assert.notEqual(ok.isError, true);
    const payload = JSON.parse(ok.content[0]?.text ?? "{}") as {
      stages: { key: string; label: string }[];
    };
    const backlog = payload.stages.find((row) => row.key === "backlog");
    assert.equal(backlog?.label, "Inbox");
    const bad = await toolResult(
      await handleMcp(
        callTool(sessionId, "stages_replace", {
          stages: [
            { key: "backlog", label: "Inbox", position: 0 },
            { key: "doing", label: "Doing", position: 1 },
            { key: "done", label: "Done", position: 2 },
            { key: "blocked", label: "Blocked", position: 3 },
          ],
        }),
        env,
        sessions,
        catalog,
        wiki,
      ),
    );
    assert.equal(bad.isError, true);
    const err = JSON.parse(bad.content[0]?.text ?? "{}") as {
      status: number;
    };
    assert.equal(err.status, 400);
  });
```

- [x] **Step 2: Run**

Run: `node --test --experimental-strip-types src/worker/mcp.test.ts`

Expected: PASS.

- [x] **Step 3: `npm test`**

Expected: PASS.

- [x] **Step 4: Commit**

```bash
git add src/worker/mcp.test.ts
git commit -m "test: Config MCP members projects stages workspace_create"
```

---

### Task 6: Operator + implementer docs

Files: `.grok/skills/using-projthread/SKILL.md`, `docs/agent-facing.md`.

- [x] **Step 1: using-projthread** — after the “Chat is not here” line, replace the first-workspace-only sentence with:

```
A human may create the first workspace in the PWA. Agents maintain structure: `workspace_create`, `members_*`, `project_*`, `stages_replace`. `members_add` needs an existing `principal_id` (not a display name). Admin still vends sessions. This MCP does not mint principals.
```

- [x] **Step 2: agent-facing** — append:

```
Config MCP wraps catalog HTTP (`POST /api/organizations`, members GET/POST/PATCH/DELETE, projects POST, `PATCH /api/projects/:id`, `PATCH .../stages`). Do not wrap admin. Do not mint principals.
```

- [x] **Step 3: Commit**

```bash
git add .grok/skills/using-projthread/SKILL.md docs/agent-facing.md
git commit -m "docs: Config MCP is how agents maintain structure"
```

---

### Task 7: STATUS after landing

Files: `docs/STATUS.md`, `AGENTS.md`, `docs/superpowers/plans/2026-08-26-projthread-v1.md`, spec parked/PWA item 4.

- [x] **Live:** add Config MCP tools (workspace create, members list/add/role/remove, project create/rename/reparent, stages replace; wrap catalog HTTP; principal_id not display name).
- [x] **Now:** no open slice. Park Deploy. Do not start OAuth. Do not start room MCP. Do not drop remote D1 unless José asks.
- [x] **Next:** wait (Deploy parked).
- [x] **Parked:** Config MCP **shipped**.
- [x] **Landed plans:** append this file.
- [x] AGENTS **Now:** no open slice. Do not start OAuth. Do not start room MCP.
- [x] Index **Now:** no open slice. Config MCP (18) landed.
- [x] Spec item 4 **landed**. Parked briefing-pins: drop “Config MCP … stay later”.

```bash
git add docs/STATUS.md AGENTS.md docs/superpowers/plans/2026-08-26-projthread-v1.md docs/superpowers/specs/2026-08-26-projthread-v1-design.md
git commit -m "docs: Config MCP landed"
```

Stop.
