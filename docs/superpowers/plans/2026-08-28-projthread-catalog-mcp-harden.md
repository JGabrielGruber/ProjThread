# ProjThread Catalog MCP Harden Implementation Plan

> For Grok Build: one session, one slice. Compact after each task. Scout only if a file is not where this plan says. Do not add tests the plan did not ask for. Stop when STATUS is updated. Do not dispatch reviewer or superpowers:subagent-driven-development sub-agents.

**Goal:** Grok Bot can write wiki markdown without seeing it JSON-escaped, and can **compose** (include) and **cite** (ref) pages through `/mcp`. Same Worker, same Bearer wrap. No room.

**Architecture:** Keep `createMcpHandler` + HTTP wrap. Node tools (`get_node`, `create_node`, `update_node`, plus the new compose/cite tools) return markdown as `content[0].text` (raw string after JSON-RPC parse) and the existing GET JSON as `content[1].text`. New tools wrap `POST /api/nodes/:id/includes` and `POST /api/nodes/:id/refs` only. Do not reimplement cycle checks or D1.

**Tech Stack:** Existing Worker, `src/worker/mcp.ts` / `mcp.test.ts`, `node --test --experimental-strip-types`. No new deps, no bindings, no PWA, no wiki-http edits.

---

## Locked calls (do not re-litigate)

| Topic | Call |
| --- | --- |
| Escape | After `JSON.parse` of the MCP JSON-RPC body, `result.content[0].text` **is** the node markdown (newlines and quotes as characters, not `\\n` / `\\\"`). Envelope JSON stays in `content[1].text`. Errors stay a single JSON text part (`isError: true`). |
| Which tools | `get_node`, `create_node`, `update_node`, `compose_node`, `cite_node` use that two-part shape (parent `node.content` is the markdown part). Other tools stay one JSON text part. |
| `compose_node` | Wraps `POST /api/nodes/:node_id/includes` `{ child_id, position? }`. Args: `node_id`, `child_id`, optional integer `position`. |
| `cite_node` | Wraps `POST /api/nodes/:node_id/refs` `{ to_id }`. Args: `node_id`, `to_id`. Do not send `position`. |
| HTTP | Membership, cycle-on-includes, same-workspace, 201/200/400 stay in `handleWiki`. MCP maps 4xx to `isError: true`. |
| Names | Product language: compose = includes, cite = ref. Tool names `compose_node` and `cite_node`. |
| Room / OAuth / PWA | Out. Attach stays `attach_node_work_item`. Create node still has no include/ref in the same write. |

### Tool set after this slice (fifteen)

Plan 11 thirteen, plus:

| Tool | Wraps |
| --- | --- |
| `compose_node` | `POST /api/nodes/:id/includes` |
| `cite_node` | `POST /api/nodes/:id/refs` |

---

## File map

- `docs/superpowers/plans/2026-08-28-projthread-catalog-mcp-harden.md` — this plan
- `src/worker/mcp.test.ts` — markdown round-trip; compose ≠ cite; cycle `isError`; `tools/list` fifteen names; existing `create_node` test reads `content[1]`
- `src/worker/mcp.ts` — `wrap(..., "node")` two-part result; two tools
- docs after landing — STATUS, AGENTS, spec parked catalog MCP, v1 index

Do not modify `src/worker/wiki-http.ts`, `src/worker/wiki.ts`, `src/worker/catalog-http.ts`, `src/room/*`, `src/app/*`, `src/admin/*`, migrations, `wrangler.jsonc`, `package.json`.

---

## Out of this slice (explicit)

| Deferred | Why |
| --- | --- |
| OAuth / distinct agent tokens | Absence. |
| Room / WS tools | Cookie-only tape. Named absence. |
| Members, project create, stage replace | Config, not this leftover. |
| DELETE include/ref | Plan 9 left unlink out. |
| PWA outline chrome | Parked. |
| `structuredContent` / SDK extras | Two text parts are enough; do not add deps. |
| Deploy | Parked on custom domain. |

---

## STATUS.md after this slice

