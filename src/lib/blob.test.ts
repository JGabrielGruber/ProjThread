import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BLOB_MAX_BYTES, parseMime, sanitizeFilename } from "./blob.ts";

describe("blob helpers", () => {
  it("caps at 8 MiB", () => {
    assert.equal(BLOB_MAX_BYTES, 8 * 1024 * 1024);
  });
  it("parseMime accepts type/subtype, strips params, lowercases", () => {
    assert.equal(parseMime("image/PNG; charset=x"), "image/png");
    assert.equal(parseMime("application/octet-stream"), "application/octet-stream");
  });
  it("parseMime rejects empty and junk", () => {
    assert.equal(parseMime(""), null);
    assert.equal(parseMime(null), null);
    assert.equal(parseMime("image"), null);
    assert.equal(parseMime("image/"), null);
  });
  it("sanitizeFilename takes basename, default blob, max 255", () => {
    assert.equal(sanitizeFilename("a/b/shot.png"), "shot.png");
    assert.equal(sanitizeFilename(""), "blob");
    assert.equal(sanitizeFilename(null), "blob");
    assert.equal(sanitizeFilename("x".repeat(300)).length, 255);
  });
});
