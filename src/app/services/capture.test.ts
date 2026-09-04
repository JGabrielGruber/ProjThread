import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { pwaCaptureApi } from "./capture.ts";

describe("pwaCaptureApi", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("POSTs cookie JSON and FormData without json content-type", async () => {
    const calls: {
      url: string;
      method: string;
      credentials: RequestCredentials | undefined;
      contentType: string | null;
      body: unknown;
    }[] = [];
    globalThis.fetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      let body: unknown = init?.body;
      if (typeof init?.body === "string") body = JSON.parse(init.body);
      calls.push({
        url: String(input),
        method: (init?.method ?? "GET").toUpperCase(),
        credentials: init?.credentials,
        contentType: headers.get("content-type"),
        body,
      });
      return Response.json({ node: { id: "n1" }, project: { id: "p2" } }, { status: 201 });
    };
    const api = pwaCaptureApi();
    await api.createNode("ws1", { title: "A", payload_kind: "markdown" });
    await api.includeNode("n1", "n2");
    await api.linkProject("n1", "p1");
    await api.refNode("n1", "old");
    const form = new FormData();
    form.set("title", "shot.jpg");
    await api.createBlobNode!("ws1", form);
    assert.equal(calls[0]?.url, "/api/workspaces/ws1/nodes");
    assert.equal(calls[0]?.credentials, "include");
    assert.equal(calls[0]?.contentType, "application/json");
    assert.equal(calls[1]?.url, "/api/nodes/n1/includes");
    assert.equal(calls[2]?.url, "/api/nodes/n1/projects");
    assert.deepEqual(calls[2]?.body, { project_id: "p1" });
    assert.equal(calls[3]?.url, "/api/nodes/n1/refs");
    assert.equal(calls[4]?.url, "/api/workspaces/ws1/nodes");
    assert.equal(calls[4]?.contentType, null);
    assert.ok(calls[4]?.body instanceof FormData);
  });
});
