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

  it("moveCard POSTs stage_changed to work-item events", async () => {
    const posts: { url: string; body: unknown }[] = [];
    const card = {
      id: "i1",
      project_id: "p1",
      workspace_id: "w1",
      organization_id: "o1",
      title: "Card",
      stage_key: "backlog",
      owner_id: null,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    };
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.endsWith("/projects")) {
        return Response.json({ projects: [] });
      }
      if (url.endsWith("/stages")) {
        return Response.json({
          stages: [
            { key: "backlog", label: "Backlog", position: 0 },
            { key: "doing", label: "Doing", position: 1 },
          ],
        });
      }
      if (url.includes("/work-items") && method === "GET") {
        return Response.json({ work_items: [card] });
      }
      if (url === "/api/work-items/i1/events" && method === "POST") {
        posts.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
        return Response.json(
          {
            event: {},
            work_item: { ...card, stage_key: "doing" },
          },
          { status: 201 },
        );
      }
      throw new Error(`unexpected fetch ${method} ${url}`);
    };

    const store = useBoardStore();
    await store.loadBoard("w1", "p1");
    await store.moveCard("i1", "doing", "start");
    assert.equal(posts.length, 1);
    assert.equal(posts[0]!.url, "/api/work-items/i1/events");
    assert.deepEqual(posts[0]!.body, {
      type: "stage_changed",
      from: "backlog",
      to: "doing",
      body: "start",
    });
    assert.equal(store.items[0]?.stage_key, "doing");
  });
});