**Live:** … + `/mcp` node tools return raw markdown in `content[0]`; `compose_node` + `cite_node`.
**Now:** no open slice. Park Deploy until a custom domain exists. Do not start OAuth. Do not start room MCP.
**Next:** when a domain exists, write the Deploy plan. Until then, wait.
**Parked (product):** PWA outline / attachment chrome. Distinct agent OAuth tokens. Room MCP.

---

### Task 1: Maps

Files: this plan, `docs/STATUS.md`, `AGENTS.md`, `docs/superpowers/plans/2026-08-26-projthread-v1.md`, spec parked catalog MCP.

- [x] STATUS **Now:** execute this plan. Do not implement Deploy. Do not start OAuth. Do not start room MCP.
- [x] AGENTS **Now:** catalog-mcp-harden plan (see STATUS).
- [x] Index plan **12** row: `2026-08-28-projthread-catalog-mcp-harden.md`.
- [x] Spec **Parked: catalog MCP** — plan 12 is markdown text + compose/cite tools; OAuth and room MCP stay absences.

---

### Task 2: Failing tests

Files: modify `src/worker/mcp.test.ts`.

- [x] **Step 1: Extend `TOOL_NAMES`**

```ts
const TOOL_NAMES = [
  "me",
  "list_projects",
  "list_stages",
  "list_work_items",
  "get_work_item",
  "create_work_item",
  "update_work_item_title",
  "move_work_item",
  "list_nodes",
  "get_node",
  "create_node",
  "update_node",
  "attach_node_work_item",
  "compose_node",
  "cite_node",
] as const;
```

- [x] **Step 2: Change the existing `create_node` assertion** so `content[0].text` is the markdown and the JSON envelope is `content[1]`.

Replace the parse of `content[0]` with:

```ts
    assert.notEqual(body.result?.isError, true);
    assert.equal(body.result?.content?.[0]?.text, "Twice daily.");
    const payload = JSON.parse(body.result?.content?.[1]?.text ?? "{}") as {
      node: { title: string; workspace_id: string; content: string };
    };
    assert.equal(payload.node.title, "Feed schedule");
    assert.equal(payload.node.workspace_id, bundle.workspace.id);
    assert.equal(payload.node.content, "Twice daily.");
```

- [x] **Step 3: Add three tests** after that case (same `describe("handleMcp")`).

