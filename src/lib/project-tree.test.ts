import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { descendantIds, wouldCycle } from "./project-tree.ts";

const nodes = [
  { id: "root", parent_id: null },
  { id: "a", parent_id: "root" },
  { id: "b", parent_id: "a" },
  { id: "c", parent_id: "root" },
];

describe("descendantIds", () => {
  it("includes self and nested children", () => {
    const ids = descendantIds("root", nodes);
    assert.deepEqual([...ids].sort(), ["a", "b", "c", "root"]);
  });

  it("is only the leaf for a leaf", () => {
    assert.deepEqual([...descendantIds("b", nodes)], ["b"]);
  });
});

describe("wouldCycle", () => {
  it("rejects setting parent to a descendant", () => {
    assert.equal(wouldCycle("root", "b", nodes), true);
  });

  it("allows a sibling reparent", () => {
    assert.equal(wouldCycle("c", "a", nodes), false);
  });
});
