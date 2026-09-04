# ProjThread blob PWA (22b) — implementation plan

> For Grok Build: one session, one slice. Compact after each task. Scout only if a file is not where this plan says. Do not add tests the plan did not ask for. Stop when STATUS is updated. Do not dispatch reviewer or superpowers:subagent-driven-development sub-agents. Do not start OAuth. Do not start room MCP. Do not start 23–24. Do not run `wrangler r2 bucket create` or deploy unless José asks. **Do not reopen 22a HTTP** unless a test proves it is broken.

**Goal:** Wiki PWA can create a blob node (file + caption) and preview by mime.

**Architecture:** Same session cookie. Create uses `FormData` against the 22a multipart route (`apiJson` must not force `application/json` on `FormData`). Reader: `image/*` → `<img src="/api/nodes/:id/blob">` (cookie on same origin); else a download link. Edit stays caption/title PATCH. No file replace UI (PUT exists in 22a for clients).

**Tech Stack:** Vue 3 wiki page + store + `apiJson`. `node --test` on the store. No new kit. No extension. No share target.

Spec: capture slice **22b**. Depends on **22a** landed.

---

## Pickup (after 22a — compact here)

22a is HTTP only. Before this plan:

- `BLOBS` / `projthread-blobs` in `wrangler.jsonc`
- Multipart `POST /api/workspaces/:ws/nodes` (`payload_kind=blob`, field `file`)
- `GET`/`PUT /api/nodes/:id/blob`
- JSON `POST` blob still **400**
- MCP `wiki_read` caption + mime; `wiki_create` not blob

If STATUS still says 22a is open, **stop** and execute 22a instead.

---

## Locked calls (do not re-litigate)

| Topic | Call |
| --- | --- |
| Create | Kind `blob` in the existing Create modal: file input + caption textarea. `FormData` POST. No JSON blob from the PWA. |
| Preview | `image/*` → `<img class="wiki-blob">`. Else filename + mime + size + `<a download>`. Caption under, markdown-rendered if present. |
| Edit | Title + caption only (existing PATCH). Hide source textarea for replacing bytes. |
| `apiJson` | If `body instanceof FormData`, do **not** set `content-type` (boundary). |
| Auth | Cookie `credentials: "include"` (already). `<img src>` same origin sends the cookie. |
| Out | File replace UI, scribble, extension, share target, people picker, `/admin`. |

---

## File map

| Path | Job |
| --- | --- |
| `src/app/services/http.ts` | Skip JSON content-type on `FormData`. |
| `src/app/models/wiki.ts` | `WikiNode` mime fields; `WikiCreate` kind `blob`; `WikiBlobCreate`. |
| `src/app/services/wiki.ts` | `createBlobNode(workspaceId, form)`. |
| `src/app/stores/wiki.ts` + `wiki.test.ts` | `createBlobNode`; do not JSON-stringify the file. |
| `src/app/pages/WikiPage.vue` | Kind `blob`; file input; preview-by-mime. |
| Docs | Task 3. |

Do not modify Worker routes. Do not bind a second bucket.

---

### Task 1: Store + FormData POST

**Files:** `src/app/services/http.ts`, `src/app/models/wiki.ts`, `src/app/services/wiki.ts`, `src/app/stores/wiki.ts`, `src/app/stores/wiki.test.ts`.

- [ ] **Step 1: Failing tests** in `src/app/stores/wiki.test.ts`:

```ts
it("createBlobNode POSTs FormData without json content-type", async () => {
  const posts: { url: string; contentType: string | null; isForm: boolean }[] =
    [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (url === "/api/workspaces/ws1/nodes" && method === "GET") {
      return Response.json({ nodes: [] });
    }
    if (url === "/api/workspaces/ws1/nodes" && method === "POST") {
      const headers = new Headers(init?.headers);
      posts.push({
        url,
        contentType: headers.get("content-type"),
        isForm: init?.body instanceof FormData,
      });
      return Response.json(
        {
          node: {
            id: "n-blob",
            workspace_id: "ws1",
            organization_id: "o1",
            type: "note",
            payload_kind: "blob",
            title: "Shot",
            summary: null,
            content: "Yard",
            mime_type: "image/png",
            byte_size: 4,
            filename: "shot.png",
            created_at: "2026-01-01T00:00:00.000Z",
            updated_at: "2026-01-01T00:00:00.000Z",
            pinned: 0,
          },
          work_item_ids: [],
        },
        { status: 201 },
      );
    }
    throw new Error(`unexpected fetch ${method} ${url}`);
  };
  const store = useWikiStore();
  await store.loadList("ws1");
  const form = new FormData();
  form.set("title", "Shot");
  form.set("payload_kind", "blob");
  form.set("content", "Yard");
  form.set("file", new File([new Uint8Array([1, 2, 3, 4])], "shot.png", {
    type: "image/png",
  }));
  await store.createBlobNode(form);
  assert.equal(posts.length, 1);
  assert.equal(posts[0]?.isForm, true);
  assert.equal(posts[0]?.contentType, null);
  assert.equal(store.node?.payload_kind, "blob");
  assert.equal(store.node?.filename, "shot.png");
});
```

