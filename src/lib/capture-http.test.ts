import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { captureApi } from "./capture-http.ts";

type Call = { url: string; method: string; auth: string | null; ctype: string | null; body: string | null };

function installFetch(handler: (req: Request) => Promise<Response> | Response): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    calls.push({
      url: req.url,
      method: req.method,
      auth: req.headers.get("authorization"),
      ctype: req.headers.get("content-type"),
      body: req.method === "GET" ? null : await req.clone().text(),
    });
    return handler(req);
  }) as typeof fetch;
  return calls;
}

const creds = { origin: "https://pt.test", token: "sess_1" };

describe("captureApi", () => {
  it("GET me uses Bearer and origin prefix", async () => {
    const calls = installFetch(() =>
      Response.json({
        principal: { id: "p", type: "user", display_name: "J" },
        memberships: [],
        workspace_id: "ws1",
      }),
    );
    const me = await captureApi(creds).getMe();
    assert.equal(me.workspace_id, "ws1");
    assert.equal(calls[0]?.url, "https://pt.test/api/me");
    assert.equal(calls[0]?.auth, "Bearer sess_1");
  });

  it("createNode JSON content-type; FormData omits it", async () => {
    const calls = installFetch(() => Response.json({ node: { id: "n1" } }, { status: 201 }));
    const api = captureApi(creds);
    await api.createNode("ws1", { title: "T", payload_kind: "markdown" });
    const form = new FormData();
    form.set("payload_kind", "blob");
    form.set("title", "S");
    form.set("file", new Blob([new Uint8Array([1])], { type: "image/png" }), "capture.png");
    await api.createBlobNode("ws1", form);
    assert.equal(calls[0]?.ctype, "application/json");
    assert.equal(calls[0]?.url, "https://pt.test/api/workspaces/ws1/nodes");
    assert.equal(calls[1]?.url, "https://pt.test/api/workspaces/ws1/nodes");
    assert.equal(calls[1]?.ctype === null || calls[1]?.ctype?.startsWith("multipart/form-data"), true);
    assert.notEqual(calls[1]?.ctype, "application/json");
  });

  it("include, project, ref, list projects, create project, patch me", async () => {
    const calls = installFetch((req) => {
      if (req.url.endsWith("/projects") && req.method === "GET") {
        return Response.json({ projects: [{ id: "root", parent_id: null, name: "W" }] });
      }
      if (req.url.endsWith("/projects") && req.method === "POST") {
        return Response.json({ project: { id: "p2", parent_id: "root", name: "New" } }, { status: 201 });
      }
      return Response.json({ node: { id: "n1" }, project: { id: "p2" } });
    });
    const api = captureApi(creds);
    await api.includeNode("n1", "n2");
    await api.linkProject("n1", "p1");
    await api.refNode("n1", "old");
    const listed = await api.listProjects("ws1");
    const created = await api.createProject("ws1", { name: "New", parent_id: "root" });
    await api.patchMe("ws1");
    assert.equal(calls[0]?.url, "https://pt.test/api/nodes/n1/includes");
    assert.ok(calls[0]?.body?.includes("child_id"));
    assert.equal(calls[1]?.url, "https://pt.test/api/nodes/n1/projects");
    assert.ok(calls[1]?.body?.includes("project_id"));
    assert.equal(calls[2]?.url, "https://pt.test/api/nodes/n1/refs");
    assert.ok(calls[2]?.body?.includes("to_id"));
    assert.equal(listed.projects[0]?.id, "root");
    assert.equal(created.project.id, "p2");
    assert.equal(calls.at(-1)?.url, "https://pt.test/api/me");
    assert.equal(calls.at(-1)?.method, "PATCH");
  });

  it("401 throws status", async () => {
    installFetch(() => new Response("no", { status: 401 }));
    await assert.rejects(() => captureApi(creds).getMe(), (err: unknown) => {
      assert.equal((err as { status: number }).status, 401);
      return true;
    });
  });
});