```ts
  it("create_node content[0] is unescaped markdown", async () => {
    const markdown = 'Hay twice.\n\nSay "ready".';
    const { sessionId, sessions, catalog, wiki, bundle } =
      await memberContext();
    const res = await handleMcp(
      postMcp(
        { authorization: `Bearer ${sessionId}` },
        "tools/call",
        {
          name: "create_node",
          arguments: {
            workspace_id: bundle.workspace.id,
            title: "Feed",
            content: markdown,
          },
        },
        "create_node",
      ),
      env,
      sessions,
      catalog,
      wiki,
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      result?: { content?: { type: string; text: string }[]; isError?: boolean };
    };
    assert.notEqual(body.result?.isError, true);
    assert.equal(body.result?.content?.[0]?.text, markdown);
    assert.equal(body.result?.content?.[0]?.text.includes("\\n"), false);
    const stored = JSON.parse(body.result?.content?.[1]?.text ?? "{}") as {
      node: { id: string; content: string };
    };
    assert.equal(stored.node.content, markdown);
    const got = await handleMcp(
      postMcp(
        { authorization: `Bearer ${sessionId}` },
        "tools/call",
        { name: "get_node", arguments: { node_id: stored.node.id } },
        "get_node",
      ),
      env,
      sessions,
      catalog,
      wiki,
    );
    const gotBody = (await got.json()) as {
      result?: { content?: { type: string; text: string }[] };
    };
    assert.equal(gotBody.result?.content?.[0]?.text, markdown);
  });

  it("compose_node includes without citing; cite_node cites without including", async () => {
    const { sessionId, sessions, catalog, wiki, bundle } =
      await memberContext();

    async function create(title: string, content: string) {
      const res = await handleMcp(
        postMcp(
          { authorization: `Bearer ${sessionId}` },
          "tools/call",
          {
            name: "create_node",
            arguments: {
              workspace_id: bundle.workspace.id,
              title,
              content,
            },
          },
          "create_node",
        ),
        env,
        sessions,
        catalog,
        wiki,
      );
      const body = (await res.json()) as {
        result?: { content?: { text: string }[] };
      };
      return JSON.parse(body.result?.content?.[1]?.text ?? "{}") as {
        node: { id: string };
      };
    }

    const parent = await create("Plan", "Parent body");
    const child = await create("Requirements", "Child body");
    const other = await create("Other plan", "Cite me");

    const composed = await handleMcp(
      postMcp(
        { authorization: `Bearer ${sessionId}` },
        "tools/call",
        {
          name: "compose_node",
          arguments: {
            node_id: parent.node.id,
            child_id: child.node.id,
          },
        },
        "compose_node",
      ),
      env,
      sessions,
      catalog,
      wiki,
    );
    assert.equal(composed.status, 200);
    const composedBody = (await composed.json()) as {
      result?: { content?: { text: string }[]; isError?: boolean };
    };
    assert.notEqual(composedBody.result?.isError, true);
    assert.equal(composedBody.result?.content?.[0]?.text, "Parent body");
    const composedPayload = JSON.parse(
      composedBody.result?.content?.[1]?.text ?? "{}",
    ) as {
      includes: { id: string }[];
      refs: { id: string }[];
    };
    assert.equal(composedPayload.includes[0]?.id, child.node.id);
    assert.equal(composedPayload.refs.length, 0);

    const cited = await handleMcp(
      postMcp(
        { authorization: `Bearer ${sessionId}` },
        "tools/call",
        {
          name: "cite_node",
          arguments: { node_id: parent.node.id, to_id: other.node.id },
        },
        "cite_node",
      ),
      env,
      sessions,
      catalog,
      wiki,
    );
    const citedBody = (await cited.json()) as {
      result?: { content?: { text: string }[]; isError?: boolean };
    };
    assert.notEqual(citedBody.result?.isError, true);
    const citedPayload = JSON.parse(
      citedBody.result?.content?.[1]?.text ?? "{}",
    ) as {
      includes: { id: string }[];
      refs: { id: string }[];
    };
    assert.equal(citedPayload.refs[0]?.id, other.node.id);
    assert.equal(citedPayload.includes.length, 1);
    assert.equal(citedPayload.includes[0]?.id, child.node.id);
  });

  it("compose_node cycle is isError", async () => {
    const { sessionId, sessions, catalog, wiki, bundle } =
      await memberContext();

    async function create(title: string) {
      const res = await handleMcp(
        postMcp(
          { authorization: `Bearer ${sessionId}` },
          "tools/call",
          {
            name: "create_node",
            arguments: { workspace_id: bundle.workspace.id, title },
          },
          "create_node",
        ),
        env,
        sessions,
        catalog,
        wiki,
      );
      const body = (await res.json()) as {
        result?: { content?: { text: string }[] };
      };
      return JSON.parse(body.result?.content?.[1]?.text ?? "{}") as {
        node: { id: string };
      };
    }

    const a = await create("A");
    const b = await create("B");
    await handleMcp(
      postMcp(
        { authorization: `Bearer ${sessionId}` },
        "tools/call",
        {
          name: "compose_node",
          arguments: { node_id: a.node.id, child_id: b.node.id },
        },
        "compose_node",
      ),
      env,
      sessions,
      catalog,
      wiki,
    );
    const cycle = await handleMcp(
      postMcp(
        { authorization: `Bearer ${sessionId}` },
        "tools/call",
        {
          name: "compose_node",
          arguments: { node_id: b.node.id, child_id: a.node.id },
        },
        "compose_node",
      ),
      env,
      sessions,
      catalog,
      wiki,
    );
    const cycleBody = (await cycle.json()) as {
      result?: { isError?: boolean };
    };
    assert.equal(cycleBody.result?.isError, true);
  });
```

- [x] **Step 4: Run tests (expect fail)**

Run: `node --test --experimental-strip-types src/worker/mcp.test.ts`

Expected: `tools/list` fails (missing `compose_node` / `cite_node`); `create_node` envelope parse fails; new tests fail on missing tools or still-JSON `content[0]`.

