# ProjThread blob quota (25) — implementation plan

> For Grok Build: one session, one slice. Compact after STATUS. Scout only if a file is not where this plan says. Do not add tests the plan did not ask for. Stop when STATUS is updated. Do not dispatch reviewer or superpowers:subagent-driven-development sub-agents. Do not start OAuth. Do not start room MCP. Do not bind Images. Do not add client sliders. Do not add node DELETE. Do not run `wrangler r2 bucket create` or deploy unless José asks. José wants this **landed before** enabling R2 on the account.

**Goal:** D1 soft-locks blob **create** so stored bytes and file count stay under Cloudflare’s free R2 band. No replace. GET unchanged.

**Architecture:** After the 8 MiB object cap and before `blobs.put`, one account-grain D1 read (`COUNT` + `SUM(byte_size)` of blob rows with a `blob_key`). Over → 507 `{ error: "quota" }` and no put. `PUT /api/nodes/:id/blob` → 405. Imprecise on purpose (races, orphans). Tests seed D1/memory rows; they do not allocate 4 GiB.

**Tech Stack:** Existing Worker + D1 + `BLOB_MAX_BYTES`. No new binding. No new npm deps. `node --test --experimental-strip-types`.

José: lock before R2 enable. Client compress/scale and project/age cleanup are vision, not this slice.

---

## Locked calls (do not re-litigate)

| Topic | Call |
| --- | --- |
| Per file | Keep **8 MiB** `BLOB_MAX_BYTES` → **413** `{ error: "too_large" }`. |
| Stored bytes | `SUM(byte_size) + incoming ≤ 4 GiB` (`BLOB_MAX_STORED_BYTES`). Account grain. |
| Files / Class A | `COUNT(*) + 1 ≤ 4096` (`BLOB_MAX_COUNT`). No replace ⇒ count ≈ our Class A. |
| Who counts | `payload_kind = 'blob' AND blob_key IS NOT NULL`. Markdown/json and keyless rows do not. |
| Over | **507** `{ error: "quota" }`. Not `too_large`. No `put`. |
| Replace | `PUT /api/nodes/:id/blob` → **405** `{ error: "method_not_allowed" }`, `Allow: GET`. Delete `putBlobBytes`. |
| GET | Unchanged. No Class B ledger. |
| Equality | `used + incoming === cap` is allowed. `>` refuses. |
| Out | Images, client sliders, node DELETE, PWA copy, MCP tools, second queue, remote bucket create, deploy. |

---

## File map

| Path | Job |
| --- | --- |
| `src/lib/blob.ts` | Caps + `exceedsBlobQuota`. |
| `src/lib/blob.test.ts` | Cap numbers + quota predicate. |
| `src/worker/wiki.ts` | `WikiStore.blobUsage`; D1 + memory. |
| `src/worker/wiki.test.ts` | Memory usage counts only keyed blobs. |
| `src/worker/wiki-http.ts` | Check before put; 405 PUT; remove `putBlobBytes`. |
| `src/worker/wiki-http.test.ts` | 507 SUM, 507 COUNT, 405 PUT; drop PUT 200/413. |
| Docs | STATUS, index, AGENTS, agent-facing GET-only bytes. |

---

### Task 1: Caps and predicate

**Files:** `src/lib/blob.ts`, `src/lib/blob.test.ts`.

- [ ] **Step 1: Failing tests** — append to `src/lib/blob.test.ts`:

```ts
import {
  BLOB_MAX_BYTES,
  BLOB_MAX_COUNT,
  BLOB_MAX_STORED_BYTES,
  exceedsBlobQuota,
} from "./blob.ts";

it("stored and count caps sit under the free R2 band", () => {
  assert.equal(BLOB_MAX_BYTES, 8 * 1024 * 1024);
  assert.equal(BLOB_MAX_COUNT, 4096);
  assert.equal(BLOB_MAX_STORED_BYTES, 4 * 1024 * 1024 * 1024);
});
it("exceedsBlobQuota is exclusive at the cap", () => {
  assert.equal(exceedsBlobQuota({ count: 4095, bytes: 0 }, 1), false);
  assert.equal(exceedsBlobQuota({ count: 4096, bytes: 0 }, 1), true);
  assert.equal(
    exceedsBlobQuota({ count: 0, bytes: BLOB_MAX_STORED_BYTES }, 0),
    false,
  );
  assert.equal(
    exceedsBlobQuota({ count: 0, bytes: BLOB_MAX_STORED_BYTES }, 1),
    true,
  );
});
```

