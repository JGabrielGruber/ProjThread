import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createPinia, setActivePinia } from "pinia";
import { useBoardStore } from "./board.ts";

describe("board store", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("second loadBoard while in-flight does not double-fetch", async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    globalThis.fetch = async () => {
      calls += 1;
      await gate;
      return Response.json({ projects: [], stages: [], work_items: [] });
    };
    const store = useBoardStore();
    const first = store.loadBoard("w1", "p1");
    const second = store.loadBoard("w1", "p1");
    release();
    await Promise.all([first, second]);
    assert.equal(calls, 3);
  });

  it("createCard POSTs { title, project_id }", async () => {
    const posts: { url: string; body: unknown; credentials: RequestCredentials | undefined }[] =
      [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.endsWith("/projects")) {
        return Response.json({ projects: [] });
      }
      if (url.endsWith("/stages")) {
        return Response.json({ stages: [] });
      }
      if (url.includes("/work-items") && method === "GET") {
        return Response.json({ work_items: [] });
      }
      if (url.includes("/work-items") && method === "POST") {
        posts.push({
          url,
          body: JSON.parse(String(init?.body ?? "{}")),
          credentials: init?.credentials,
        });
        return Response.json(
          {
            id: "i1",
            project_id: "proj1",
            workspace_id: "ws1",
            organization_id: "o1",
            title: "Hello",
            stage_key: "backlog",
            owner_id: null,
            created_at: "2026-01-01T00:00:00.000Z",
            updated_at: "2026-01-01T00:00:00.000Z",
          },
          { status: 201 },
        );
      }
      throw new Error(`unexpected fetch ${method} ${url}`);
    };

    const store = useBoardStore();
    await store.loadBoard("ws1", "proj1");
    await store.createCard("Hello");
    assert.equal(posts.length, 1);
    assert.equal(posts[0].url, "/api/workspaces/ws1/work-items");
    assert.deepEqual(posts[0].body, { title: "Hello", project_id: "proj1" });
    assert.equal(posts[0].credentials, "include");
  });
});
