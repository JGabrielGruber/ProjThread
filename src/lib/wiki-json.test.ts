import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canonicalizeJson } from "./wiki-json.ts";

describe("canonicalizeJson", () => {
  it("stringifies objects and arrays", () => {
    assert.equal(canonicalizeJson('{"b":1,"a":2}'), '{"b":1,"a":2}');
    assert.equal(canonicalizeJson("[1,2]"), "[1,2]");
  });
  it("rejects invalid and non-containers", () => {
    assert.equal(canonicalizeJson("{"), null);
    assert.equal(canonicalizeJson("null"), null);
    assert.equal(canonicalizeJson("1"), null);
    assert.equal(canonicalizeJson('"x"'), null);
    assert.equal(canonicalizeJson("true"), null);
  });
});
