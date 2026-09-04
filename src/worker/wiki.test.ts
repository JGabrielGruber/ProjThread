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
    pinned: 0,
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

  it("listNodes includes pinned after updateNode", async () => {
    const wiki = memoryWikiStore();
    await wiki.insertNode(farmNote({ id: "n1", title: "Pinned" }));
    await wiki.insertNode(farmNote({ id: "n2", title: "Loose" }));

    const ok = await wiki.updateNode("n1", {
      pinned: 1,
      updated_at: "2026-01-03T00:00:00.000Z",
    });
    assert.equal(ok, true);

    const listed = await wiki.listNodes("ws-1");
    const byId = Object.fromEntries(listed.map((row) => [row.id, row]));
    assert.equal(byId.n1?.pinned, 1);
    assert.equal(byId.n2?.pinned, 0);
  });

  it("linkNodeWorkItem is inserted then exists with one id", async () => {
    const wiki = memoryWikiStore();
    await wiki.insertNode(farmNote());

    assert.equal(await wiki.linkNodeWorkItem("n1", "wi-1"), "inserted");
    assert.deepEqual(await wiki.listNodeWorkItemIds("n1"), ["wi-1"]);

    assert.equal(await wiki.linkNodeWorkItem("n1", "wi-1"), "exists");
    assert.deepEqual(await wiki.listNodeWorkItemIds("n1"), ["wi-1"]);
  });

  it("linkNodeProject is inserted then exists with one id", async () => {
    const wiki = memoryWikiStore();
    await wiki.insertNode(farmNote());

    assert.equal(await wiki.linkNodeProject("n1", "proj-farm"), "inserted");
    assert.deepEqual(await wiki.listNodeProjectIds("n1"), ["proj-farm"]);

    assert.equal(await wiki.linkNodeProject("n1", "proj-farm"), "exists");
    assert.deepEqual(await wiki.listNodeProjectIds("n1"), ["proj-farm"]);
  });

  it("include, ref, and attach stay independent", async () => {
    const wiki = memoryWikiStore();
    await wiki.insertNode(farmNote({ id: "n1", title: "Plan" }));
    await wiki.insertNode(
      farmNote({ id: "n2", title: "Requirements", content: "# Req" }),
    );
    await wiki.insertNode(farmNote({ id: "n3", title: "Other plan" }));
    await wiki.insertNode(
      farmNote({
        id: "n-other",
        workspace_id: "ws-other",
        title: "Other ws",
      }),
    );

    assert.equal(await wiki.includeNode("n1", "n2", 0), "inserted");
    const includes = await wiki.listIncludes("n1");
    assert.deepEqual(includes, [
      { id: "n2", title: "Requirements", position: 0 },
    ]);
    assert.equal("content" in includes[0]!, false);
    assert.deepEqual(await wiki.listRefs("n1"), []);

    assert.equal(await wiki.refNode("n1", "n3"), "inserted");
    const refs = await wiki.listRefs("n1");
    assert.deepEqual(refs, [{ id: "n3", title: "Other plan" }]);
    assert.equal("content" in refs[0]!, false);
    assert.deepEqual(await wiki.listIncludes("n1"), [
      { id: "n2", title: "Requirements", position: 0 },
    ]);

    assert.equal(await wiki.includeNode("n1", "n2", 0), "exists");
    assert.equal(await wiki.refNode("n1", "n2"), "inserted");
    const bothIncludes = await wiki.listIncludes("n1");
    const bothRefs = await wiki.listRefs("n1");
    assert.equal(bothIncludes.some((row) => row.id === "n2"), true);
    assert.equal(bothRefs.some((row) => row.id === "n2"), true);
    assert.equal("content" in (bothIncludes.find((r) => r.id === "n2") ?? {}), false);

    assert.equal(await wiki.linkNodeWorkItem("n2", "wi-1"), "inserted");
    assert.deepEqual(await wiki.listNodeWorkItemIds("n2"), ["wi-1"]);
    assert.equal(await wiki.linkNodeProject("n1", "proj-farm"), "inserted");
    assert.deepEqual(await wiki.listNodeProjectIds("n1"), ["proj-farm"]);
    assert.deepEqual(await wiki.listNodeProjectIds("n2"), []);
    assert.deepEqual(await wiki.listNodeWorkItemIds("n1"), []);
    assert.deepEqual(await wiki.listNodeWorkItemIds("n2"), ["wi-1"]);
    assert.equal((await wiki.listIncludes("n1")).length, 1);
    assert.equal((await wiki.listRefs("n1")).some((r) => r.id === "n3"), true);

    assert.equal(await wiki.refNode("n1", "n-other"), "inserted");
    const edges = await wiki.listIncludeEdges("ws-1");
    assert.deepEqual(edges, [{ from_id: "n1", to_id: "n2" }]);
    assert.equal(
      edges.some((e) => e.to_id === "n-other" || e.to_id === "n3"),
      false,
    );
  });

  it("blobUsage counts keyed blobs only, account grain", async () => {
    const wiki = memoryWikiStore();
    await wiki.insertNode(farmNote());
    await wiki.insertNode(
      farmNote({
        id: "b-null",
        payload_kind: "blob",
        blob_key: null,
        byte_size: 99,
      }),
    );
    await wiki.insertNode(
      farmNote({
        id: "b1",
        workspace_id: "ws-other",
        payload_kind: "blob",
        blob_key: "ws-other/b1",
        byte_size: 10,
      }),
    );
    await wiki.insertNode(
      farmNote({
        id: "b2",
        payload_kind: "blob",
        blob_key: "ws-1/b2",
        byte_size: 5,
      }),
    );
    assert.deepEqual(await wiki.blobUsage(), { count: 2, bytes: 15 });
  });
});

