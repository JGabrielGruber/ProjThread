const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function encode(n: bigint, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out = ENCODING[Number(n % 32n)] + out;
    n /= 32n;
  }
  return out;
}

export function newId(now = Date.now): string {
  const time = BigInt(now());
  const entropy = new Uint8Array(10);
  crypto.getRandomValues(entropy);
  let rand = 0n;
  for (const b of entropy) rand = (rand << 8n) | BigInt(b);
  return encode(time, 10) + encode(rand, 16);
}
