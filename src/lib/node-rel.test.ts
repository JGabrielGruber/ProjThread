import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { wouldCycleIncludes } from "./node-rel.ts";

describe("wouldCycleIncludes", () => {
  it("rejects self", () => {
    assert.equal(wouldCycleIncludes("a", "a", []), true);
  });

  it("rejects adding B includes A when A includes B", () => {
    assert.equal(
      wouldCycleIncludes("b", "a", [{ from_id: "a", to_id: "b" }]),
      true,
    );
  });

  it("allows A includes C when A includes B", () => {
    assert.equal(
      wouldCycleIncludes("a", "c", [{ from_id: "a", to_id: "b" }]),
      false,
    );
  });

  it("allows first include on empty edges", () => {
    assert.equal(wouldCycleIncludes("a", "b", []), false);
  });
});