- [ ] **Step 2: Run** `node --test --experimental-strip-types src/lib/blob.test.ts` — fail on missing exports.

- [ ] **Step 3: Implement** in `src/lib/blob.ts`:

```ts
export const BLOB_MAX_BYTES = 8 * 1024 * 1024;
export const BLOB_MAX_COUNT = 4096;
export const BLOB_MAX_STORED_BYTES = 4 * 1024 * 1024 * 1024;

export type BlobUsage = { count: number; bytes: number };

export function exceedsBlobQuota(
  usage: BlobUsage,
  incomingBytes: number,
): boolean {
  return (
    usage.count + 1 > BLOB_MAX_COUNT ||
    usage.bytes + incomingBytes > BLOB_MAX_STORED_BYTES
  );
}
```

Keep `parseMime` / `sanitizeFilename`.

---

### Task 2: `blobUsage` on the wiki store

**Files:** `src/worker/wiki.ts`, `src/worker/wiki.test.ts`.

- [ ] **Step 1: Failing test** — append in `src/worker/wiki.test.ts`:

```ts
it("blobUsage counts keyed blobs only, account grain", async () => {
  const wiki = memoryWikiStore();
  await wiki.insertNode(farmNote());
  await wiki.insertNode(
    farmNote({
      id: "b-null",
      payload_kind: "blob",
      blob_key: null,
      byte_size: 99,
    }),
  );
  await wiki.insertNode(
    farmNote({
      id: "b1",
      workspace_id: "ws-other",
      payload_kind: "blob",
      blob_key: "ws-other/b1",
      byte_size: 10,
    }),
  );
  await wiki.insertNode(
    farmNote({
      id: "b2",
      payload_kind: "blob",
      blob_key: "ws-1/b2",
      byte_size: 5,
    }),
  );
  assert.deepEqual(await wiki.blobUsage(), { count: 2, bytes: 15 });
});
```

- [ ] **Step 2: Run** `node --test --experimental-strip-types src/worker/wiki.test.ts` — fail.

- [ ] **Step 3: Implement**

On `WikiStore`:

```ts
blobUsage(): Promise<{ count: number; bytes: number }>;
```

`d1WikiStore` (after `getNode`):

```ts
async blobUsage() {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count, COALESCE(SUM(byte_size), 0) AS bytes
FROM node
WHERE payload_kind = 'blob' AND blob_key IS NOT NULL`,
    )
    .first<{ count: number; bytes: number }>();
  return {
    count: Number(row?.count ?? 0),
    bytes: Number(row?.bytes ?? 0),
  };
},
```

`memoryWikiStore` (after `getNode`):

```ts
async blobUsage() {
  let count = 0;
  let bytes = 0;
  for (const row of nodes.values()) {
    if (row.payload_kind !== "blob" || !row.blob_key) continue;
    count += 1;
    bytes += row.byte_size ?? 0;
  }
  return { count, bytes };
},
```

---

### Task 3: HTTP — 507 before put, 405 PUT

**Files:** `src/worker/wiki-http.ts`, `src/worker/wiki-http.test.ts`.

- [ ] **Step 1: Failing tests** — in `describe("handleWiki blob")`:

Replace `PUT blob replaces bytes and enqueues node.updated` and `PUT over cap is 413` with:

```ts
it("PUT blob is 405; bytes unchanged", async () => {
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
  assert.equal(created.status, 201);
  const { node } = (await created.json()) as {
    node: { id: string; blob_key: string };
  };
  const put = await handleWiki(
    new Request(`${ORIGIN}/api/nodes/${node.id}/blob`, {
      method: "PUT",
      headers: { cookie, "content-type": "image/jpeg" },
      body: new Uint8Array([9, 9]),
    }),
    env,
    sessions,
    catalog,
    wiki,
    null,
    blobs,
  );
  assert.equal(put.status, 405);
  const body = (await put.json()) as { error: string };
  assert.equal(body.error, "method_not_allowed");
  assert.deepEqual(await blobs.get(node.blob_key), new Uint8Array([1, 2, 3, 4]));
});

