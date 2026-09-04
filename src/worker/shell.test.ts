import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Env } from "./env.ts";
import {
  handleAdminShell,
  handleAppShell,
  isAppHistoryPath,
} from "./shell.ts";

const ORIGIN = "http://127.0.0.1:8787";

function fakeEnv(): { env: Env; fetched: string[] } {
  const fetched: string[] = [];
  const env = {
    ASSETS: {
      async fetch(input: RequestInfo | URL) {
        const url =
          input instanceof Request
            ? input.url
            : input instanceof URL
              ? input.href
              : String(input);
        fetched.push(new URL(url).pathname);
        return new Response("ok");
      },
    },
  } as Env;
  return { env, fetched };
}

describe("handleAdminShell", () => {
  it("serves /admin/index.html for /admin and history routes", async () => {
    for (const path of ["/admin", "/admin/foo"]) {
      const { env, fetched } = fakeEnv();
      const res = await handleAdminShell(new Request(`${ORIGIN}${path}`), env);
      assert.equal(res.status, 200);
      assert.deepEqual(fetched, ["/admin/index.html"]);
    }
  });

  it("passes through /admin/assets and /admin/index.html", async () => {
    for (const path of ["/admin/assets/app.js", "/admin/index.html"]) {
      const { env, fetched } = fakeEnv();
      const res = await handleAdminShell(new Request(`${ORIGIN}${path}`), env);
      assert.equal(res.status, 200);
      assert.deepEqual(fetched, [path]);
    }
  });
});

describe("isAppHistoryPath", () => {
  it("matches wiki, config, and one-segment room", () => {
    assert.equal(isAppHistoryPath("/wiki"), true);
    assert.equal(isAppHistoryPath("/config"), true);
    assert.equal(isAppHistoryPath("/capture"), true);
    assert.equal(isAppHistoryPath("/capture/extra"), false);
    assert.equal(isAppHistoryPath("/room/wi-1"), true);
    assert.equal(isAppHistoryPath("/room/wi-1/extra"), false);
    assert.equal(isAppHistoryPath("/"), false);
    assert.equal(isAppHistoryPath("/assets/x.js"), false);
    assert.equal(isAppHistoryPath("/admin"), false);
  });
});

describe("handleAppShell", () => {
  it("rewrites history paths to /index.html", async () => {
    for (const path of ["/wiki", "/config", "/capture", "/room/wi-1"]) {
      const { env, fetched } = fakeEnv();
      const res = await handleAppShell(new Request(`${ORIGIN}${path}`), env);
      assert.equal(res.status, 200);
      assert.deepEqual(fetched, ["/index.html"]);
    }
  });

  it("passes through /sw.js", async () => {
    const { env, fetched } = fakeEnv();
    const res = await handleAppShell(new Request(`${ORIGIN}/sw.js`), env);
    assert.equal(res.status, 200);
    assert.deepEqual(fetched, ["/sw.js"]);
  });
});
