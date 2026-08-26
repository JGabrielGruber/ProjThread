import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { newId } from "./id.ts";

describe("newId", () => {
  it("returns 26 Crockford characters", () => {
    const id = newId();
    assert.match(id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it("is unique across many calls", () => {
    const set = new Set(Array.from({ length: 200 }, () => newId()));
    assert.equal(set.size, 200);
  });
});
