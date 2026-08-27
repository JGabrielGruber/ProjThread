import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  rejectContent,
  rejectTitle,
  stripRawHtml,
} from "./wiki-text.ts";

describe("stripRawHtml", () => {
  it("drops tags and keeps inner text", () => {
    assert.equal(stripRawHtml("Hi<script>x</script>!"), "Hix!");
  });

  it("leaves tags inside fenced code", () => {
    const src = "```\n<p>x</p>\n```";
    assert.equal(stripRawHtml(src).includes("<p>x</p>"), true);
  });
});

describe("rejectTitle", () => {
  it("empty or whitespace is empty; 200 ascii ok; 201 too_large", () => {
    assert.equal(rejectTitle(""), "empty");
    assert.equal(rejectTitle("   "), "empty");
    assert.equal(rejectTitle("a".repeat(200)), null);
    assert.equal(rejectTitle("a".repeat(201)), "too_large");
  });
});

describe("rejectContent", () => {
  it("32768 ascii ok; 32769 too_large", () => {
    assert.equal(rejectContent("a".repeat(32768)), null);
    assert.equal(rejectContent("a".repeat(32769)), "too_large");
  });
});