---

### Task 3: Implement

Files: modify `src/worker/mcp.ts` only.

- [x] **Step 1: Two-part node wrap**

Change `wrap` to take a mode. Keep error shape (one JSON text part).

```ts
async function wrap(
  deps: Deps,
  path: string,
  init: RequestInit = {},
  mode: "json" | "node" = "json",
): Promise<{
  content: { type: "text"; text: string }[];
  isError?: true;
}> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${deps.sessionId}`);
  const request = new Request(`http://mcp.internal${path}`, { ...init, headers });
  const url = new URL(request.url);
  let res: Response;
  if (url.pathname === "/api/me") {
    res = await handleMe(request, deps.env, deps.sessions, deps.catalog);
  } else if (
    url.pathname.startsWith("/api/nodes") ||
    /^\/api\/workspaces\/[^/]+\/nodes$/.test(url.pathname)
  ) {
    res = await handleWiki(
      request,
      deps.env,
      deps.sessions,
      deps.catalog,
      deps.wiki,
    );
  } else {
    res = await handleCatalog(request, deps.env, deps.sessions, deps.catalog);
  }
  const text = await res.text();
  if (!res.ok) {
    return {
      isError: true,
      content: [{ type: "text", text: errorText(res.status, text) }],
    };
  }
  if (mode === "node") return nodeToolResult(text);
  return { content: [{ type: "text", text: text || "{}" }] };
}

function nodeToolResult(text: string): {
  content: { type: "text"; text: string }[];
} {
  let parsed: { node?: { content?: unknown } };
  try {
    parsed = JSON.parse(text) as { node?: { content?: unknown } };
  } catch {
    return { content: [{ type: "text", text: text || "{}" }] };
  }
  const markdown =
    typeof parsed.node?.content === "string" ? parsed.node.content : "";
  return {
    content: [
      { type: "text", text: markdown },
      { type: "text", text: text || "{}" },
    ],
  };
}
```

- [x] **Step 2: Pass `"node"` from node tools**

`get_node`, `create_node`, `update_node`: last arg `"node"`.

Example:

```ts
    async ({ node_id }) => wrap(deps, `/api/nodes/${node_id}`, {}, "node"),
```

```ts
    async ({ workspace_id, title, type, summary, content, work_item_id }) =>
      wrap(
        deps,
        `/api/workspaces/${workspace_id}/nodes`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: compactJson({ title, type, summary, content, work_item_id }),
        },
        "node",
      ),
```

Same for `update_node` PATCH.

- [x] **Step 3: Register compose and cite** (before `return server`)

```ts
  server.registerTool(
    "compose_node",
    {
      description:
        "Compose: include a wiki node as an ordered child (not a citation)",
      inputSchema: {
        node_id: z.string(),
        child_id: z.string(),
        position: z.number().int().optional(),
      },
    },
    async ({ node_id, child_id, position }) =>
      wrap(
        deps,
        `/api/nodes/${node_id}/includes`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: compactJson({ child_id, position }),
        },
        "node",
      ),
  );

  server.registerTool(
    "cite_node",
    {
      description: "Cite another wiki node (not an include)",
      inputSchema: {
        node_id: z.string(),
        to_id: z.string(),
      },
    },
    async ({ node_id, to_id }) =>
      wrap(
        deps,
        `/api/nodes/${node_id}/refs`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ to_id }),
        },
        "node",
      ),
  );
```

- [x] **Step 4: Re-run**

Run: `node --test --experimental-strip-types src/worker/mcp.test.ts` then `npm test`

Expected: mcp tests pass; full suite green (do not add tests).

---

### Task 4: Docs after green

- [x] STATUS Live/Now/Next/Parked as in this plan. Landed plans include this file.
- [x] AGENTS: `/mcp` node markdown is `content[0]`; compose/cite tools live; OAuth and room MCP still absences. **Now:** no open slice.
- [x] Spec **Parked: catalog MCP** — two-part node results; `compose_node` / `cite_node`. OAuth and room MCP stay absences.
- [x] Index **Now:** plan 12 landed. Park plan 8. Do not start OAuth.
