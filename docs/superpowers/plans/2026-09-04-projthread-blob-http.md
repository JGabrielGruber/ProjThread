# ProjThread blob HTTP (22a) — implementation plan

> For Grok Build: one session, one slice. Compact after each task. Scout only if a file is not where this plan says. Do not add tests the plan did not ask for. Stop when STATUS is updated. Do not dispatch reviewer or superpowers:subagent-driven-development sub-agents. Do not start OAuth. Do not start room MCP. Do not implement **22b** (PWA). Do not start 23–24. Do not run `wrangler r2 bucket create` or deploy unless José asks.

**Goal:** Wiki nodes may be `payload_kind=blob`: bytes in R2, metadata in D1, authenticated GET/PUT, MCP sees caption + mime not bytes.

**Architecture:** Catalog path stays short: parse multipart or PUT body → `BLOBS.put` → D1 insert/update → maybe `queue.send` → 201/200. Private bucket. Session on byte GET (cookie or Bearer). Tests use `memoryBlobStore`; Worker uses `r2BlobStore(env.BLOBS)`.

**Tech Stack:** Existing Worker + D1 + `/mcp`. New binding `BLOBS` / bucket `projthread-blobs`. `node --test --experimental-strip-types`. No new npm deps. No Cloudflare Images/Stream. No public R2. No node DELETE.

Spec: `docs/superpowers/specs/2026-09-03-projthread-capture-design.md` slice **22a**. PWA preview is **22b**.

---

## Locked calls (do not re-litigate)

| Topic | Call |
| --- | --- |
| Binding | **`BLOBS`**. Bucket **`projthread-blobs`**. Private. Local wrangler disk is enough. Remote `wrangler r2 bucket create projthread-blobs` is ops. |
| Create | Multipart **`POST /api/workspaces/:ws/nodes`**: fields `title`, `payload_kind=blob`, optional `type` `summary` `content` (caption) `work_item_id`, file field **`file`**. Then R2 put + D1 insert + maybe notify + **201**. |
| JSON POST `blob` | Still **400** `{ error: "bad_request" }`. |
| Bytes | **`GET /api/nodes/:id/blob`**. **`PUT /api/nodes/:id/blob`** replaces bytes on an existing blob node (same key). |
| Key | `{workspace_id}/{node_id}`. SoR for mime/size/filename is **D1**. |
| Cap | **8 MiB** (`BLOB_MAX_BYTES`). Over → **413** `{ error: "too_large" }`. Prefer `Content-Length` then body length. |
| MIME | Non-empty `type/subtype` (RFC 6838 token). Any type (24 must not be blocked). Empty / junk → **400**. |
| Filename | Basename, strip controls and `"`, max 255, default `blob`. PUT: `X-Filename` or keep existing. |
| Auth | Same as wiki GET/PATCH. No session **401**. Outsider **403**. Any **member** may POST/PUT (wiki is not owner-only). |
| Missing store | Multipart/PUT with `blobs === null` → **503** `{ error: "unavailable" }`. |
| PATCH | Caption/title/type/summary/pin on blob nodes via existing JSON PATCH. Not `payload_kind`. Not bytes. |
| Notify | Multipart **201** → `node.created`. PUT bytes → `node.updated`. Same `enqueueIfMatch` as today. |
| MCP | `wiki_create` stays markdown\|json. `wiki_read` `content[0]` = caption. Envelope **keeps** `mime_type` `byte_size` `filename`; still strips `content` and **`blob_key`**. No new tools. No bytes on `/mcp`. |
| List GET | Unchanged (no content, no bytes). Node JSON GET may still include `blob_key` (null for markdown/json). |
| Out | PWA (22b), extension, share target, public bucket, Images/Stream, transcript checkpoint, node DELETE, second queue, remote bucket create, deploy. |

---

## File map

