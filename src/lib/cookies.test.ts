import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  COOKIE_NAME,
  parseSessionId,
  serializeClearSessionCookie,
  serializeSessionCookie,
} from "./cookies.ts";

describe("cookies", () => {
  it("parses pt_session from Cookie header", () => {
    assert.equal(
      parseSessionId("foo=1; pt_session=01ABCDEFGHJKMNPQRSTVWXYZ12"),
      "01ABCDEFGHJKMNPQRSTVWXYZ12",
    );
  });

  it("returns null when missing", () => {
    assert.equal(parseSessionId("foo=1"), null);
  });

  it("sets HttpOnly Path=/ SameSite=Lax and omits Secure on http APP_ORIGIN", () => {
    const v = serializeSessionCookie("01ID", "http://127.0.0.1:8787", 30);
    assert.equal(COOKIE_NAME, "pt_session");
    assert.match(v, /pt_session=01ID/);
    assert.match(v, /HttpOnly/i);
    assert.match(v, /Path=\//);
    assert.match(v, /SameSite=Lax/i);
    assert.doesNotMatch(v, /Secure/);
  });

  it("sets Secure on https APP_ORIGIN", () => {
    const v = serializeSessionCookie("01ID", "https://example.com", 30);
    assert.match(v, /Secure/i);
  });

  it("sets Max-Age from days", () => {
    const v = serializeSessionCookie("01ID", "http://127.0.0.1:8787", 30);
    assert.match(v, /Max-Age=2592000/);
  });

  it("clears with Max-Age=0 and same attrs", () => {
    const http = serializeClearSessionCookie("http://127.0.0.1:8787");
    assert.match(http, /pt_session=/);
    assert.match(http, /Max-Age=0/);
    assert.match(http, /HttpOnly/i);
    assert.match(http, /Path=\//);
    assert.match(http, /SameSite=Lax/i);
    assert.doesNotMatch(http, /Secure/);

    const https = serializeClearSessionCookie("https://example.com");
    assert.match(https, /Max-Age=0/);
    assert.match(https, /Secure/i);
  });
});
