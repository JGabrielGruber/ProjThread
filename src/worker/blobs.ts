import type { R2Bucket } from "./env.ts";

export type BlobStore = {
  put(key: string, bytes: Uint8Array, mime: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
};

export function memoryBlobStore(): BlobStore {
  const map = new Map<string, Uint8Array>();
  return {
    async put(key, bytes) {
      map.set(key, Uint8Array.from(bytes));
    },
    async get(key) {
      const row = map.get(key);
      return row ? Uint8Array.from(row) : null;
    },
  };
}

export function r2BlobStore(bucket: R2Bucket): BlobStore {
  return {
    async put(key, bytes, mime) {
      await bucket.put(key, bytes, { httpMetadata: { contentType: mime } });
    },
    async get(key) {
      const object = await bucket.get(key);
      if (!object) return null;
      return new Uint8Array(await object.arrayBuffer());
    },
  };
}