| Path | Job |
| --- | --- |
| `src/lib/blob.ts` | `BLOB_MAX_BYTES`, `parseMime`, `sanitizeFilename`. |
| `src/lib/blob.test.ts` | Parse / reject / sanitize. |
| `src/worker/blobs.ts` | `BlobStore`, `memoryBlobStore`, `r2BlobStore`. |
| `src/worker/blobs.test.ts` | Memory roundtrip. |
| `src/worker/wiki.ts` | `NodePatch` blob metadata fields; D1 + memory `updateNode`. |
| `src/worker/wiki-http.ts` | Multipart create; `matchNodePath` tail `blob`; GET/PUT. 7th arg `blobs`. |
| `src/worker/wiki-http.test.ts` | JSON blob 400 stays. New multipart/GET/PUT/413/503/notify cases. |
| `src/worker/env.ts` | Optional `BLOBS` (`R2Bucket` min type). |
| `src/worker/index.ts` | Pass `r2BlobStore(env.BLOBS)` when bound. |
| `wrangler.jsonc` | `r2_buckets`. |
| `src/worker/mcp.ts` | `Deps.blobs`; wrap 7th arg; `nodeEnvelope` keep mime/size/filename. |
| `src/worker/mcp.test.ts` | `wiki_read` blob envelope. |
| Docs | Task 5. |

Do not modify `src/app`. Do not modify room, admin, notify kinds, Config.

---

### Task 1: Mime, filename, memory store

**Files:** create `src/lib/blob.ts`, `src/lib/blob.test.ts`, `src/worker/blobs.ts`, `src/worker/blobs.test.ts`. Modify `src/worker/env.ts` (R2 min types only if Task 3 needs them — add the `R2Bucket` typedef here so `r2BlobStore` typechecks).

- [ ] **Step 1: Failing tests**

`src/lib/blob.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BLOB_MAX_BYTES, parseMime, sanitizeFilename } from "./blob.ts";

describe("blob helpers", () => {
  it("caps at 8 MiB", () => {
    assert.equal(BLOB_MAX_BYTES, 8 * 1024 * 1024);
  });
  it("parseMime accepts type/subtype, strips params, lowercases", () => {
    assert.equal(parseMime("image/PNG; charset=x"), "image/png");
    assert.equal(parseMime("application/octet-stream"), "application/octet-stream");
  });
  it("parseMime rejects empty and junk", () => {
    assert.equal(parseMime(""), null);
    assert.equal(parseMime(null), null);
    assert.equal(parseMime("image"), null);
    assert.equal(parseMime("image/"), null);
  });
  it("sanitizeFilename takes basename, default blob, max 255", () => {
    assert.equal(sanitizeFilename("a/b/shot.png"), "shot.png");
    assert.equal(sanitizeFilename(""), "blob");
    assert.equal(sanitizeFilename(null), "blob");
    assert.equal(sanitizeFilename("x".repeat(300)).length, 255);
  });
});
```

`src/worker/blobs.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { memoryBlobStore } from "./blobs.ts";

describe("memoryBlobStore", () => {
  it("puts and gets a copy", async () => {
    const store = memoryBlobStore();
    const bytes = new Uint8Array([1, 2, 3]);
    await store.put("ws/n1", bytes);
    const got = await store.get("ws/n1");
    assert.deepEqual(got, bytes);
    bytes[0] = 9;
    assert.equal((await store.get("ws/n1"))?.[0], 1);
    assert.equal(await store.get("missing"), null);
  });
});
```

- [ ] **Step 2: Run** `node --test --experimental-strip-types src/lib/blob.test.ts src/worker/blobs.test.ts` — fail (modules missing).

- [ ] **Step 3: Implement**

`src/lib/blob.ts`:

```ts
export const BLOB_MAX_BYTES = 8 * 1024 * 1024;

export function parseMime(value: string | null | undefined): string | null {
  if (!value) return null;
  const mime = value.split(";")[0]!.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(mime)) {
    return null;
  }
  return mime;
}

export function sanitizeFilename(value: string | null | undefined): string {
  const raw = (value ?? "blob").replace(/\\/g, "/").split("/").pop() ?? "blob";
  const cleaned = raw.replace(/[\u0000-\u001f\u007f"]/g, "").trim() || "blob";
  return cleaned.slice(0, 255);
}
```

