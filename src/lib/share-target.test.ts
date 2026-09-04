import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SHARE_CACHE,
  SHARE_FILES_FIELD,
  SHARE_PATH,
  firstHttpUrl,
  harvestFromShare,
  parseShareFields,
  parseShareId,
  readSharePark,
  shareLandingPath,
  suggestedSentence,
  writeSharePark,
} from "./share-target.ts";

function memoryCache() {
  const map = new Map<string, Response>();
  const keyOf = (request: RequestInfo | URL) => {
    const raw =
      typeof request === "string"
        ? request
        : request instanceof URL
          ? request.href
          : request.url;
    return new URL(raw, "https://pt.test").pathname;
  };
  return {
    async put(request: RequestInfo | URL, response: Response) {
      map.set(keyOf(request), response.clone());
    },
    async match(request: RequestInfo | URL) {
      const hit = map.get(keyOf(request));
      return hit?.clone();
    },
    async delete(request: RequestInfo | URL) {
      return map.delete(keyOf(request));
    },
  };
}

describe("share constants", () => {
  it("locks path, cache, and file field", () => {
    assert.equal(SHARE_PATH, "/capture");
    assert.equal(SHARE_CACHE, "pt-share");
    assert.equal(SHARE_FILES_FIELD, "media");
  });
});

describe("parseShareFields", () => {
  it("stringifies and trims", () => {
    assert.deepEqual(
      parseShareFields({ title: "  Hi  ", text: null, url: " https://a.test/ " }),
      { title: "Hi", text: "", url: "https://a.test/" },
    );
  });
});

describe("firstHttpUrl", () => {
  it("picks the first http(s) token", () => {
    assert.equal(firstHttpUrl("see https://a.test/x and more"), "https://a.test/x");
    assert.equal(firstHttpUrl("no link"), null);
  });
});

describe("harvestFromShare", () => {
  it("uses url param, else url in text; viewport null", () => {
    const harvest = harvestFromShare({
      title: "Friend",
      text: "the bug https://ignored.test/",
      url: "https://friend.test/app",
    });
    assert.deepEqual(harvest, {
      url: "https://friend.test/app",
      page_title: "Friend",
      selection: "the bug https://ignored.test/",
      viewport: null,
    });
  });
  it("extracts url from text when url param empty; blank title is Capture", () => {
    const harvest = harvestFromShare({
      title: "",
      text: "look https://b.test/z",
      url: "",
    });
    assert.equal(harvest.url, "https://b.test/z");
    assert.equal(harvest.page_title, "Capture");
  });
});

describe("suggestedSentence", () => {
  it("prefers text then title then url", () => {
    assert.equal(suggestedSentence({ title: "T", text: "Body", url: "https://a.test/" }), "Body");
    assert.equal(suggestedSentence({ title: "T", text: "", url: "https://a.test/" }), "T");
    assert.equal(suggestedSentence({ title: "", text: "", url: "https://a.test/" }), "https://a.test/");
    assert.equal(suggestedSentence({ title: "", text: "", url: "" }), "");
  });
});

describe("parseShareId / landing", () => {
  it("accepts token ids and rejects path junk", () => {
    assert.equal(parseShareId("abc-123_"), "abc-123_");
    assert.equal(parseShareId("../x"), null);
    assert.equal(parseShareId(""), null);
    assert.equal(parseShareId(null), null);
    assert.equal(shareLandingPath("abc-123_"), "/capture?share=abc-123_");
  });
});

describe("share park", () => {
  it("roundtrips fields and image bytes then deletes", async () => {
    const cache = memoryCache();
    await writeSharePark(cache, "id1", {
      title: "T",
      text: "Body",
      url: "https://a.test/",
      files: [
        { filename: "shot.jpg", mime: "image/jpeg", bytes: new Uint8Array([9, 8]) },
      ],
    });
    const got = await readSharePark(cache, "id1");
    assert.deepEqual(got, {
      title: "T",
      text: "Body",
      url: "https://a.test/",
      files: [
        { filename: "shot.jpg", mime: "image/jpeg", bytes: new Uint8Array([9, 8]) },
      ],
    });
    const again = await readSharePark(cache, "id1");
    assert.equal(again, null);
  });
});
