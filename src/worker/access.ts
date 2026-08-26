export const ADMIN_DEV_HEADER = "X-Admin-Dev";
export const ACCESS_JWT_HEADER = "Cf-Access-Jwt-Assertion";

export type Jwk = {
  kid?: string;
  kty: string;
  alg?: string;
  n?: string;
  e?: string;
};

export type Jwks = { keys: Jwk[] };

export type AccessEnv = {
  ADMIN_DEV_SECRET?: string;
  POLICY_AUD?: string;
  TEAM_DOMAIN?: string;
};

export type AccessDeps = {
  now?: () => number;
  fetchJwks?: (teamDomain: string) => Promise<Jwks>;
};

export async function authorizeAdmin(
  request: Request,
  env: AccessEnv,
  deps: AccessDeps = {},
): Promise<boolean> {
  if (matchesAdminDevBypass(request, env)) return true;
  return verifyAccessJwt(request, env, deps);
}

export function adminForbidden(request: Request): Response {
  const headers = { "Cache-Control": "private, no-store" };
  const path = new URL(request.url).pathname;
  if (path.startsWith("/api/")) {
    return Response.json({ error: "forbidden" }, { status: 403, headers });
  }
  return new Response("forbidden", { status: 403, headers });
}

function matchesAdminDevBypass(request: Request, env: AccessEnv): boolean {
  const secret = env.ADMIN_DEV_SECRET;
  if (!secret) return false;
  const header = request.headers.get(ADMIN_DEV_HEADER);
  if (header) return timingSafeEqual(header, secret);
  // wrangler loads .dev.vars and rewrites the host to the custom domain, so
  // loopback checks fail. No POLICY_AUD means Access is not configured yet.
  return !env.POLICY_AUD;
}

async function verifyAccessJwt(
  request: Request,
  env: AccessEnv,
  deps: AccessDeps,
): Promise<boolean> {
  const aud = env.POLICY_AUD;
  const team = env.TEAM_DOMAIN?.replace(/\/+$/, "");
  if (!aud || !team) return false;

  const token = request.headers.get(ACCESS_JWT_HEADER);
  if (!token) return false;

  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [headerB64, payloadB64, sigB64] = parts;
  if (!headerB64 || !payloadB64 || !sigB64) return false;

  let header: { kid?: string; alg?: string };
  let payload: { iss?: string; aud?: string | string[]; exp?: number };
  try {
    header = JSON.parse(new TextDecoder().decode(fromBase64Url(headerB64)));
    payload = JSON.parse(new TextDecoder().decode(fromBase64Url(payloadB64)));
  } catch {
    return false;
  }

  if (header.alg !== "RS256") return false;
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000));
  if (typeof payload.exp !== "number" || payload.exp <= now()) return false;
  if (payload.iss !== team) return false;
  if (!audienceMatches(payload.aud, aud)) return false;

  let jwks: Jwks;
  try {
    const load = deps.fetchJwks ?? fetchAccessJwks;
    jwks = await load(team);
  } catch {
    return false;
  }

  const jwk = (jwks.keys ?? []).find((key) => key.kid === header.kid);
  if (!jwk?.n || !jwk.e) return false;

  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256" },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    return crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      fromBase64Url(sigB64),
      new TextEncoder().encode(`${headerB64}.${payloadB64}`),
    );
  } catch {
    return false;
  }
}

function audienceMatches(claim: string | string[] | undefined, expected: string): boolean {
  if (typeof claim === "string") return claim === expected;
  if (Array.isArray(claim)) return claim.includes(expected);
  return false;
}

export async function fetchAccessJwks(teamDomain: string): Promise<Jwks> {
  const res = await fetch(`${teamDomain.replace(/\/+$/, "")}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error("access jwks unavailable");
  return (await res.json()) as Jwks;
}

function fromBase64Url(value: string): Uint8Array {
  const pad = "=".repeat((4 - (value.length % 4)) % 4);
  const b64 = value.replaceAll("-", "+").replaceAll("_", "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
