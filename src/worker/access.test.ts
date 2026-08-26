import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ADMIN_DEV_HEADER,
  authorizeAdmin,
  type Jwks,
} from "./access.ts";

const TEAM_DOMAIN = "https://palmengine.cloudflareaccess.com";
const POLICY_AUD = "test-aud-tag";

describe("authorizeAdmin", () => {
  it("rejects a request with no JWT when the local bypass is unset", async () => {
    const ok = await authorizeAdmin(
      new Request("https://blog.palmengine.org/api/admin/state"),
      {},
    );
    assert.equal(ok, false);
  });

  it("rejects X-Admin-Dev when ADMIN_DEV_SECRET is unset", async () => {
    const ok = await authorizeAdmin(
      new Request("https://blog.palmengine.org/api/admin/state", {
        headers: { [ADMIN_DEV_HEADER]: "guess" },
      }),
      {},
    );
    assert.equal(ok, false);
  });

  it("accepts X-Admin-Dev when it matches ADMIN_DEV_SECRET", async () => {
    const ok = await authorizeAdmin(
      new Request("https://blog.palmengine.org/api/admin/state", {
        headers: { [ADMIN_DEV_HEADER]: "local-secret" },
      }),
      { ADMIN_DEV_SECRET: "local-secret" },
    );
    assert.equal(ok, true);
  });

  it("rejects X-Admin-Dev when it does not match ADMIN_DEV_SECRET", async () => {
    const ok = await authorizeAdmin(
      new Request("https://blog.palmengine.org/api/admin/state", {
        headers: { [ADMIN_DEV_HEADER]: "wrong" },
      }),
      { ADMIN_DEV_SECRET: "local-secret" },
    );
    assert.equal(ok, false);
  });

  it("allows wrangler preview when ADMIN_DEV_SECRET is set and Access vars are not", async () => {
    const ok = await authorizeAdmin(
      new Request("https://blog.palmengine.org/admin/"),
      { ADMIN_DEV_SECRET: "local-secret" },
    );
    assert.equal(ok, true);
  });

  it("does not skip the JWT just because ADMIN_DEV_SECRET is set once POLICY_AUD exists", async () => {
    const ok = await authorizeAdmin(
      new Request("https://blog.palmengine.org/admin/"),
      { ADMIN_DEV_SECRET: "local-secret", POLICY_AUD: POLICY_AUD },
    );
    assert.equal(ok, false);
  });

  it("accepts a signed Access JWT for the configured audience and team", async () => {
    const { token, jwks } = await mintAccessJwt();
    const ok = await authorizeAdmin(
      new Request("https://blog.palmengine.org/api/admin/state", {
        headers: { "Cf-Access-Jwt-Assertion": token },
      }),
      { TEAM_DOMAIN, POLICY_AUD },
      { fetchJwks: async () => jwks },
    );
    assert.equal(ok, true);
  });

  it("rejects an Access JWT with the wrong audience", async () => {
    const { token, jwks } = await mintAccessJwt({ aud: "other-app" });
    const ok = await authorizeAdmin(
      new Request("https://blog.palmengine.org/api/admin/state", {
        headers: { "Cf-Access-Jwt-Assertion": token },
      }),
      { TEAM_DOMAIN, POLICY_AUD },
      { fetchJwks: async () => jwks },
    );
    assert.equal(ok, false);
  });

  it("rejects an expired Access JWT", async () => {
    const { token, jwks } = await mintAccessJwt({ exp: 1_700_000_000 });
    const ok = await authorizeAdmin(
      new Request("https://blog.palmengine.org/api/admin/state", {
        headers: { "Cf-Access-Jwt-Assertion": token },
      }),
      { TEAM_DOMAIN, POLICY_AUD },
      { now: () => 1_700_000_100, fetchJwks: async () => jwks },
    );
    assert.equal(ok, false);
  });
});

async function mintAccessJwt(
  claims: { aud?: string; exp?: number } = {},
): Promise<{ token: string; jwks: Jwks }> {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const kid = "test-kid";
  const header = toBase64Url(
    new TextEncoder().encode(JSON.stringify({ alg: "RS256", kid, typ: "JWT" })),
  );
  const payload = toBase64Url(
    new TextEncoder().encode(
      JSON.stringify({
        iss: TEAM_DOMAIN,
        aud: claims.aud ?? POLICY_AUD,
        exp: claims.exp ?? 2_000_000_000,
        iat: 1_700_000_000,
        email: "jose@palmengine.org",
      }),
    ),
  );
  const data = new TextEncoder().encode(`${header}.${payload}`);
  const sig = new Uint8Array(
    await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, data),
  );
  return {
    token: `${header}.${payload}.${toBase64Url(sig)}`,
    jwks: {
      keys: [
        {
          kid,
          kty: "RSA",
          alg: "RS256",
          n: jwk.n,
          e: jwk.e,
        },
      ],
    },
  };
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