`src/worker/blobs.ts`:

```ts
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
```

Add to `src/worker/env.ts`:

```ts
export type R2ObjectBody = {
  arrayBuffer(): Promise<ArrayBuffer>;
};

export type R2Bucket = {
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  get(key: string): Promise<R2ObjectBody | null>;
};

export type Env = {
  // existing fields…
  BLOBS?: R2Bucket;
};
```

(`memoryBlobStore.put` may ignore `mime`; keep the parameter so `BlobStore` matches R2.)

- [ ] **Step 4: Re-run** — pass.

- [ ] **Step 5: Commit** `feat: blob store and mime helpers`

---

### Task 2: Wiki HTTP — multipart create, GET/PUT bytes

**Files:** modify `src/worker/wiki.ts` (`NodePatch` + `applyPatch` + D1/`memory` `updateNode`), `src/worker/wiki-http.ts`, `src/worker/wiki-http.test.ts`.

- [ ] **Step 1: Failing tests** — append to `src/worker/wiki-http.test.ts` (reuse `memberContext`, `farmBundle`, `ORIGIN`). Import `memoryBlobStore`, `BLOB_MAX_BYTES`, `memoryNotifyStore`.

Keep existing `POST payload_kind blob is 400` (JSON).

```ts
function pngFile(): File {
  return new File([new Uint8Array([1, 2, 3, 4])], "shot.png", {
    type: "image/png",
  });
}

function blobForm(extra: Record<string, string> = {}): FormData {
  const form = new FormData();
  form.set("title", extra.title ?? "Shot");
  form.set("payload_kind", extra.payload_kind ?? "blob");
  if (extra.type) form.set("type", extra.type);
  if (extra.content) form.set("content", extra.content);
  if (extra.summary) form.set("summary", extra.summary);
  if (extra.work_item_id) form.set("work_item_id", extra.work_item_id);
  if (extra.skipFile !== "1") form.set("file", pngFile());
  return form;
}

describe("handleWiki blob", () => {
  it("multipart blob without store is 503", async () => {
    const { cookie, catalog, wiki, bundle, sessions } = await memberContext();
    const res = await handleWiki(
      new Request(`${ORIGIN}/api/workspaces/${bundle.workspace.id}/nodes`, {
        method: "POST",
        headers: { cookie },
        body: blobForm(),
      }),
      env,
      sessions,
      catalog,
      wiki,
    );
    assert.equal(res.status, 503);
  });

  it("multipart blob stores bytes and metadata", async () => {
    const { cookie, catalog, wiki, bundle, sessions } = await memberContext();
    const blobs = memoryBlobStore();
    const created = await handleWiki(
      new Request(`${ORIGIN}/api/workspaces/${bundle.workspace.id}/nodes`, {
        method: "POST",
        headers: { cookie },
        body: blobForm({ content: "Front yard" }),
      }),
      env,
      sessions,
      catalog,
      wiki,
      null,
      blobs,
    );
    assert.equal(created.status, 201);
    const body = (await created.json()) as {
      node: {
        id: string;
        payload_kind: string;
        content: string;
        mime_type: string;
        byte_size: number;
        filename: string;
        blob_key: string;
        workspace_id: string;
      };
    };
    assert.equal(body.node.payload_kind, "blob");
    assert.equal(body.node.content, "Front yard");
    assert.equal(body.node.mime_type, "image/png");
    assert.equal(body.node.byte_size, 4);
    assert.equal(body.node.filename, "shot.png");
    assert.equal(
      body.node.blob_key,
      `${body.node.workspace_id}/${body.node.id}`,
    );
    const bytes = await blobs.get(body.node.blob_key);
    assert.deepEqual(bytes, new Uint8Array([1, 2, 3, 4]));

    const got = await handleWiki(
      new Request(`${ORIGIN}/api/nodes/${body.node.id}/blob`, {
        headers: { cookie },
      }),
      env,
      sessions,
      catalog,
      wiki,
      null,
      blobs,
    );
    assert.equal(got.status, 200);
    assert.equal(got.headers.get("content-type"), "image/png");
    assert.match(got.headers.get("content-disposition") ?? "", /shot\.png/);
    assert.deepEqual(new Uint8Array(await got.arrayBuffer()), new Uint8Array([1, 2, 3, 4]));
  });

  it("GET blob outsider is 403; no cookie 401", async () => {
    const { cookie, catalog, wiki, bundle, sessions } = await memberContext();
    const blobs = memoryBlobStore();
    const created = await handleWiki(
      new Request(`${ORIGIN}/api/workspaces/${bundle.workspace.id}/nodes`, {
        method: "POST",
        headers: { cookie },
        body: blobForm(),
      }),
      env,
      sessions,
      catalog,
      wiki,
      null,
      blobs,
    );
    const { node } = (await created.json()) as { node: { id: string } };
    const noCookie = await handleWiki(
      new Request(`${ORIGIN}/api/nodes/${node.id}/blob`),
      env,
      sessions,
      catalog,
      wiki,
      null,
      blobs,
    );
    assert.equal(noCookie.status, 401);
  });

  it("GET /blob on markdown node is 404", async () => {
    const { cookie, catalog, wiki, bundle, sessions } = await memberContext();
    const created = await handleWiki(
      new Request(`${ORIGIN}/api/workspaces/${bundle.workspace.id}/nodes`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ title: "Note" }),
      }),
      env,
      sessions,
      catalog,
      wiki,
    );
    const { node } = (await created.json()) as { node: { id: string } };
    const got = await handleWiki(
      new Request(`${ORIGIN}/api/nodes/${node.id}/blob`, { headers: { cookie } }),
      env,
      sessions,
      catalog,
      wiki,
      null,
      memoryBlobStore(),
    );
    assert.equal(got.status, 404);
  });

  it("PUT blob replaces bytes and enqueues node.updated", async () => {
    const { cookie, catalog, wiki, bundle, sessions } = await memberContext();
    const blobs = memoryBlobStore();
    const { notify, sent, envWithQueue } = await seedNotify(bundle);
    const created = await handleWiki(
      new Request(`${ORIGIN}/api/workspaces/${bundle.workspace.id}/nodes`, {
        method: "POST",
        headers: { cookie },
        body: blobForm(),
      }),
      envWithQueue,
      sessions,
      catalog,
      wiki,
      notify,
      blobs,
    );
    assert.equal(created.status, 201);
    const { node } = (await created.json()) as { node: { id: string; blob_key: string } };
    sent.length = 0;
    const put = await handleWiki(
      new Request(`${ORIGIN}/api/nodes/${node.id}/blob`, {
        method: "PUT",
        headers: {
          cookie,
          "content-type": "image/jpeg",
          "x-filename": "yard.jpg",
        },
        body: new Uint8Array([9, 9]),
      }),
      envWithQueue,
      sessions,
      catalog,
      wiki,
      notify,
      blobs,
    );
    assert.equal(put.status, 200);
    const patched = (await put.json()) as {
      node: { mime_type: string; byte_size: number; filename: string };
    };
    assert.equal(patched.node.mime_type, "image/jpeg");
    assert.equal(patched.node.byte_size, 2);
    assert.equal(patched.node.filename, "yard.jpg");
    assert.deepEqual(await blobs.get(node.blob_key), new Uint8Array([9, 9]));
    assert.deepEqual(sent, [
      {
        kind: "node.updated",
        node_id: node.id,
        workspace_id: "ws-farm",
      },
    ]);
  });

  it("PUT over cap is 413", async () => {
    const { cookie, catalog, wiki, bundle, sessions } = await memberContext();
    const blobs = memoryBlobStore();
    const created = await handleWiki(
      new Request(`${ORIGIN}/api/workspaces/${bundle.workspace.id}/nodes`, {
        method: "POST",
        headers: { cookie },
        body: blobForm(),
      }),
      env,
      sessions,
      catalog,
      wiki,
      null,
      blobs,
    );
    const { node } = (await created.json()) as { node: { id: string } };
    const res = await handleWiki(
      new Request(`${ORIGIN}/api/nodes/${node.id}/blob`, {
        method: "PUT",
        headers: {
          cookie,
          "content-type": "image/png",
          "content-length": String(BLOB_MAX_BYTES + 1),
        },
        body: new Uint8Array([1]),
      }),
      env,
      sessions,
      catalog,
      wiki,
      null,
      blobs,
    );
    assert.equal(res.status, 413);
  });

  it("multipart blob enqueues node.created", async () => {
    const { cookie, catalog, wiki, bundle, sessions } = await memberContext();
    const blobs = memoryBlobStore();
    const { notify, sent, envWithQueue } = await seedNotify(bundle);
    const created = await handleWiki(
      new Request(`${ORIGIN}/api/workspaces/${bundle.workspace.id}/nodes`, {
        method: "POST",
        headers: { cookie },
        body: blobForm(),
      }),
      envWithQueue,
      sessions,
      catalog,
      wiki,
      notify,
      blobs,
    );
    assert.equal(created.status, 201);
    const { node } = (await created.json()) as { node: { id: string } };
    assert.deepEqual(sent, [
      {
        kind: "node.created",
        node_id: node.id,
        workspace_id: "ws-farm",
      },
    ]);
  });
});
```

