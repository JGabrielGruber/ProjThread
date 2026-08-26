import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Env } from "./env.ts";
import { handleAdminShell } from "./shell.ts";

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
