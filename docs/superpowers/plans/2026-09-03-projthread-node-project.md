# ProjThread node_project write — implementation plan

> For Grok Build: one session, one slice. Compact after each task. Scout only if a file is not where this plan says. Do not add tests the plan did not ask for. Stop when STATUS is updated. Do not dispatch reviewer or superpowers:subagent-driven-development sub-agents. Do not start OAuth. Do not start room MCP. Do not bind Queues or R2. Do not build the capture extension. Do not notify. Do not start slices 21–24.

**Goal:** Point a wiki node at a project without attaching a card: `POST /api/nodes/:id/projects` `{ project_id }` (idempotent), `GET` node includes `project_ids`, MCP wrap.

**Architecture:** Table `node_project` already exists (migration `0004`; rebuilt in `0008`). Mirror `linkNodeWorkItem` / `POST .../work-items`. No new columns. List `?project_id=` already reads the table. PWA stays the read-filter; extra GET keys are ignored.

**Tech Stack:** Existing Worker + D1 + `/mcp` façade. `node --test --experimental-strip-types`. No new deps, no bindings, no migration.

Spec: `docs/superpowers/specs/2026-09-03-projthread-capture-design.md` slice **20**.

---

## Locked calls (do not re-litigate)

| Topic | Call |
| --- | --- |
| Table | Existing `node_project (node_id, project_id)` composite PK. No schema change. |
| POST | `POST /api/nodes/:id/projects` `{ project_id }`. New **201**. Same pair again **200**. Payload = GET node (includes `project_ids`). |
| GET node | `{ node, work_item_ids, project_ids, includes, refs }`. `project_ids: string[]` sorted. List workspace nodes still omits `project_ids` and `content`. |
| Same workspace | `catalog.getProject(project_id)` must exist and `workspace_id` match the node. Else **400** `{ error: "bad_request" }`. Missing / empty / non-string `project_id` **400**. |
| Auth | Same as wiki. No cookie **401**; outsider **403**; missing node **404**. |
| Idempotent | `INSERT OR IGNORE`. One row per pair. M2M: a node may have many projects; a project many nodes. |
| Independence | Project attach must not write `node_work_item` or `node_rel`. Card attach / include / ref must not write `node_project`. |
| Create body | Do **not** add `project_id` on `POST .../nodes` or `wiki_create`. Two writes: create, then attach. (`work_item_id` on create stays.) |
| DELETE / unlink | Out. |
| Reverse list | No `GET /api/projects/:id/nodes`. Wiki list `?project_id=` is enough. |
| PWA | **Out.** Filter already reads `node_project`. Do not add a project picker on wiki. Do not edit `src/app/*`. |
| MCP | New `attach_node_project` wrapping POST (same json wrap as `attach_node_work_item`, not node envelope). `wiki_read` envelope picks up `project_ids` for free. |
| Bindings | `wrangler.jsonc` unchanged. No migration. |
| Out | Notify, Queues, R2, extension, share target, inbox, Vectorize, blob writes. |

---

## File map

| Path | Job |
| --- | --- |
| `src/worker/wiki.ts` | `linkNodeProject` on `WikiStore`; D1 + memory. |
| `src/worker/wiki.test.ts` | Insert/exists; independence from include/ref/card attach. |
| `src/worker/wiki-http.ts` | Route `projects`; `nodeResponse` adds `project_ids`; `linkProject`. |
| `src/worker/wiki-http.test.ts` | Contract HTTP + filter without a card. |
| `src/worker/mcp.ts` | `attach_node_project`. |
| `src/worker/mcp.test.ts` | Tool list + attach + `wiki_read` envelope. |
| `docs/agent-facing.md` | One line: wrap exists. |
| `.grok/skills/using-projthread/SKILL.md` | Operators may point a node at a project without a card. |
| `docs/STATUS.md`, index, AGENTS, capture spec line 42 | After tests pass. |

Do not modify `catalog.ts`, room, wrangler, migrations, `src/app/*`, `wiki-json.ts`.

---

### Task 1: Store write

**Files:** modify `src/worker/wiki.ts`, `src/worker/wiki.test.ts`.

- [ ] **Step 1: Failing tests**

Add after `linkNodeWorkItem is inserted then exists with one id` in `src/worker/wiki.test.ts`:

