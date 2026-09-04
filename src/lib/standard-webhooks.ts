const encoder = new TextEncoder();

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function base64ToBytes(value: string): Uint8Array | null {
  try {
    const bin = atob(value);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

export function newWebhookSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `whsec_${bytesToBase64(bytes)}`;
}

function secretBytes(secret: string): Uint8Array | null {
  const raw = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  return base64ToBytes(raw);
}

async function hmac(secret: Uint8Array, payload: string): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", key, encoder.encode(payload));
}

export async function signStandardWebhook(input: {
  id: string;
  timestamp: number;
  body: string;
  secret: string;
}): Promise<{ headers: Record<string, string> }> {
  const bytes = secretBytes(input.secret);
  if (!bytes) throw new Error("bad_secret");
  const timestamp = String(input.timestamp);
  const sig = new Uint8Array(
    await hmac(bytes, `${input.id}.${timestamp}.${input.body}`),
  );
  return {
    headers: {
      "webhook-id": input.id,
      "webhook-timestamp": timestamp,
      "webhook-signature": `v1,${bytesToBase64(sig)}`,
    },
  };
}

function timingSafeEqual(a: string, b: string): boolean {
  const aa = encoder.encode(a);
  const bb = encoder.encode(b);
  if (aa.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= (aa[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

export async function verifyStandardWebhook(input: {
  id: string;
  timestamp: string;
  signature: string;
  body: string;
  secret: string;
}): Promise<boolean> {
  const bytes = secretBytes(input.secret);
  if (!bytes) return false;
  const expected = `v1,${bytesToBase64(
    new Uint8Array(await hmac(bytes, `${input.id}.${input.timestamp}.${input.body}`)),
  )}`;
  const candidates = input.signature.split(" ");
  return candidates.some((c) => timingSafeEqual(c, expected));
}