- [ ] **Step 2: Run** `node --test --experimental-strip-types src/app/stores/wiki.test.ts` — fail (`createBlobNode is not a function`).

- [ ] **Step 3: Implement**

`apiJson`:

```ts
if (
  init.body != null &&
  !headers.has("content-type") &&
  !(typeof FormData !== "undefined" && init.body instanceof FormData)
) {
  headers.set("content-type", "application/json");
}
```

`WikiNode` add optional `mime_type: string | null`, `byte_size: number | null`, `filename: string | null`.

`src/app/services/wiki.ts`:

```ts
export function createBlobNode(
  workspaceId: string,
  form: FormData,
): Promise<NodePayload> {
  return apiJson(`/api/workspaces/${workspaceId}/nodes`, {
    method: "POST",
    body: form,
  });
}
```

Store method `createBlobNode(form)` — same success path as `createNode` (set `node`, list row, includes/refs).

- [ ] **Step 4: Re-run** store tests — pass.

- [ ] **Step 5: Commit** `feat: wiki store blob FormData create`

---

### Task 2: WikiPage create + preview

**Files:** `src/app/pages/WikiPage.vue`.

- [ ] **Step 1: No new page test file.** Store tests are the automated bar. Implement the page.

- [ ] **Step 2: WikiPage**

`PAYLOAD_KINDS = ["markdown", "json", "blob"]`.

`draftFile = ref<File | null>(null)`.

Create form: when `draftKind === "blob"`, hide the markdown/json content field; show `<input type="file">` (`@change` set `draftFile`) and caption `PtField` textarea. Submit: if blob and no file, return; build `FormData` (`title`, `type`, `payload_kind=blob`, `content`, optional `work_item_id`, `file`); `wiki.createBlobNode(form)`. Else existing `createNode`.

Reader (not editing):

```vue
<template v-if="wiki.node.payload_kind === 'json'">
  <pre class="wiki-json">{{ jsonPretty }}</pre>
</template>
<template v-else-if="wiki.node.payload_kind === 'blob'">
  <img
    v-if="blobIsImage"
    class="wiki-blob"
    :src="blobSrc"
    :alt="wiki.node.title"
  />
  <p v-else class="wiki-blob-file">
    <a :href="blobSrc" :download="wiki.node.filename ?? undefined">{{
      wiki.node.filename ?? "Download"
    }}</a>
    <span class="muted">{{ wiki.node.mime_type }} · {{ wiki.node.byte_size }}</span>
  </p>
  <article v-if="wiki.node.content" class="wiki-read" v-html="rendered" />
</template>
<article v-else class="wiki-read" v-html="rendered" />
```

```ts
const blobSrc = computed(() =>
  wiki.node ? `/api/nodes/${wiki.node.id}/blob` : "",
);
const blobIsImage = computed(() =>
  (wiki.node?.mime_type ?? "").startsWith("image/"),
);
```

Edit: if blob, caption label (not “Source”); do not add a replace-file input.

CSS: `.wiki-blob { max-width: 100%; height: auto; }` using existing tokens, no hardcoded colors.

- [ ] **Step 3:** `npm run build:app`. If `wrangler dev` is up, open `/wiki`, create blob, confirm image preview and non-image download. If no browser this session, say so; store tests + build are the automated bar.

- [ ] **Step 4: Commit** `feat: wiki pwa blob create and preview`

---

### Task 3: Docs and STATUS (22b landed)

**Files:** `docs/STATUS.md`, `docs/superpowers/plans/2026-08-26-projthread-v1.md`, `AGENTS.md`, `docs/superpowers/specs/2026-09-03-projthread-capture-design.md`.

- [ ] **Step 1: STATUS Live** — PWA wiki blob create + preview-by-mime. **Now:** no open slice. **Next:** write plan **23** extension (not written). Do not start 23–24. Do not remote-create the R2 bucket or deploy unless José asks.

- [ ] **Step 2: Index** 22b **Landed**. 23–24 unwritten.

- [ ] **Step 3: Capture spec** 22b plan file on the 22b row.

- [ ] **Step 4: AGENTS Now** — no open slice. Do not start 23–24 unless STATUS names them.

- [ ] **Step 5: `npm test` && `npm run build:app`**.

- [ ] **Step 6: Commit** `docs: blob PWA landed`

---

## Out of this slice (explicit)

| Deferred | Why |
| --- | --- |
| Extension | **23** |
| Share target (text then media) | **24** |
| Scribble / screenshot chrome | Extension |
| Replace-file control | PUT exists; not this UI |
| Remote bucket create + deploy | Ops |

## Success

José picks a PNG in Wiki Create, files it, sees the image on the node. A PDF shows a download link and the caption. The Bot still only sees caption + mime on `wiki_read`.
