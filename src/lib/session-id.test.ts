import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseBearerSessionId,
  sessionIdFromRequest,
} from "./session-id.ts";

const ID = "01ABCDEFGHJKMNPQRSTVWXYZ12";

describe("parseBearerSessionId", () => {
  it("reads Bearer token case-insensitively", () => {
    assert.equal(parseBearerSessionId(`Bearer ${ID}`), ID);
    assert.equal(parseBearerSessionId(`bearer ${ID}`), ID);
  });

  it("returns empty string for Bearer with no token", () => {
    assert.equal(parseBearerSessionId("Bearer"), "");
    assert.equal(parseBearerSessionId("Bearer   "), "");
  });

  it("returns null when missing or not Bearer", () => {
    assert.equal(parseBearerSessionId(null), null);
    assert.equal(parseBearerSessionId("Basic abc"), null);
  });
});

describe("sessionIdFromRequest", () => {
  it("prefers Bearer over cookie", () => {
    const req = new Request("http://127.0.0.1/api/me", {
      headers: {
        authorization: `Bearer ${ID}`,
        cookie: "pt_session=01COOKIESESSIONID00000000000",
      },
    });
    assert.equal(sessionIdFromRequest(req), ID);
  });

  it("does not fall back to cookie on empty Bearer", () => {
    const req = new Request("http://127.0.0.1/api/me", {
      headers: {
        authorization: "Bearer",
        cookie: `pt_session=${ID}`,
      },
    });
    assert.equal(sessionIdFromRequest(req), "");
  });

  it("uses cookie when Authorization is absent or not Bearer", () => {
    const cookieReq = new Request("http://127.0.0.1/api/me", {
      headers: { cookie: `pt_session=${ID}` },
    });
    assert.equal(sessionIdFromRequest(cookieReq), ID);

    const basic = new Request("http://127.0.0.1/api/me", {
      headers: {
        authorization: "Basic abc",
        cookie: `pt_session=${ID}`,
      },
    });
    assert.equal(sessionIdFromRequest(basic), ID);
  });
});