```ts
  it("linkNodeProject is inserted then exists with one id", async () => {
    const wiki = memoryWikiStore();
    await wiki.insertNode(farmNote());

    assert.equal(await wiki.linkNodeProject("n1", "proj-farm"), "inserted");
    assert.deepEqual(await wiki.listNodeProjectIds("n1"), ["proj-farm"]);

    assert.equal(await wiki.linkNodeProject("n1", "proj-farm"), "exists");
    assert.deepEqual(await wiki.listNodeProjectIds("n1"), ["proj-farm"]);
  });
```

In `include, ref, and attach stay independent`, after `linkNodeWorkItem("n2", "wi-1")` assertions, add:

```ts
    assert.equal(await wiki.linkNodeProject("n1", "proj-farm"), "inserted");
    assert.deepEqual(await wiki.listNodeProjectIds("n1"), ["proj-farm"]);
    assert.deepEqual(await wiki.listNodeProjectIds("n2"), []);
    assert.deepEqual(await wiki.listNodeWorkItemIds("n1"), []);
    assert.deepEqual(await wiki.listNodeWorkItemIds("n2"), ["wi-1"]);
    assert.equal((await wiki.listIncludes("n1")).length, 1);
```

- [ ] **Step 2: Run** `node --test --experimental-strip-types src/worker/wiki.test.ts` — fail (`linkNodeProject` missing).

- [ ] **Step 3: Implement** on `WikiStore`:

```ts
  linkNodeProject(
    nodeId: string,
    projectId: string,
  ): Promise<"inserted" | "exists">;
```

D1 (next to `linkNodeWorkItem`):

```ts
    async linkNodeProject(nodeId, projectId) {
      const row = await db
        .prepare(
          "INSERT OR IGNORE INTO node_project (node_id, project_id) VALUES (?, ?) RETURNING node_id",
        )
        .bind(nodeId, projectId)
        .first<{ node_id: string }>();
      return row != null ? "inserted" : "exists";
    },
```

Memory (map `nodeProjects` already exists):

```ts
    async linkNodeProject(nodeId, projectId) {
      const key = `${nodeId}:${projectId}`;
      if (nodeProjects.has(key)) return "exists";
      nodeProjects.set(key, { node_id: nodeId, project_id: projectId });
      return "inserted";
    },
```

- [ ] **Step 4: Re-run** — pass.

- [ ] **Step 5: Commit** `feat: wiki store linkNodeProject`

---

### Task 2: HTTP

**Files:** modify `src/worker/wiki-http.ts`, `src/worker/wiki-http.test.ts`.

- [ ] **Step 1: Failing tests**

Append inside `describe("handleWiki"` (after the work-items 201/200 case is the right neighborhood):

```ts
  it("POST projects is 201 then 200 with one id", async () => {
    const { cookie, catalog, wiki, bundle, sessions } = await memberContext();
    const created = await handleWiki(
      new Request(`${ORIGIN}/api/workspaces/${bundle.workspace.id}/nodes`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ title: "Report" }),
      }),
      env,
      sessions,
      catalog,
      wiki,
    );
    const { node } = (await created.json()) as { node: { id: string } };

    const first = await handleWiki(
      new Request(`${ORIGIN}/api/nodes/${node.id}/projects`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ project_id: bundle.project.id }),
      }),
      env,
      sessions,
      catalog,
      wiki,
    );
    assert.equal(first.status, 201);

    const second = await handleWiki(
      new Request(`${ORIGIN}/api/nodes/${node.id}/projects`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ project_id: bundle.project.id }),
      }),
      env,
      sessions,
      catalog,
      wiki,
    );
    assert.equal(second.status, 200);
    const body = (await second.json()) as {
      project_ids: string[];
      work_item_ids: string[];
    };
    assert.deepEqual(body.project_ids, [bundle.project.id]);
    assert.deepEqual(body.work_item_ids, []);
  });

  it("POST projects foreign workspace is 400", async () => {
    const { cookie, catalog, wiki, bundle, sessions } = await memberContext();
    catalog.seedProject({
      id: "proj-other",
      workspace_id: "ws-other",
      organization_id: bundle.organization.id,
      parent_id: null,
      name: "Other",
      created_at: "2026-01-01T00:00:00.000Z",
    });
    const created = await handleWiki(
      new Request(`${ORIGIN}/api/workspaces/${bundle.workspace.id}/nodes`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ title: "Report" }),
      }),
      env,
      sessions,
      catalog,
      wiki,
    );
    const { node } = (await created.json()) as { node: { id: string } };
    const res = await handleWiki(
      new Request(`${ORIGIN}/api/nodes/${node.id}/projects`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ project_id: "proj-other" }),
      }),
      env,
      sessions,
      catalog,
      wiki,
    );
    assert.equal(res.status, 400);
  });

  it("GET nodes ?project_id= matches node_project without a card", async () => {
    const { cookie, catalog, wiki, bundle, sessions } = await memberContext();
    const created = await handleWiki(
      new Request(`${ORIGIN}/api/workspaces/${bundle.workspace.id}/nodes`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ title: "Pointed" }),
      }),
      env,
      sessions,
      catalog,
      wiki,
    );
    const { node } = (await created.json()) as { node: { id: string } };
    const linked = await handleWiki(
      new Request(`${ORIGIN}/api/nodes/${node.id}/projects`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ project_id: bundle.project.id }),
      }),
      env,
      sessions,
      catalog,
      wiki,
    );
    assert.equal(linked.status, 201);

    const filtered = await handleWiki(
      new Request(
        `${ORIGIN}/api/workspaces/${bundle.workspace.id}/nodes?project_id=${bundle.project.id}`,
        { headers: { cookie } },
      ),
      env,
      sessions,
      catalog,
      wiki,
    );
    const body = (await filtered.json()) as { nodes: { title: string }[] };
    assert.ok(body.nodes.some((n) => n.title === "Pointed"));
    assert.equal("project_ids" in (body.nodes[0] ?? {}), false);
  });
```

