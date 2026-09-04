import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseKinds } from "./notify-kind.ts";

describe("parseKinds", () => {
  it("accepts a non-empty subset, dedupes, sorts", () => {
    assert.deepEqual(parseKinds(["node.cited", "node.created", "node.created"]), [
      "node.cited",
      "node.created",
    ]);
  });
  it("rejects empty, unknown, non-array", () => {
    assert.equal(parseKinds([]), null);
    assert.equal(parseKinds(["node.created", "card.moved"]), null);
    assert.equal(parseKinds("node.created"), null);
    assert.equal(parseKinds(null), null);
  });
});