it("multipart over stored quota is 507 and does not put", async () => {
  const { cookie, catalog, wiki, bundle, sessions } = await memberContext();
  const blobs = memoryBlobStore();
  await wiki.insertNode({
    id: "fat",
    workspace_id: bundle.workspace.id,
    organization_id: bundle.organization.id,
    type: "note",
    payload_kind: "blob",
    title: "fat",
    summary: null,
    content: null,
    blob_key: `${bundle.workspace.id}/fat`,
    mime_type: "image/png",
    byte_size: BLOB_MAX_STORED_BYTES,
    filename: "fat.png",
    created_at: "2026-01-02T00:00:00.000Z",
    updated_at: "2026-01-02T00:00:00.000Z",
    pinned: 0,
  });
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
  assert.equal(created.status, 507);
  const body = (await created.json()) as { error: string };
  assert.equal(body.error, "quota");
  assert.equal((await wiki.listNodes(bundle.workspace.id)).length, 1);
});

it("multipart over file count is 507", async () => {
  const { cookie, catalog, wiki, bundle, sessions } = await memberContext();
  const blobs = memoryBlobStore();
  const now = "2026-01-02T00:00:00.000Z";
  for (let i = 0; i < BLOB_MAX_COUNT; i++) {
    await wiki.insertNode({
      id: `c${i}`,
      workspace_id: bundle.workspace.id,
      organization_id: bundle.organization.id,
      type: "note",
      payload_kind: "blob",
      title: "c",
      summary: null,
      content: null,
      blob_key: `${bundle.workspace.id}/c${i}`,
      mime_type: "image/png",
      byte_size: 1,
      filename: "c.png",
      created_at: now,
      updated_at: now,
      pinned: 0,
    });
  }
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
  assert.equal(created.status, 507);
});
```

Import `BLOB_MAX_COUNT`, `BLOB_MAX_STORED_BYTES` next to `BLOB_MAX_BYTES`.

- [ ] **Step 2: Run** `node --test --experimental-strip-types src/worker/wiki-http.test.ts` — PUT 200/413 fail; 507 missing.

- [ ] **Step 3: Implement**

`wiki-http.ts` blob PUT branch:

```ts
if (nodePath.tail === "blob" && request.method === "PUT") {
  return Response.json(
    { error: "method_not_allowed" },
    { status: 405, headers: { allow: "GET" } },
  );
}
```

Delete `putBlobBytes`.

In `createBlobNode`, after the `bytes.byteLength > BLOB_MAX_BYTES` 413 and before `blobs.put`:

```ts
const usage = await wiki.blobUsage();
if (exceedsBlobQuota(usage, bytes.byteLength)) {
  return Response.json({ error: "quota" }, { status: 507 });
}
```

Import `exceedsBlobQuota` from `../lib/blob.ts`. Keep work-item checks; quota may sit immediately before `put`.

- [ ] **Step 4: Run** `npm test`.

---

### Task 4: Docs

- [ ] `docs/STATUS.md` — 25 landed local. Still no R2 on account. José may enable R2, then bucket + deploy. Plan none.
- [ ] `docs/superpowers/plans/2026-08-26-projthread-v1.md` — add 25; stop “do not invent 25”.
- [ ] `AGENTS.md` — same. Do not invent 26. Still do not `wrangler r2 bucket create` unless José asks.
- [ ] `docs/agent-facing.md` — blob bytes GET only (PUT gone).
- [ ] 22a plan stays historical; PUT in 22a is superseded by 25.

---

## Out

Client compress/scale sliders. Cloudflare Images. Node DELETE / project sweep / age. Class B GET ledger. Custom-domain Deploy. Enabling R2 in the dashboard (José).