`seedNotify` already exists later in the file — place this `describe` **after** `seedNotify` is defined, or hoist `seedNotify`. If the current notify tests define `seedNotify` inside the parent `describe("handleWiki")`, put blob tests in that same describe after it.

- [ ] **Step 2: Run** `node --test --experimental-strip-types src/worker/wiki-http.test.ts` — fail (503 not implemented / 7th arg unused).

- [ ] **Step 3: Implement**

`NodePatch` in `src/worker/wiki.ts` add optional `blob_key`, `mime_type`, `byte_size`, `filename`. `applyPatch` copies them when present. D1 `updateNode` adds those SET clauses (same pattern as title). Memory store already uses `applyPatch`.

`handleWiki` signature:

```ts
export async function handleWiki(
  request: Request,
  env: Env,
  sessions: SessionStore,
  catalog: CatalogStore,
  wiki: WikiStore,
  notify: NotifyStore | null = null,
  blobs: BlobStore | null = null,
): Promise<Response>
```

`createNode`: if `(request.headers.get("content-type") ?? "").includes("multipart/form-data")` → `createBlobNode(...)`. Else existing JSON path.

`matchNodePath` tail union includes `"blob"`.

After membership + node load:

```ts
if (nodePath.tail === "blob" && request.method === "GET") {
  return getBlobBytes(node, blobs);
}
if (nodePath.tail === "blob" && request.method === "PUT") {
  return putBlobBytes(request, env, wiki, node, notify, blobs);
}
```