In existing `GET node has content and empty work_item_ids`, add `project_ids` to the typed body and:

```ts
    assert.deepEqual(body.project_ids, []);
```

- [ ] **Step 2: Run** `node --test --experimental-strip-types src/worker/wiki-http.test.ts` — fail (404 on `/projects`; GET missing `project_ids`).

- [ ] **Step 3: Implement**

`matchNodePath` tail union includes `"projects"`:

```ts
): { id: string; tail: "work-items" | "includes" | "refs" | "projects" | null } | null {
```

Allow `tail === "projects"` in the guard. Dispatch next to work-items:

```ts
    if (nodePath.tail === "projects" && request.method === "POST") {
      return linkProject(request, catalog, wiki, node);
    }
```

```ts
async function linkProject(
  request: Request,
  catalog: CatalogStore,
  wiki: WikiStore,
  node: NodeRow,
): Promise<Response> {
  const body = await readJson(request);
  if (!isRecord(body) || typeof body.project_id !== "string" || body.project_id === "") {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  const project = await catalog.getProject(body.project_id);
  if (!project || project.workspace_id !== node.workspace_id) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  const result = await wiki.linkNodeProject(node.id, body.project_id);
  return nodeResponse(wiki, node, result === "inserted" ? 201 : 200);
}
```

`nodeResponse`:

```ts
  const [work_item_ids, project_ids, includes, refs] = await Promise.all([
    wiki.listNodeWorkItemIds(node.id),
    wiki.listNodeProjectIds(node.id),
    wiki.listIncludes(node.id),
    wiki.listRefs(node.id),
  ]);
  return Response.json(
    { node, work_item_ids, project_ids, includes, refs },
    { status },
  );
```

- [ ] **Step 4: Re-run** wiki-http tests — pass. Then `npm test` — existing GET tests that only assert `work_item_ids` still pass; the one you edited requires empty `project_ids`.

- [ ] **Step 5: Commit** `feat: POST node_project attach`

---

### Task 3: MCP wrap

**Files:** modify `src/worker/mcp.ts`, `src/worker/mcp.test.ts`.

- [ ] **Step 1: Failing tests**

In `TOOL_NAMES`, after `"attach_node_work_item"`, add `"attach_node_project"`.

Add:

