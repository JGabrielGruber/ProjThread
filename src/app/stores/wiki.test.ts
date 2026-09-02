import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createPinia, setActivePinia } from "pinia";
import { useWikiStore } from "./wiki.ts";

describe("wiki store", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("loadList GETs workspace nodes with credentials", async () => {
    const calls: { url: string; credentials: RequestCredentials | undefined }[] =
      [];
    globalThis.fetch = async (input, init) => {
      calls.push({
        url: String(input),
        credentials: init?.credentials,
      });
      return Response.json({
        nodes: [
          {
            id: "n1",
            workspace_id: "ws1",
            type: "note",
            payload_kind: "markdown",
            title: "Egg",
            summary: null,
            created_at: "2026-01-01T00:00:00.000Z",
            updated_at: "2026-01-01T00:00:00.000Z",
            pinned: 0,
          },
        ],
      });
    };
    const store = useWikiStore();
    await store.loadList("ws1");
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, "/api/workspaces/ws1/nodes");
    assert.equal(calls[0]?.credentials, "include");
    assert.equal(store.nodes[0]?.title, "Egg");
  });

  it("second loadList while in-flight does not double-fetch", async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    globalThis.fetch = async () => {
      calls += 1;
      await gate;
      return Response.json({ nodes: [] });
    };
    const store = useWikiStore();
    const first = store.loadList("ws1");
    const second = store.loadList("ws1");
    release();
    await Promise.all([first, second]);
    assert.equal(calls, 1);
  });

  it("401 => status no_session", async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
    const store = useWikiStore();
    await store.loadList("ws1");
    assert.equal(store.status, "no_session");
  });

  it("createNode POSTs title and content", async () => {
    const posts: { url: string; body: unknown }[] = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url === "/api/workspaces/ws1/nodes" && method === "GET") {
        return Response.json({ nodes: [] });
      }
      if (url === "/api/workspaces/ws1/nodes" && method === "POST") {
        posts.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
        return Response.json(
          {
            node: {
              id: "n1",
              workspace_id: "ws1",
              organization_id: "o1",
              type: "note",
              payload_kind: "markdown",
              title: "Egg",
              summary: null,
              content: "# Hi",
              created_at: "2026-01-01T00:00:00.000Z",
              updated_at: "2026-01-01T00:00:00.000Z",
            },
            work_item_ids: [],
          },
          { status: 201 },
        );
      }
      throw new Error(`unexpected fetch ${method} ${url}`);
    };
    const store = useWikiStore();
    await store.loadList("ws1");
    await store.createNode({ title: "Egg", content: "# Hi" });
    assert.equal(posts.length, 1);
    assert.equal(posts[0]?.url, "/api/workspaces/ws1/nodes");
    assert.deepEqual(posts[0]?.body, { title: "Egg", content: "# Hi" });
  });

  it("openNode GETs node and sets content", async () => {
    const urls: string[] = [];
    globalThis.fetch = async (input) => {
      const url = String(input);
      urls.push(url);
      return Response.json({
        node: {
          id: "n1",
          workspace_id: "ws1",
          organization_id: "o1",
          type: "note",
          payload_kind: "markdown",
          title: "Egg",
          summary: null,
          content: "# Hi",
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        },
        work_item_ids: [],
      });
    };
    const store = useWikiStore();
    await store.openNode("n1");
    assert.equal(urls[0], "/api/nodes/n1");
    assert.equal(store.node?.content, "# Hi");
  });

  it("linkWorkItem POSTs work_item_id", async () => {
    const posts: { url: string; body: unknown }[] = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url === "/api/nodes/n1" && method === "GET") {
        return Response.json({
          node: {
            id: "n1",
            workspace_id: "ws1",
            organization_id: "o1",
            type: "note",
            payload_kind: "markdown",
            title: "Egg",
            summary: null,
            content: "# Hi",
            created_at: "2026-01-01T00:00:00.000Z",
            updated_at: "2026-01-01T00:00:00.000Z",
          },
          work_item_ids: [],
        });
      }
      if (url === "/api/nodes/n1/work-items" && method === "POST") {
        posts.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
        return Response.json({
          node: {
            id: "n1",
            workspace_id: "ws1",
            organization_id: "o1",
            type: "note",
            payload_kind: "markdown",
            title: "Egg",
            summary: null,
            content: "# Hi",
            created_at: "2026-01-01T00:00:00.000Z",
            updated_at: "2026-01-01T00:00:00.000Z",
          },
          work_item_ids: ["wi-1"],
        });
      }
      throw new Error(`unexpected fetch ${method} ${url}`);
    };
    const store = useWikiStore();
    await store.openNode("n1");
    await store.linkWorkItem("wi-1");
    assert.equal(posts.length, 1);
    assert.equal(posts[0]?.url, "/api/nodes/n1/work-items");
    assert.deepEqual(posts[0]?.body, { work_item_id: "wi-1" });
  });

  it("setPinned PATCHes { pinned } and updates the list row", async () => {
    const patches: { url: string; body: unknown }[] = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url === "/api/workspaces/ws1/nodes" && method === "GET") {
        return Response.json({
          nodes: [
            {
              id: "n1",
              workspace_id: "ws1",
              type: "note",
              payload_kind: "markdown",
              title: "Egg",
              summary: null,
              created_at: "2026-01-01T00:00:00.000Z",
              updated_at: "2026-01-01T00:00:00.000Z",
              pinned: 0,
            },
          ],
        });
      }
      if (url === "/api/nodes/n1" && method === "PATCH") {
        patches.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
        return Response.json({
          node: {
            id: "n1",
            workspace_id: "ws1",
            organization_id: "o1",
            type: "note",
            payload_kind: "markdown",
            title: "Egg",
            summary: null,
            content: "# Hi",
            created_at: "2026-01-01T00:00:00.000Z",
            updated_at: "2026-01-02T00:00:00.000Z",
            pinned: 1,
          },
          work_item_ids: [],
        });
      }
      throw new Error(`unexpected fetch ${method} ${url}`);
    };
    const store = useWikiStore();
    await store.loadList("ws1");
    await store.setPinned("n1", true);
    assert.equal(patches.length, 1);
    assert.equal(patches[0]?.url, "/api/nodes/n1");
    assert.deepEqual(patches[0]?.body, { pinned: true });
    assert.equal(store.nodes[0]?.pinned, 1);
  });

  it("loadList with projectId adds project_id query", async () => {
    const urls: string[] = [];
    globalThis.fetch = async (input) => {
      urls.push(String(input));
      return Response.json({ nodes: [] });
    };
    const store = useWikiStore();
    await store.loadList("ws1", "proj-child");
    assert.equal(urls[0], "/api/workspaces/ws1/nodes?project_id=proj-child");
  });

  it("openNode keeps includes and refs", async () => {
    globalThis.fetch = async () =>
      Response.json({
        node: {
          id: "n1",
          workspace_id: "ws1",
          organization_id: "o1",
          type: "note",
          payload_kind: "markdown",
          title: "Plan",
          summary: null,
          content: "# Hi",
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        },
        work_item_ids: [],
        includes: [{ id: "n2", title: "Part", position: 0 }],
        refs: [{ id: "n3", title: "Cite" }],
      });
    const store = useWikiStore();
    await store.openNode("n1");
    assert.deepEqual(store.includes, [{ id: "n2", title: "Part", position: 0 }]);
    assert.deepEqual(store.refs, [{ id: "n3", title: "Cite" }]);
  });
});
