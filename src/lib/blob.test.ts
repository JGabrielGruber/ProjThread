import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BLOB_MAX_BYTES,
  BLOB_MAX_COUNT,
  BLOB_MAX_STORED_BYTES,
  exceedsBlobQuota,
  parseMime,
  sanitizeFilename,
} from "./blob.ts";

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
  it("stored and count caps sit under the free R2 band", () => {
    assert.equal(BLOB_MAX_BYTES, 8 * 1024 * 1024);
    assert.equal(BLOB_MAX_COUNT, 4096);
    assert.equal(BLOB_MAX_STORED_BYTES, 4 * 1024 * 1024 * 1024);
  });
  it("exceedsBlobQuota is exclusive at the cap", () => {
    assert.equal(exceedsBlobQuota({ count: 4095, bytes: 0 }, 1), false);
    assert.equal(exceedsBlobQuota({ count: 4096, bytes: 0 }, 1), true);
    assert.equal(
      exceedsBlobQuota({ count: 0, bytes: BLOB_MAX_STORED_BYTES }, 0),
      false,
    );
    assert.equal(
      exceedsBlobQuota({ count: 0, bytes: BLOB_MAX_STORED_BYTES }, 1),
      true,
    );
  });
});
