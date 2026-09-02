import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createPinia, setActivePinia } from "pinia";
import { useSessionStore } from "./session.ts";

describe("session store", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("401 clears principal and memberships", async () => {
    globalThis.fetch = async () => new Response(null, { status: 401 });
    const store = useSessionStore();
    await store.loadMe();
    assert.equal(store.principal, null);
    assert.deepEqual(store.memberships, []);
    assert.equal(store.loaded, true);
  });

  it("200 sets principal and memberships", async () => {
    const principal = { id: "p1", type: "human", display_name: "Ada" };
    const memberships = [
      {
        organization_id: "o1",
        organization_name: "Farm",
        workspace_id: "w1",
        workspace_name: "Farm",
        role: "owner",
      },
    ];
    globalThis.fetch = async (input, init) => {
      assert.equal(String(input), "/api/me");
      assert.equal(init?.method ?? "GET", "GET");
      assert.equal(init?.credentials, "include");
      return Response.json({
        principal,
        memberships,
        workspace_id: "w1",
      });
    };
    const store = useSessionStore();
    await store.loadMe();
    assert.deepEqual(store.principal, principal);
    assert.deepEqual(store.memberships, memberships);
    assert.equal(store.workspaceId, "w1");
    assert.equal(store.loaded, true);
  });

  it("loadMe PATCHes memberships[0] when workspace_id is null", async () => {
    const principal = { id: "p1", type: "human", display_name: "Ada" };
    const memberships = [
      {
        organization_id: "o1",
        organization_name: "Farm",
        workspace_id: "w1",
        workspace_name: "Farm",
        role: "owner",
      },
    ];
    const calls: { method: string; body: unknown }[] = [];
    globalThis.fetch = async (input, init) => {
      assert.equal(String(input), "/api/me");
      const method = (init?.method ?? "GET").toUpperCase();
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      calls.push({ method, body });
      if (method === "PATCH") {
        return Response.json({
          principal,
          memberships,
          workspace_id: "w1",
        });
      }
      return Response.json({
        principal,
        memberships,
        workspace_id: null,
      });
    };
    const store = useSessionStore();
    await store.loadMe();
    assert.equal(store.workspaceId, "w1");
    assert.deepEqual(calls, [
      { method: "GET", body: null },
      { method: "PATCH", body: { workspace_id: "w1" } },
    ]);
  });

  it("loadMe with empty memberships does not PATCH", async () => {
    const principal = { id: "p1", type: "human", display_name: "Ada" };
    const calls: string[] = [];
    globalThis.fetch = async (input, init) => {
      assert.equal(String(input), "/api/me");
      calls.push((init?.method ?? "GET").toUpperCase());
      return Response.json({
        principal,
        memberships: [],
        workspace_id: null,
      });
    };
    const store = useSessionStore();
    await store.loadMe();
    assert.deepEqual(store.principal, principal);
    assert.deepEqual(store.memberships, []);
    assert.equal(store.workspaceId, null);
    assert.deepEqual(calls, ["GET"]);
  });

  it("second loadMe while in-flight does not call fetch twice", async () => {
    let calls = 0;
    let release!: (value: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      release = resolve;
    });
    globalThis.fetch = async () => {
      calls += 1;
      return pending;
    };
    const store = useSessionStore();
    const first = store.loadMe();
    const second = store.loadMe();
    release(
      Response.json({
        principal: { id: "p1", type: "human", display_name: "Ada" },
        memberships: [],
      }),
    );
    await Promise.all([first, second]);
    assert.equal(calls, 1);
  });
});
