import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createPinia, setActivePinia } from "pinia";
import { useConfigStore } from "./config.ts";

describe("config store", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("load GETs members, projects, and stages with credentials", async () => {
    const calls: { url: string; credentials: RequestCredentials | undefined }[] =
      [];
    globalThis.fetch = async (input, init) => {
      calls.push({
        url: String(input),
        credentials: init?.credentials,
      });
      const url = String(input);
      if (url.endsWith("/members")) return Response.json({ members: [] });
      if (url.endsWith("/projects")) return Response.json({ projects: [] });
      if (url.endsWith("/stages")) return Response.json({ stages: [] });
      throw new Error(`unexpected fetch ${url}`);
    };
    const store = useConfigStore();
    await store.load("ws1");
    assert.equal(calls.length, 3);
    const urls = calls.map((c) => c.url).sort();
    assert.deepEqual(urls, [
      "/api/workspaces/ws1/members",
      "/api/workspaces/ws1/projects",
      "/api/workspaces/ws1/stages",
    ]);
    assert.ok(calls.every((c) => c.credentials === "include"));
  });

  it("second load while in-flight does not double-fetch", async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    globalThis.fetch = async (input) => {
      calls += 1;
      await gate;
      const url = String(input);
      if (url.endsWith("/members")) return Response.json({ members: [] });
      if (url.endsWith("/projects")) return Response.json({ projects: [] });
      if (url.endsWith("/stages")) return Response.json({ stages: [] });
      throw new Error(`unexpected fetch ${url}`);
    };
    const store = useConfigStore();
    const first = store.load("ws1");
    const second = store.load("ws1");
    release();
    await Promise.all([first, second]);
    assert.equal(calls, 3);
  });

  it("401 => status no_session", async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
    const store = useConfigStore();
    await store.load("ws1");
    assert.equal(store.status, "no_session");
  });

  it("addMember POSTs principal_id to members", async () => {
    const posts: { url: string; body: unknown }[] = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET") {
        if (url.endsWith("/members")) return Response.json({ members: [] });
        if (url.endsWith("/projects")) return Response.json({ projects: [] });
        if (url.endsWith("/stages")) return Response.json({ stages: [] });
      }
      if (url.endsWith("/members") && method === "POST") {
        posts.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
        return Response.json(
          {
            member: {
              principal_id: "p2",
              display_name: "Bot",
              type: "human",
              role: "member",
            },
          },
          { status: 201 },
        );
      }
      throw new Error(`unexpected fetch ${method} ${url}`);
    };
    const store = useConfigStore();
    await store.load("ws1");
    await store.addMember({ principal_id: "p2" });
    assert.equal(posts.length, 1);
    assert.equal(posts[0]?.url, "/api/workspaces/ws1/members");
    assert.deepEqual(posts[0]?.body, { principal_id: "p2" });
  });

  it("createProject POSTs name and parent_id", async () => {
    const posts: { url: string; body: unknown }[] = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET") {
        if (url.endsWith("/members")) return Response.json({ members: [] });
        if (url.endsWith("/projects")) return Response.json({ projects: [] });
        if (url.endsWith("/stages")) return Response.json({ stages: [] });
      }
      if (url.endsWith("/projects") && method === "POST") {
        posts.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
        return Response.json(
          {
            project: {
              id: "barn",
              workspace_id: "ws1",
              organization_id: "o1",
              parent_id: "root",
              name: "Barn",
            },
          },
          { status: 201 },
        );
      }
      throw new Error(`unexpected fetch ${method} ${url}`);
    };
    const store = useConfigStore();
    await store.load("ws1");
    await store.createProject({ name: "Barn", parent_id: "root" });
    assert.equal(posts.length, 1);
    assert.equal(posts[0]?.url, "/api/workspaces/ws1/projects");
    assert.deepEqual(posts[0]?.body, { name: "Barn", parent_id: "root" });
  });

  it("renameProject PATCHes /api/projects/:id", async () => {
    const patches: { url: string; body: unknown }[] = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET") {
        if (url.endsWith("/members")) return Response.json({ members: [] });
        if (url.endsWith("/projects")) {
          return Response.json({
            projects: [{ id: "root", parent_id: null, name: "Acme" }],
          });
        }
        if (url.endsWith("/stages")) return Response.json({ stages: [] });
      }
      if (url === "/api/projects/root" && method === "PATCH") {
        patches.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
        return Response.json({
          project: { id: "root", parent_id: null, name: "Farm" },
        });
      }
      throw new Error(`unexpected fetch ${method} ${url}`);
    };
    const store = useConfigStore();
    await store.load("ws1");
    await store.renameProject("root", "Farm");
    assert.equal(patches.length, 1);
    assert.equal(patches[0]?.url, "/api/projects/root");
    assert.deepEqual(patches[0]?.body, { name: "Farm" });
  });

  it("saveStages PATCHes stages", async () => {
    const patches: { url: string; body: unknown }[] = [];
    const stages = [
      { key: "doing", label: "Now", position: 0 },
      { key: "backlog", label: "Backlog", position: 1 },
      { key: "done", label: "Done", position: 2 },
    ];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET") {
        if (url.endsWith("/members")) return Response.json({ members: [] });
        if (url.endsWith("/projects")) return Response.json({ projects: [] });
        if (url.endsWith("/stages")) return Response.json({ stages: [] });
      }
      if (url.endsWith("/stages") && method === "PATCH") {
        patches.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
        return Response.json({ stages });
      }
      throw new Error(`unexpected fetch ${method} ${url}`);
    };
    const store = useConfigStore();
    await store.load("ws1");
    await store.saveStages(stages);
    assert.equal(patches.length, 1);
    assert.equal(patches[0]?.url, "/api/workspaces/ws1/stages");
    assert.deepEqual(patches[0]?.body, { stages });
  });

  it("setRole PATCHes member role", async () => {
    const patches: { url: string; body: unknown }[] = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET") {
        if (url.endsWith("/members")) {
          return Response.json({
            members: [
              { principal_id: "p2", display_name: "Bot", type: "human", role: "member" },
            ],
          });
        }
        if (url.endsWith("/projects")) return Response.json({ projects: [] });
        if (url.endsWith("/stages")) return Response.json({ stages: [] });
      }
      if (url === "/api/workspaces/ws1/members/p2" && method === "PATCH") {
        patches.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
        return Response.json({
          member: {
            principal_id: "p2",
            display_name: "Bot",
            type: "human",
            role: "owner",
          },
        });
      }
      throw new Error(`unexpected fetch ${method} ${url}`);
    };
    const store = useConfigStore();
    await store.load("ws1");
    await store.setRole("p2", "owner");
    assert.equal(patches.length, 1);
    assert.equal(patches[0]?.url, "/api/workspaces/ws1/members/p2");
    assert.deepEqual(patches[0]?.body, { role: "owner" });
  });

  it("removeMember DELETEs member", async () => {
    const deletes: string[] = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET") {
        if (url.endsWith("/members")) {
          return Response.json({
            members: [
              { principal_id: "p2", display_name: "Bot", type: "human", role: "member" },
            ],
          });
        }
        if (url.endsWith("/projects")) return Response.json({ projects: [] });
        if (url.endsWith("/stages")) return Response.json({ stages: [] });
      }
      if (url === "/api/workspaces/ws1/members/p2" && method === "DELETE") {
        deletes.push(url);
        return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected fetch ${method} ${url}`);
    };
    const store = useConfigStore();
    await store.load("ws1");
    await store.removeMember("p2");
    assert.deepEqual(deletes, ["/api/workspaces/ws1/members/p2"]);
    assert.equal(store.members.some((m) => m.principal_id === "p2"), false);
  });

  it("createWorkspace POSTs /api/organizations", async () => {
    const posts: { url: string; body: unknown }[] = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url === "/api/organizations" && method === "POST") {
        posts.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
        return Response.json(
          {
            organization: { id: "o2", name: "Keep" },
            workspace: { id: "w2", name: "Keep" },
            project: { id: "p2", name: "Keep", parent_id: null },
          },
          { status: 201 },
        );
      }
      if (url === "/api/me" && method === "PATCH") {
        return Response.json({
          principal: { id: "p1", type: "human", display_name: "Ada" },
          memberships: [
            {
              organization_id: "o2",
              organization_name: "Keep",
              workspace_id: "w2",
              workspace_name: "Keep",
              role: "owner",
            },
          ],
          workspace_id: "w2",
        });
      }
      if (url === "/api/me") {
        return Response.json({
          principal: { id: "p1", type: "human", display_name: "Ada" },
          memberships: [
            {
              organization_id: "o2",
              organization_name: "Keep",
              workspace_id: "w2",
              workspace_name: "Keep",
              role: "owner",
            },
          ],
          workspace_id: "w2",
        });
      }
      if (url.endsWith("/members")) return Response.json({ members: [] });
      if (url.endsWith("/projects")) return Response.json({ projects: [] });
      if (url.endsWith("/stages")) return Response.json({ stages: [] });
      throw new Error(`unexpected fetch ${method} ${url}`);
    };
    const store = useConfigStore();
    await store.createWorkspace("Keep");
    assert.equal(posts[0]?.url, "/api/organizations");
    assert.deepEqual(posts[0]?.body, { name: "Keep" });
  });
});
