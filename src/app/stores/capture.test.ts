import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createPinia, setActivePinia } from "pinia";
import { SHARE_CACHE, writeSharePark } from "../../lib/share-target.ts";
import { useCaptureStore } from "./capture.ts";

describe("capture store", () => {
  const originalFetch = globalThis.fetch;
  const originalCaches = globalThis.caches;

  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    globalThis.caches = originalCaches;
  });

  it("consumeShare reads park into harvest and files", async () => {
    const map = new Map<string, Response>();
    const cache = {
      async put(request: RequestInfo | URL, response: Response) {
        const url = typeof request === "string" ? request : String(request);
        map.set(new URL(url, "https://pt.test").pathname, response.clone());
      },
      async match(request: RequestInfo | URL) {
        const url = typeof request === "string" ? request : String(request);
        return map.get(new URL(url, "https://pt.test").pathname)?.clone();
      },
      async delete(request: RequestInfo | URL) {
        const url = typeof request === "string" ? request : String(request);
        return map.delete(new URL(url, "https://pt.test").pathname);
      },
    };
    globalThis.caches = {
      open: async (name: string) => {
        assert.equal(name, SHARE_CACHE);
        return cache as Cache;
      },
    } as CacheStorage;
    await writeSharePark(cache, "id1", {
      title: "Friend",
      text: "the bug",
      url: "https://friend.test/app",
      files: [
        { filename: "shot.jpg", mime: "image/jpeg", bytes: new Uint8Array([1]) },
      ],
    });
    const store = useCaptureStore();
    await store.consumeShare("id1");
    assert.equal(store.sentence, "the bug");
    assert.equal(store.harvest?.page_title, "Friend");
    assert.equal(store.files.length, 1);
    assert.equal(store.files[0]?.filename, "shot.jpg");
  });

  it("file POSTs markdown, json, include, blob, project", async () => {
    const posts: { url: string; body: unknown; contentType: string | null }[] = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      let body: unknown = init?.body;
      if (typeof init?.body === "string") body = JSON.parse(init.body);
      posts.push({
        url,
        body,
        contentType: headers.get("content-type"),
      });
      if (url.endsWith("/nodes") && body instanceof FormData) {
        return Response.json({ node: { id: "n3" } }, { status: 201 });
      }
      if (url.endsWith("/nodes")) {
        const kind = (body as { payload_kind?: string }).payload_kind;
        const id = kind === "json" ? "n2" : "n1";
        return Response.json({ node: { id } }, { status: 201 });
      }
      return Response.json({ ok: true }, { status: 201 });
    };
    const store = useCaptureStore();
    store.applyFields({
      title: "Friend app",
      text: "Button never enables.",
      url: "https://friend.test/app",
    });
    store.files = [
      { filename: "shot.jpg", mime: "image/jpeg", bytes: new Uint8Array([1]) },
    ];
    await store.file("ws1", "p1");
    assert.equal(store.status, "ready");
    assert.match(store.message, /^Filed /);
    assert.equal(posts[0]?.url, "/api/workspaces/ws1/nodes");
    assert.equal((posts[0]?.body as { payload_kind: string }).payload_kind, "markdown");
    assert.equal((posts[1]?.body as { payload_kind: string }).payload_kind, "json");
    assert.equal(posts[2]?.url, "/api/nodes/n1/includes");
    assert.equal(posts[3]?.url, "/api/workspaces/ws1/nodes");
    assert.equal(posts[3]?.contentType, null);
    assert.equal(posts[4]?.url, "/api/nodes/n1/includes");
    assert.equal(posts[5]?.url, "/api/nodes/n1/projects");
  });

  it("loadProjects GETs workspace projects; createProject selects new id", async () => {
    const calls: { url: string; method: string; body: unknown }[] = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      let body: unknown = init?.body;
      if (typeof init?.body === "string") body = JSON.parse(init.body);
      calls.push({ url, method, body });
      if (method === "POST") {
        return Response.json({
          project: { id: "p2", parent_id: "p1", name: "Bug" },
        }, { status: 201 });
      }
      return Response.json({
        projects: [{ id: "p1", parent_id: null, name: "Root" }],
      });
    };
    const store = useCaptureStore();
    await store.loadProjects("ws1");
    assert.equal(store.projects[0]?.id, "p1");
    await store.createProject("ws1", "Bug", "p1");
    assert.equal(store.selectedId, "p2");
    assert.equal(calls[1]?.url, "/api/workspaces/ws1/projects");
    assert.deepEqual(calls[1]?.body, { name: "Bug", parent_id: "p1" });
  });
});
