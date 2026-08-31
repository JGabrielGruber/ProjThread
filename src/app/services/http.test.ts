import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { ApiError, apiJson } from "./http.ts";

describe("apiJson", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns JSON on 200 and sends credentials include", async () => {
    const calls: { url: string; credentials: RequestCredentials | undefined }[] =
      [];
    globalThis.fetch = async (input, init) => {
      calls.push({
        url: String(input),
        credentials: init?.credentials,
      });
      return Response.json({ ok: true });
    };
    const body = await apiJson<{ ok: boolean }>("/api/me");
    assert.deepEqual(body, { ok: true });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, "/api/me");
    assert.equal(calls[0]?.credentials, "include");
  });

  it("throws ApiError with status 401", async () => {
    globalThis.fetch = async () => new Response(null, { status: 401 });
    await assert.rejects(
      () => apiJson("/api/me"),
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.status, 401);
        return true;
      },
    );
  });

  it("POST sets content-type when body is set", async () => {
    let contentType: string | null = null;
    globalThis.fetch = async (_input, init) => {
      const headers = new Headers(init?.headers);
      contentType = headers.get("content-type");
      return Response.json({ ok: true }, { status: 201 });
    };
    await apiJson("/api/workspaces/w1/work-items", {
      method: "POST",
      body: JSON.stringify({ title: "Hello" }),
    });
    assert.equal(contentType, "application/json");
  });
});