`createBlobNode`:

1. If `blobs` is null → 503 `{ error: "unavailable" }`.
2. `const form = await request.formData()`.
3. `payload_kind` must be the string `blob` else 400.
4. Parse title/type/summary/content (`content` strip HTML) like JSON create. `file` must be `File`/`Blob` with size > 0 else 400.
5. `parseMime(file.type)` else 400. `byte_size = file.size`; if `> BLOB_MAX_BYTES` → 413.
6. `id = newId()`, `key = `${workspaceId}/${id}``, `bytes = new Uint8Array(await file.arrayBuffer())` (re-check length).
7. `await blobs.put(key, bytes, mime)`.
8. `insertNode` with `payload_kind: "blob"`, caption in `content`, `blob_key`, `mime_type`, `byte_size`, `filename: sanitizeFilename(file.name)`.
9. Optional `work_item_id` same as JSON create.
10. `enqueueIfMatch(..., "node.created", row)`.
11. `nodeResponse(..., 201)`.

`getBlobBytes`: if `node.payload_kind !== "blob"` or !`blob_key` or !`blobs` → 404. `get` null → 404. Response: body bytes, `content-type` from D1 mime, `content-disposition: inline; filename="<sanitized>"`, `cache-control: private, max-age=300`.

`putBlobBytes`: if not blob → 400. If !`blobs` → 503. `Content-Length` parsed int > cap → 413. Read `arrayBuffer`; length 0 → 400; length > cap → 413. `parseMime(Content-Type)` else 400. Filename `X-Filename` or existing or `blob`. `put` same `blob_key` (if null, 404). `updateNode` mime/size/filename/`updated_at`. `enqueueIfMatch` `node.updated`. `nodeResponse` 200.