```ts
  it("attach_node_project points a node without a card", async () => {
    const { sessionId, sessions, catalog, wiki, bundle } =
      await memberContext();
    const created = await toolResult(
      await handleMcp(
        callTool(sessionId, "wiki_create", { title: "Report" }),
        env,
        sessions,
        catalog,
        wiki,
      ),
    );
    const createdBody = JSON.parse(created.content[1]?.text ?? "{}") as {
      node: { id: string };
    };
    const first = await toolResult(
      await handleMcp(
        callTool(sessionId, "attach_node_project", {
          node_id: createdBody.node.id,
          project_id: bundle.project.id,
        }),
        env,
        sessions,
        catalog,
        wiki,
      ),
    );
    assert.notEqual(first.isError, true);
    const firstJson = JSON.parse(first.content[0]?.text ?? "{}") as {
      project_ids: string[];
      work_item_ids: string[];
    };
    assert.deepEqual(firstJson.project_ids, [bundle.project.id]);
    assert.deepEqual(firstJson.work_item_ids, []);

    const second = await toolResult(
      await handleMcp(
        callTool(sessionId, "attach_node_project", {
          node_id: createdBody.node.id,
          project_id: bundle.project.id,
        }),
        env,
        sessions,
        catalog,
        wiki,
      ),
    );
    assert.notEqual(second.isError, true);

    const read = await toolResult(
      await handleMcp(
        callTool(sessionId, "wiki_read", { node_id: createdBody.node.id }),
        env,
        sessions,
        catalog,
        wiki,
      ),
    );
    const envelope = JSON.parse(read.content[1]?.text ?? "{}") as {
      project_ids: string[];
      node: { content?: string };
    };
    assert.deepEqual(envelope.project_ids, [bundle.project.id]);
    assert.equal(envelope.node.content, undefined);
  });
```

- [ ] **Step 2: Run** `node --test --experimental-strip-types src/worker/mcp.test.ts` — fail (`tools/list` missing name; attach unknown).

- [ ] **Step 3: Implement** in `src/worker/mcp.ts` immediately after `attach_node_work_item`:

```ts
  server.registerTool(
    "attach_node_project",
    {
      description:
        "Tool to point a wiki node at a project (not a card). Side effects: write.",
      inputSchema: {
        node_id: z.string(),
        project_id: z.string(),
      },
      annotations: WRITE,
    },
    async ({ node_id, project_id }) =>
      wrap(deps, `/api/nodes/${node_id}/projects`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ project_id }),
      }),
  );
```

Do not add `project_id` to `wiki_create`. Do not change wrap routing: `/api/nodes/...` already hits `handleWiki`.

- [ ] **Step 4: Re-run** mcp tests — pass. `npm test` — all pass.

- [ ] **Step 5: Commit** `feat: mcp attach_node_project`

---

### Task 4: Docs and STATUS

**Files:** `docs/STATUS.md`, `docs/superpowers/plans/2026-08-26-projthread-v1.md`, `AGENTS.md`, `docs/superpowers/specs/2026-09-03-projthread-capture-design.md` (line 42: write HTTP **shipped**), `docs/agent-facing.md`, `.grok/skills/using-projthread/SKILL.md`.

- [ ] **Step 1:** STATUS **Live:** wiki … + `node_project` write (`POST /api/nodes/:id/projects`; GET `project_ids`; MCP `attach_node_project`; PWA still filter-only). **Now:** no open slice. Do not start 21–24. Do not bind Queues or R2. **Plan:** none. **Next:** write plan **21** notify (not written). Landed plans include this file.

- [ ] **Step 2:** Index: plan **20** row landed. **Now:** no open slice. Next named 21–24 stay unwritten.

- [ ] **Step 3:** Capture spec report-graph bullet: table exists; **write HTTP shipped** (PWA filter-only).

- [ ] **Step 4:** `docs/agent-facing.md`: still wrap; `attach_node_project` wraps `POST /api/nodes/:id/projects`.

- [ ] **Step 5:** using-projthread: after search/read, agents may `attach_node_project` so a report is pointed at a project without filing a card. Cards stay `attach_node_work_item`.

- [ ] **Step 6:** `npm test` — still pass. No wrangler migrate. No remote D1. No deploy unless José asks.

- [ ] **Step 7: Commit** `docs: node_project write landed`

---

## Out of this slice (explicit)

| Deferred | Why |
| --- | --- |
| PWA project attach UI | Spec: filter-only. Extension/share-target pick the project. |
| `project_id` on `wiki_create` | Two writes. Do not grow create. |
| DELETE unlink | Not needed for capture. |
| Notify / Queues | Slice 21. |
| R2 / blob | Slice 22. |
| Extension / share target | 23 / 24. |
| Remote `0008` / deploy | Ops; José asks. |

## Success

A report node can be pointed at `proj-farm` with no `node_work_item` row. Wiki list `?project_id=` returns it. Grok Bot can `attach_node_project` after `wiki_create`. The board does not gain a dump card.
