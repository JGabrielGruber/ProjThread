import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { memoryBlobStore } from "./blobs.ts";

describe("memoryBlobStore", () => {
  it("puts and gets a copy", async () => {
    const store = memoryBlobStore();
    const bytes = new Uint8Array([1, 2, 3]);
    await store.put("ws/n1", bytes);
    const got = await store.get("ws/n1");
    assert.deepEqual(got, bytes);
    bytes[0] = 9;
    assert.equal((await store.get("ws/n1"))?.[0], 1);
    assert.equal(await store.get("missing"), null);
  });
});