Do not change JSON `parseCreatePayloadKind` (blob still null → 400).

- [ ] **Step 4: Re-run** wiki-http tests — pass. `npm test`.

- [ ] **Step 5: Commit** `feat: wiki blob upload and byte routes`

---

### Task 3: Bind R2 and wire index + MCP wrap

**Files:** `wrangler.jsonc`, `src/worker/index.ts`, `src/worker/mcp.ts`.

- [ ] **Step 1: Failing test** — MCP wrap must pass `blobs` into `handleWiki`. Add in `src/worker/mcp.test.ts` after existing wiki_read tests (use `memberContext`, `insertNode` a blob row **and** `memoryBlobStore` put — but wrap does not GET `/blob`, only JSON node). This test only needs D1 row:

```ts
it("wiki_read blob caption in content[0]; envelope keeps mime, strips blob_key", async () => {
  const { sessionId, sessions, catalog, wiki, bundle } = await memberContext();
  await wiki.insertNode({
    id: "n-blob",
    workspace_id: bundle.workspace.id,
    organization_id: bundle.organization.id,
    type: "note",
    payload_kind: "blob",
    title: "Shot",
    summary: null,
    content: "Front yard",
    blob_key: "ws-farm/n-blob",
    mime_type: "image/png",
    byte_size: 4,
    filename: "shot.png",
    created_at: "2026-01-02T00:00:00.000Z",
    updated_at: "2026-01-02T00:00:00.000Z",
    pinned: 0,
  });
  const result = await toolResult(
    await handleMcp(
      callTool(sessionId, "wiki_read", { node_id: "n-blob" }),
      env,
      sessions,
      catalog,
      wiki,
    ),
  );
  assert.notEqual(result.isError, true);
  assert.equal(result.content[0]?.text, "Front yard");
  const payload = JSON.parse(result.content[1]?.text ?? "{}") as {
    node: {
      mime_type?: string;
      byte_size?: number;
      filename?: string;
      blob_key?: string;
      content?: string;
    };
  };
  assert.equal(payload.node.mime_type, "image/png");
  assert.equal(payload.node.byte_size, 4);
  assert.equal(payload.node.filename, "shot.png");
  assert.equal(payload.node.blob_key, undefined);
  assert.equal(payload.node.content, undefined);
});
```

`wiki_create` description already says do not use for blob — leave enum `markdown` \| `json`. `TOOL_NAMES` unchanged (28).

- [ ] **Step 2: Run** that test — fail (`blob_key` still stripped together with mime today).

- [ ] **Step 3: Implement**

`nodeEnvelope`: strip only `content` and `blob_key`. **Keep** `mime_type`, `byte_size`, `filename`.

`Deps` add `blobs: BlobStore`. `handleMcp` 8th arg `blobs: BlobStore = memoryBlobStore()`. `createServer` / wrap `handleWiki(..., deps.notify, deps.blobs)`. `index.ts` fetch wiki:

```ts
const blobs = env.BLOBS ? r2BlobStore(env.BLOBS) : null;
return handleWiki(request, env, store, catalog, wiki, notify, blobs);
```

Pass the same `blobs` into `handleMcp`.

