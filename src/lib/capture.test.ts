import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SELECTION_MAX_CHARS,
  fileReport,
  metadataPayload,
  parseOrigin,
  pngFromDataUrl,
  rootSummary,
  rootTitle,
  type CaptureApi,
} from "./capture.ts";

function recordingApi(): CaptureApi & { calls: string[] } {
  const calls: string[] = [];
  let n = 0;
  return {
    calls,
    async createNode(_ws, body) {
      n += 1;
      const id = `n${n}`;
      calls.push(`create:${body.payload_kind}:${body.title}:${id}`);
      return { node: { id } };
    },
    async includeNode(fromId, childId) {
      calls.push(`include:${fromId}:${childId}`);
    },
    async linkProject(nodeId, projectId) {
      calls.push(`project:${nodeId}:${projectId}`);
    },
    async refNode(fromId, toId) {
      calls.push(`ref:${fromId}:${toId}`);
    },
    async createBlobNode(_ws, form) {
      n += 1;
      const id = `n${n}`;
      calls.push(`blob:${form.get("title")}:${id}`);
      return { node: { id } };
    },
  };
}

describe("parseOrigin", () => {
  it("accepts http(s) origin and strips trailing slash", () => {
    assert.equal(parseOrigin("https://projthread.example.com/"), "https://projthread.example.com");
    assert.equal(parseOrigin("http://127.0.0.1:8787"), "http://127.0.0.1:8787");
  });
  it("rejects path, query, non-http", () => {
    assert.equal(parseOrigin("https://example.com/api"), null);
    assert.equal(parseOrigin("https://example.com/?x=1"), null);
    assert.equal(parseOrigin("chrome-extension://abc"), null);
    assert.equal(parseOrigin("not a url"), null);
  });
});

describe("titles", () => {
  it("falls back to Capture and clips summary to first line", () => {
    assert.equal(rootTitle("  "), "Capture");
    assert.equal(rootSummary("Hello\nworld"), "Hello");
  });
});

describe("metadataPayload", () => {
  it("nulls empty selection and clips long selection", () => {
    const captured_at = "2026-09-04T00:00:00.000Z";
    assert.equal(
      metadataPayload(
        { url: "https://a.test/", page_title: "A", selection: "", viewport: null },
        captured_at,
      ).selection,
      null,
    );
    const long = "x".repeat(SELECTION_MAX_CHARS + 10);
    assert.equal(
      metadataPayload(
        { url: "https://a.test/", page_title: "A", selection: long, viewport: { width: 1, height: 2 } },
        captured_at,
      ).selection?.length,
      SELECTION_MAX_CHARS,
    );
  });
});

describe("fileReport", () => {
  const harvest = {
    url: "https://friend.test/app",
    page_title: "Friend app",
    selection: "the bug",
    viewport: { width: 800, height: 600 },
  };

  it("creates markdown, json, includes, project; no work item", async () => {
    const api = recordingApi();
    const result = await fileReport(api, {
      workspaceId: "ws1",
      projectId: "p1",
      sentence: "Button never enables.",
      harvest,
      now: () => "2026-09-04T00:00:00.000Z",
    });
    assert.equal(result.rootId, "n1");
    assert.equal(result.metadataId, "n2");
    assert.equal(result.screenshotId, null);
    assert.deepEqual(api.calls, [
      "create:markdown:Friend app:n1",
      "create:json:Capture metadata:n2",
      "include:n1:n2",
      "project:n1:p1",
    ]);
  });

  it("includes screenshot blob when provided", async () => {
    const api = recordingApi();
    const result = await fileReport(api, {
      workspaceId: "ws1",
      projectId: "p1",
      sentence: "See shot.",
      harvest,
      screenshot: { bytes: new Uint8Array([1, 2, 3]), mime: "image/png", filename: "capture.png" },
      now: () => "2026-09-04T00:00:00.000Z",
    });
    assert.equal(result.screenshotId, "n3");
    assert.ok(api.calls.includes("blob:Capture screenshot:n3"));
    assert.ok(api.calls.includes("include:n1:n3"));
  });

  it("optional ref after project", async () => {
    const api = recordingApi();
    await fileReport(api, {
      workspaceId: "ws1",
      projectId: "p1",
      sentence: "Related.",
      harvest,
      refId: "old",
      now: () => "2026-09-04T00:00:00.000Z",
    });
    assert.equal(api.calls.at(-1), "ref:n1:old");
  });

  it("rejects blank sentence and blank project before writes", async () => {
    const api = recordingApi();
    await assert.rejects(
      () => fileReport(api, { workspaceId: "ws1", projectId: "p1", sentence: "  ", harvest }),
    );
    await assert.rejects(
      () => fileReport(api, { workspaceId: "ws1", projectId: "", sentence: "x", harvest }),
    );
    assert.equal(api.calls.length, 0);
  });
});

describe("pngFromDataUrl", () => {
  it("decodes a tiny png data url", () => {
    const raw = Uint8Array.from([137, 80, 78, 71]);
    let bin = "";
    for (const b of raw) bin += String.fromCharCode(b);
    const got = pngFromDataUrl(`data:image/png;base64,${btoa(bin)}`);
    assert.equal(got?.mime, "image/png");
    assert.equal(got?.filename, "capture.png");
    assert.deepEqual([...got!.bytes], [137, 80, 78, 71]);
  });
  it("rejects non-png", () => {
    assert.equal(pngFromDataUrl("data:image/jpeg;base64,xx"), null);
  });
});
