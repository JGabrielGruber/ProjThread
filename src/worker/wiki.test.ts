import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { memoryWikiStore, type NodeRow } from "./wiki.ts";

function farmNote(overrides: Partial<NodeRow> = {}): NodeRow {
  return {
    id: "n1",
    workspace_id: "ws-1",
    organization_id: "org-1",
    type: "note",
    payload_kind: "markdown",
    title: "Farm notes",
    summary: null,
    content: "# Hi",
    blob_key: null,
    mime_type: null,
    byte_size: null,
    filename: null,
    created_at: "2026-01-02T00:00:00.000Z",
    updated_at: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}

describe("wiki store", () => {
  it("listNodes returns title without content; other workspace empty", async () => {
    const wiki = memoryWikiStore();
    await wiki.insertNode(farmNote());

    const listed = await wiki.listNodes("ws-1");
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.title, "Farm notes");
    assert.equal("content" in (listed[0] ?? {}), false);

    assert.deepEqual(await wiki.listNodes("other"), []);
  });

  it("getNode returns markdown body and null blob fields", async () => {
    const wiki = memoryWikiStore();
    await wiki.insertNode(farmNote());

    const node = await wiki.getNode("n1");
    assert.equal(node?.content, "# Hi");
    assert.equal(node?.payload_kind, "markdown");
    assert.equal(node?.blob_key, null);
    assert.equal(node?.mime_type, null);
    assert.equal(node?.byte_size, null);
    assert.equal(node?.filename, null);
  });

  it("getNode missing is null", async () => {
    const wiki = memoryWikiStore();
    assert.equal(await wiki.getNode("missing"), null);
  });

  it("updateNode patches content; missing id is false", async () => {
    const wiki = memoryWikiStore();
    await wiki.insertNode(farmNote());

    const updated = await wiki.updateNode("n1", {
      content: "# Ho",
      updated_at: "2026-01-03T00:00:00.000Z",
    });
    assert.equal(updated, true);
    assert.equal((await wiki.getNode("n1"))?.content, "# Ho");

    assert.equal(
      await wiki.updateNode("missing", {
        content: "# No",
        updated_at: "2026-01-04T00:00:00.000Z",
      }),
      false,
    );
  });

  it("linkNodeWorkItem is inserted then exists with one id", async () => {
    const wiki = memoryWikiStore();
    await wiki.insertNode(farmNote());

    assert.equal(await wiki.linkNodeWorkItem("n1", "wi-1"), "inserted");
    assert.deepEqual(await wiki.listNodeWorkItemIds("n1"), ["wi-1"]);

    assert.equal(await wiki.linkNodeWorkItem("n1", "wi-1"), "exists");
    assert.deepEqual(await wiki.listNodeWorkItemIds("n1"), ["wi-1"]);
  });
});