`wrangler.jsonc`:

```jsonc
"r2_buckets": [
  {
    "binding": "BLOBS",
    "bucket_name": "projthread-blobs"
  }
]
```

Do **not** run `wrangler r2 bucket create` unless José asks. Local `wrangler dev` uses disk.

- [ ] **Step 4:** `npm test` — pass.

- [ ] **Step 5: Commit** `feat: bind BLOBS and mcp blob envelope`

---

### Task 4: Docs and STATUS (22a landed → open 22b)

**Files:** `docs/STATUS.md`, `docs/superpowers/plans/2026-08-26-projthread-v1.md`, `AGENTS.md`, `docs/superpowers/specs/2026-09-03-projthread-capture-design.md`, `docs/agent-facing.md`, `.grok/skills/using-projthread/SKILL.md`.

- [ ] **Step 1: STATUS Live** — wiki blob HTTP (`multipart POST` workspace nodes; `GET`/`PUT /api/nodes/:id/blob`; JSON POST blob still 400; MCP `wiki_read` caption + mime). **Now:** open **22b** `docs/superpowers/plans/2026-09-04-projthread-blob-pwa.md`. Do not start 23–24. Do not `wrangler r2 bucket create` or deploy unless José asks. Remote: json still `0008`; notify still `0009` + queue; **R2 remote bucket not created**.

- [ ] **Step 2: Index** 22a **Landed** (local bind; remote after bucket create + deploy). 22b still the next open plan.

- [ ] **Step 3: Capture spec** ordered-slices: **22** split 22a/22b with plan files.

- [ ] **Step 4: agent-facing** — blob bytes are HTTP `GET /api/nodes/:id/blob` (Bearer), not `/mcp`. Envelope mime/size/filename; `blob_key` hidden. `wiki_create` is not blob.

- [ ] **Step 5: using-projthread** — screenshot/file nodes are `payload_kind=blob`. After a knock, `wiki_read` (caption + mime). Bytes are not on MCP; do not invent a fetch tool.

- [ ] **Step 6: AGENTS.md** — Now: 22b. Nodes: v1 writes markdown, json, **or blob**. Named absences: drop unbound R2 for wiki files (transcript checkpoint still named). Free-tier table: R2 10 GB-month, 1M Class A, 10M Class B — one object per blob node, GET is Class B, no public bucket.

- [ ] **Step 7: `npm test`**. No remote bucket. No deploy.

- [ ] **Step 8: Commit** `docs: blob HTTP landed`

---

## Compact / pickup (hand to 22b)

After Task 4, **stop**. Do not open WikiPage. José may compact here.

```
22a landed locally.
Binding BLOBS / projthread-blobs (wrangler.jsonc). Remote bucket + deploy wait on José.
HTTP: multipart POST /api/workspaces/:ws/nodes (payload_kind=blob + file); GET/PUT /api/nodes/:id/blob; JSON POST blob still 400.
Notify: create 201 → node.created; PUT → node.updated.
MCP: wiki_read content[0]=caption; envelope mime_type, byte_size, filename; no blob_key; wiki_create not blob.
PWA unchanged (blob create still JSON 400 from the page).
Open plan: docs/superpowers/plans/2026-09-04-projthread-blob-pwa.md
Say execute to start 22b Task 1. One parent, TDD, no sub-agent. Do not start 23–24.
```

---

## Out of this slice (explicit)

| Deferred | Why |
| --- | --- |
| PWA create + preview | **22b** |
| Extension / share target | 23–24 |
| Remote `wrangler r2 bucket create` + deploy | Ops |
| Public bucket / Images / Stream | Spec: Worker is the gate |
| Node DELETE / R2 GC | No delete wiki yet |
| Transcript checkpoint | Named absence |

## Success

`curl` multipart creates a blob node. `GET /api/nodes/:id/blob` with the session cookie returns the bytes. Grok Bot `wiki_read` sees caption and `image/png`, not the pixels. PWA still cannot pick a file until 22b.
