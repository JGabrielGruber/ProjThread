# ProjThread PWA share target (24) — implementation plan

> For Grok Build: one session, one slice. Compact after each task. Scout only if a file is not where this plan says. Do not add tests the plan did not ask for. Stop when STATUS is updated. Do not dispatch reviewer or superpowers:subagent-driven-development sub-agents. Do not start OAuth. Do not start room MCP. Do not add CORS to the Worker. Do not run `wrangler r2 bucket create` or deploy unless José asks. Do not modify wiki HTTP, notify, MCP, or the Chrome extension unless a test proves they are broken.

**Goal:** Installed PWA is an OS **share target**. A phone share of title/text/url (and image files) lands on `/capture`, the human points a project, edits the sentence, and files the same report graph as the extension.

**Architecture:** No new catalog routes. Manifest `share_target` POSTs multipart to `/capture`. The service worker intercepts **only** that POST, parks fields+images in Cache `pt-share`, 303 to `GET /capture?share=<id>`. The landing is a first-class Vue route (cookie session, project select/create, `fileReport`). Worker `isAppHistoryPath` grows `/capture` so GET serves `index.html`. Images are `payload_kind=blob` includes. SW still must not intercept `/api/*` or WebSocket.

**Tech Stack:** Existing PWA (Vue 3, vue-router, Pinia, `apiJson` cookie). `src/lib/capture.ts` `fileReport`. `node --test --experimental-strip-types`. No new npm deps. No WXT. No iOS share polyfill. No Firefox.

Spec: `docs/superpowers/specs/2026-09-03-projthread-capture-design.md` slice **24**. Extension is **23** (landed).

---

## Locked calls (do not re-litigate)

| Topic | Call |
| --- | --- |
| Route | `/capture` (`name: "capture"`). Reserved by 23; this slice owns it. |
| Manifest | One `share_target`: `action` `/capture`, `method` `POST`, `enctype` `multipart/form-data`, params `title`/`text`/`url`, files field `media` accept `image/*`. POST covers text+url+images. Do **not** add a second GET `share_target`. |
| Landing | GET `/capture` is the form. SW 303 uses `?share=<id>` only (do **not** put 8k text in `Location`). Manual `/capture?title=&text=&url=` still prefills (tests / desktop). |
| Session | Existing PWA cookie (`credentials: include`). No Bearer paste. No OAuth. If App already shows **No session**, that is the share landing too — do not invent a principal. |
| Workspace | Session picker already in the shell. Capture does not add a second workspace control. |
| Project | Required. In-page `ProjectTree` (attach, **not** the board filter). Create: `POST /api/workspaces/:ws/projects` `{ name, parent_id }` where `parent_id` is `selectedId ?? root.id`. Then select the new id. |
| Graph | Same `fileReport` as 23. Share images go in `files[]` (title from filename, else `"Capture file"`). Do **not** use the extension `screenshot` slot for share. **No** `node_work_item`. |
| Metadata JSON | Unchanged shape `{ url, page_title, selection, viewport, captured_at }`. `url` = share url param, else first `http(s)` URL in text, else `""`. `page_title` = title or `"Capture"`. `selection` = share text (empty → null, clip 8000). `viewport` = `null`. |
| Sentence | Prefill `text` else `title` else `url`. Human edits. File disabled until sentence + project. |
| Files | Park `image/*` only. Non-images skipped. Blob 503 fails the click; **no** whole-graph retry (same as 23). Text+json without images is a valid report. |
| SW | POST `/capture` **before** the navigate branch. `/api` and WebSocket still `fetch(req)` first. Do not intercept GET `/capture`. Do not fetch `/__share/*` (page uses Cache API). |
| Worker | `isAppHistoryPath("/capture")` → `/index.html`. No new `/api`. No POST parser. No CORS. |
| Chrome | Tokens only. Capture in the rail. Hide the **filter** tree on this route (`showTree` stays kanban/wiki/room). |
| File | Single-flight. Success: **Filed** + root title. Do not `router.push` the wiki. |
| Out | Scribble, distill, iOS share target, Firefox, Web Store, CORS, in-page portal, file `<input>` on `/capture`, people picker, `/admin`, second queue, remote R2/queue/0008/0009/deploy. |

---

## File map

| Path | Job |
| --- | --- |
| `src/lib/share-target.ts` | Parse share fields, harvest/sentence, cache keys, park read/write, 303 path. |
| `src/lib/share-target.test.ts` | Parse / harvest / park roundtrip / share id. |
| `src/lib/capture.ts` | `files[]` on `fileReport`; `fileIds` on result. Keep `screenshot`. |
| `src/lib/capture.test.ts` | Files after metadata, before project. |
| `src/worker/shell.ts` | `/capture` history path. |
| `src/worker/shell.test.ts` | `/capture` → `/index.html`. |
| `src/app/public/manifest.webmanifest` | `share_target`. |
| `src/app/public/sw.js` | POST `/capture` park + 303. |
| `src/app/services/capture.ts` | Cookie `CaptureApi` (`pwaCaptureApi`). |
| `src/app/services/capture.test.ts` | Paths, credentials include, FormData. |
| `src/app/stores/capture.ts` | Projects, consume share, file. |
| `src/app/stores/capture.test.ts` | consumeShare + file graph. |
| `src/app/pages/CapturePage.vue` | Landing UI. |
| `src/app/router.ts` `App.vue` | Route, rail, hide filter tree, toast. |
| Docs | Task 5. |

Do not modify `src/extension`. Do not modify `src/worker/wiki-http.ts`. Reuse `PtButton` / `PtField` / `ProjectTree`.

---

### Task 1: Share parse + `fileReport` files

**Files:** create `src/lib/share-target.ts`, `src/lib/share-target.test.ts`; modify `src/lib/capture.ts`, `src/lib/capture.test.ts`.

- [ ] **Step 1: Failing tests**

Append to `src/lib/capture.test.ts` inside `describe("fileReport")` (keep existing tests):

```ts
  it("includes share files after metadata before project", async () => {
    const api = recordingApi();
    const result = await fileReport(api, {
      workspaceId: "ws1",
      projectId: "p1",
      sentence: "See image.",
      harvest,
      files: [
        { bytes: new Uint8Array([1, 2]), mime: "image/jpeg", filename: "shot.jpg" },
      ],
      now: () => "2026-09-04T00:00:00.000Z",
    });
    assert.equal(result.screenshotId, null);
    assert.deepEqual(result.fileIds, ["n3"]);
    assert.deepEqual(api.calls, [
      "create:markdown:Friend app:n1",
      "create:json:Capture metadata:n2",
      "include:n1:n2",
      "blob:shot.jpg:n3",
      "include:n1:n3",
      "project:n1:p1",
    ]);
  });

  it("blank file name titles Capture file", async () => {
    const api = recordingApi();
    await fileReport(api, {
      workspaceId: "ws1",
      projectId: "p1",
      sentence: "See image.",
      harvest,
      files: [{ bytes: new Uint8Array([1]), mime: "image/png", filename: "  " }],
      now: () => "2026-09-04T00:00:00.000Z",
    });
    assert.ok(api.calls.includes("blob:Capture file:n3"));
  });
```

Create `src/lib/share-target.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SHARE_CACHE,
  SHARE_FILES_FIELD,
  SHARE_PATH,
  firstHttpUrl,
  harvestFromShare,
  parseShareFields,
  parseShareId,
  readSharePark,
  shareLandingPath,
  suggestedSentence,
  writeSharePark,
} from "./share-target.ts";

function memoryCache() {
  const map = new Map<string, Response>();
  const keyOf = (request: RequestInfo | URL) => {
    const raw =
      typeof request === "string"
        ? request
        : request instanceof URL
          ? request.href
          : request.url;
    return new URL(raw, "https://pt.test").pathname;
  };
  return {
    async put(request: RequestInfo | URL, response: Response) {
      map.set(keyOf(request), response.clone());
    },
    async match(request: RequestInfo | URL) {
      const hit = map.get(keyOf(request));
      return hit?.clone();
    },
    async delete(request: RequestInfo | URL) {
      return map.delete(keyOf(request));
    },
  };
}

describe("share constants", () => {
  it("locks path, cache, and file field", () => {
    assert.equal(SHARE_PATH, "/capture");
    assert.equal(SHARE_CACHE, "pt-share");
    assert.equal(SHARE_FILES_FIELD, "media");
  });
});

describe("parseShareFields", () => {
  it("stringifies and trims", () => {
    assert.deepEqual(
      parseShareFields({ title: "  Hi  ", text: null, url: " https://a.test/ " }),
      { title: "Hi", text: "", url: "https://a.test/" },
    );
  });
});

describe("firstHttpUrl", () => {
  it("picks the first http(s) token", () => {
    assert.equal(firstHttpUrl("see https://a.test/x and more"), "https://a.test/x");
    assert.equal(firstHttpUrl("no link"), null);
  });
});

describe("harvestFromShare", () => {
  it("uses url param, else url in text; viewport null", () => {
    const harvest = harvestFromShare({
      title: "Friend",
      text: "the bug https://ignored.test/",
      url: "https://friend.test/app",
    });
    assert.deepEqual(harvest, {
      url: "https://friend.test/app",
      page_title: "Friend",
      selection: "the bug https://ignored.test/",
      viewport: null,
    });
  });
  it("extracts url from text when url param empty; blank title is Capture", () => {
    const harvest = harvestFromShare({
      title: "",
      text: "look https://b.test/z",
      url: "",
    });
    assert.equal(harvest.url, "https://b.test/z");
    assert.equal(harvest.page_title, "Capture");
  });
});

describe("suggestedSentence", () => {
  it("prefers text then title then url", () => {
    assert.equal(suggestedSentence({ title: "T", text: "Body", url: "https://a.test/" }), "Body");
    assert.equal(suggestedSentence({ title: "T", text: "", url: "https://a.test/" }), "T");
    assert.equal(suggestedSentence({ title: "", text: "", url: "https://a.test/" }), "https://a.test/");
    assert.equal(suggestedSentence({ title: "", text: "", url: "" }), "");
  });
});

describe("parseShareId / landing", () => {
  it("accepts token ids and rejects path junk", () => {
    assert.equal(parseShareId("abc-123_"), "abc-123_");
    assert.equal(parseShareId("../x"), null);
    assert.equal(parseShareId(""), null);
    assert.equal(parseShareId(null), null);
    assert.equal(shareLandingPath("abc-123_"), "/capture?share=abc-123_");
  });
});

describe("share park", () => {
  it("roundtrips fields and image bytes then deletes", async () => {
    const cache = memoryCache();
    await writeSharePark(cache, "id1", {
      title: "T",
      text: "Body",
      url: "https://a.test/",
      files: [
        { filename: "shot.jpg", mime: "image/jpeg", bytes: new Uint8Array([9, 8]) },
      ],
    });
    const got = await readSharePark(cache, "id1");
    assert.deepEqual(got, {
      title: "T",
      text: "Body",
      url: "https://a.test/",
      files: [
        { filename: "shot.jpg", mime: "image/jpeg", bytes: new Uint8Array([9, 8]) },
      ],
    });
    const again = await readSharePark(cache, "id1");
    assert.equal(again, null);
  });
});
```

- [ ] **Step 2: Run** `node --test --experimental-strip-types src/lib/share-target.test.ts src/lib/capture.test.ts`

Expected: FAIL `MODULE_NOT_FOUND` `./share-target.ts` (and fileReport `files` / `fileIds` not a function / undefined).

- [ ] **Step 3: Implement** `src/lib/share-target.ts`

```ts
import type { CaptureHarvest } from "./capture.ts";

export const SHARE_PATH = "/capture";
export const SHARE_CACHE = "pt-share";
export const SHARE_FILES_FIELD = "media";
export const SHARE_ID_QUERY = "share";

export type ShareFields = { title: string; text: string; url: string };

export type ShareFile = {
  filename: string;
  mime: string;
  bytes: Uint8Array;
};

export type SharePark = ShareFields & { files: ShareFile[] };

export type CacheLike = {
  put(request: RequestInfo | URL, response: Response): Promise<void>;
  match(request: RequestInfo | URL): Promise<Response | undefined>;
  delete(request: RequestInfo | URL): Promise<boolean>;
};

export function parseShareFields(input: {
  title?: FormDataEntryValue | string | null;
  text?: FormDataEntryValue | string | null;
  url?: FormDataEntryValue | string | null;
}): ShareFields {
  const asText = (value: FormDataEntryValue | string | null | undefined) => {
    if (typeof value !== "string") return "";
    return value.trim();
  };
  return {
    title: asText(input.title),
    text: asText(input.text),
    url: asText(input.url),
  };
}

export function firstHttpUrl(text: string): string | null {
  const match = /https?:\/\/[^\s]+/i.exec(text);
  if (!match) return null;
  const raw = match[0].replace(/[),.;]+$/g, "");
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.href;
  } catch {
    return null;
  }
}

export function harvestFromShare(fields: ShareFields): CaptureHarvest {
  const url = fields.url || firstHttpUrl(fields.text) || "";
  return {
    url,
    page_title: fields.title || "Capture",
    selection: fields.text || null,
    viewport: null,
  };
}

export function suggestedSentence(fields: ShareFields): string {
  return fields.text || fields.title || fields.url;
}

export function parseShareId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(raw)) return null;
  return raw;
}

export function shareLandingPath(id: string): string {
  return `${SHARE_PATH}?${SHARE_ID_QUERY}=${encodeURIComponent(id)}`;
}

export function shareIndexKey(id: string): string {
  return `/__share/${id}/index`;
}

export function shareFileKey(id: string, index: number): string {
  return `/__share/${id}/${index}`;
}

export async function writeSharePark(
  cache: CacheLike,
  id: string,
  park: SharePark,
): Promise<void> {
  const index = {
    title: park.title,
    text: park.text,
    url: park.url,
    files: park.files.map((file, i) => ({
      filename: file.filename,
      mime: file.mime,
      i,
    })),
  };
  await cache.put(
    shareIndexKey(id),
    new Response(JSON.stringify(index), {
      headers: { "content-type": "application/json" },
    }),
  );
  for (const [i, file] of park.files.entries()) {
    await cache.put(
      shareFileKey(id, i),
      new Response(file.bytes, {
        headers: {
          "content-type": file.mime || "application/octet-stream",
        },
      }),
    );
  }
}

export async function readSharePark(
  cache: CacheLike,
  id: string,
): Promise<SharePark | null> {
  const indexRes = await cache.match(shareIndexKey(id));
  if (!indexRes) return null;
  const index = (await indexRes.json()) as {
    title?: string;
    text?: string;
    url?: string;
    files?: { filename?: string; mime?: string; i?: number }[];
  };
  const files: ShareFile[] = [];
  for (const row of index.files ?? []) {
    const i = row.i;
    if (typeof i !== "number") continue;
    const fileRes = await cache.match(shareFileKey(id, i));
    if (!fileRes) continue;
    const buf = new Uint8Array(await fileRes.arrayBuffer());
    files.push({
      filename: typeof row.filename === "string" ? row.filename : "image",
      mime: typeof row.mime === "string" ? row.mime : "application/octet-stream",
      bytes: buf,
    });
    await cache.delete(shareFileKey(id, i));
  }
  await cache.delete(shareIndexKey(id));
  return {
    title: typeof index.title === "string" ? index.title : "",
    text: typeof index.text === "string" ? index.text : "",
    url: typeof index.url === "string" ? index.url : "",
    files,
  };
}
```

Modify `src/lib/capture.ts`:

Add to `ReportInput`:

```ts
  files?: { bytes: Uint8Array; mime: string; filename: string }[] | null;
```

Add to `ReportResult`:

```ts
  fileIds: string[];
```

In `fileReport`, after the screenshot block and **before** `linkProject`:

```ts
  const fileIds: string[] = [];
  for (const file of input.files ?? []) {
    if (!api.createBlobNode) throw new Error("blob");
    const title = file.filename.trim()
      ? rootTitle(file.filename)
      : "Capture file";
    const form = new FormData();
    form.set("title", title);
    form.set("type", "note");
    form.set("payload_kind", "blob");
    form.set(
      "file",
      new Blob([file.bytes], { type: file.mime }),
      file.filename.trim() || "file",
    );
    const node = await api.createBlobNode(input.workspaceId, form);
    fileIds.push(node.node.id);
    await api.includeNode(root.node.id, node.node.id);
  }
```

Return `{ rootId, metadataId, screenshotId, fileIds }`.

- [ ] **Step 4: Run** `node --test --experimental-strip-types src/lib/share-target.test.ts src/lib/capture.test.ts`

Expected: PASS (existing capture tests still pass; they ignore extra `fileIds`).

- [ ] **Step 5: Commit**

```bash
git add src/lib/share-target.ts src/lib/share-target.test.ts src/lib/capture.ts src/lib/capture.test.ts
git commit -m "$(cat <<'EOF'
feat: share harvest and report file includes
EOF
)"
```

---

### Task 2: Manifest, SW park, `/capture` shell

**Files:** modify `src/app/public/manifest.webmanifest`, `src/app/public/sw.js`, `src/worker/shell.ts`, `src/worker/shell.test.ts`.

- [ ] **Step 1: Failing shell test**

In `src/worker/shell.test.ts` `isAppHistoryPath` it:

```ts
    assert.equal(isAppHistoryPath("/capture"), true);
    assert.equal(isAppHistoryPath("/capture/extra"), false);
```

In `handleAppShell` rewrite list add `"/capture"`.

- [ ] **Step 2: Run** `node --test --experimental-strip-types src/worker/shell.test.ts`

Expected: FAIL `isAppHistoryPath("/capture")` is not true.

- [ ] **Step 3: Implement shell + manifest + SW**

`src/worker/shell.ts` `isAppHistoryPath`:

```ts
  if (
    pathname === "/wiki" ||
    pathname === "/config" ||
    pathname === "/capture"
  ) {
    return true;
  }
```

`src/app/public/manifest.webmanifest` — add next to `display` (keep existing icons/theme):

```json
  "share_target": {
    "action": "/capture",
    "method": "POST",
    "enctype": "multipart/form-data",
    "params": {
      "title": "title",
      "text": "text",
      "url": "url",
      "files": [
        {
          "name": "media",
          "accept": ["image/*"]
        }
      ]
    }
  },
```

Replace `src/app/public/sw.js` with:

```js
const CACHE = "pt-shell-v1";
const SHARE_CACHE = "pt-share";
const SHARE_PATH = "/capture";
const SHARE_FILES_FIELD = "media";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function parseShareId(raw) {
  if (!raw) return null;
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(raw)) return null;
  return raw;
}

async function handleSharePost(request) {
  const form = await request.formData();
  const id = crypto.randomUUID();
  const title = typeof form.get("title") === "string" ? form.get("title").trim() : "";
  const text = typeof form.get("text") === "string" ? form.get("text").trim() : "";
  const url = typeof form.get("url") === "string" ? form.get("url").trim() : "";
  const files = [];
  for (const entry of form.getAll(SHARE_FILES_FIELD)) {
    if (!(entry instanceof File)) continue;
    if (!entry.type.startsWith("image/")) continue;
    files.push(entry);
  }
  const cache = await caches.open(SHARE_CACHE);
  const index = {
    title,
    text,
    url,
    files: files.map((file, i) => ({
      filename: file.name || "image",
      mime: file.type,
      i,
    })),
  };
  await cache.put(
    `/__share/${id}/index`,
    new Response(JSON.stringify(index), {
      headers: { "content-type": "application/json" },
    }),
  );
  for (let i = 0; i < files.length; i += 1) {
    await cache.put(
      `/__share/${id}/${i}`,
      new Response(files[i], {
        headers: { "content-type": files[i].type || "application/octet-stream" },
      }),
    );
  }
  return Response.redirect(new URL(`${SHARE_PATH}?share=${id}`, request.url), 303);
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (
    url.pathname.startsWith("/api") ||
    req.headers.get("upgrade")?.toLowerCase() === "websocket"
  ) {
    event.respondWith(fetch(req));
    return;
  }
  if (req.method === "POST" && url.pathname === SHARE_PATH) {
    event.respondWith(handleSharePost(req));
    return;
  }
  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match(req)));
    return;
  }
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) await cache.put(req, res.clone());
        return res;
      }),
    );
  }
});
```

SW cannot import `src/lib/share-target.ts`. Cache key strings **must** match `shareIndexKey` / `shareFileKey` (`/__share/${id}/index`, `/__share/${id}/${i}`).

- [ ] **Step 4: Run** `node --test --experimental-strip-types src/worker/shell.test.ts src/lib/share-target.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/worker/shell.ts src/worker/shell.test.ts src/app/public/manifest.webmanifest src/app/public/sw.js
git commit -m "$(cat <<'EOF'
feat: PWA share_target parks POST on /capture
EOF
)"
```

---

### Task 3: Cookie `CaptureApi` + capture store

**Files:** create `src/app/services/capture.ts`, `src/app/services/capture.test.ts`, `src/app/stores/capture.ts`, `src/app/stores/capture.test.ts`.

- [ ] **Step 1: Failing tests**

`src/app/services/capture.test.ts`:

```ts
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { pwaCaptureApi } from "./capture.ts";

describe("pwaCaptureApi", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("POSTs cookie JSON and FormData without json content-type", async () => {
    const calls: {
      url: string;
      method: string;
      credentials: RequestCredentials | undefined;
      contentType: string | null;
      body: unknown;
    }[] = [];
    globalThis.fetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      let body: unknown = init?.body;
      if (typeof init?.body === "string") body = JSON.parse(init.body);
      calls.push({
        url: String(input),
        method: (init?.method ?? "GET").toUpperCase(),
        credentials: init?.credentials,
        contentType: headers.get("content-type"),
        body,
      });
      return Response.json({ node: { id: "n1" }, project: { id: "p2" } }, { status: 201 });
    };
    const api = pwaCaptureApi();
    await api.createNode("ws1", { title: "A", payload_kind: "markdown" });
    await api.includeNode("n1", "n2");
    await api.linkProject("n1", "p1");
    await api.refNode("n1", "old");
    const form = new FormData();
    form.set("title", "shot.jpg");
    await api.createBlobNode!("ws1", form);
    assert.equal(calls[0]?.url, "/api/workspaces/ws1/nodes");
    assert.equal(calls[0]?.credentials, "include");
    assert.equal(calls[0]?.contentType, "application/json");
    assert.equal(calls[1]?.url, "/api/nodes/n1/includes");
    assert.equal(calls[2]?.url, "/api/nodes/n1/projects");
    assert.deepEqual(calls[2]?.body, { project_id: "p1" });
    assert.equal(calls[3]?.url, "/api/nodes/n1/refs");
    assert.equal(calls[4]?.url, "/api/workspaces/ws1/nodes");
    assert.equal(calls[4]?.contentType, null);
    assert.ok(calls[4]?.body instanceof FormData);
  });
});
```

`src/app/stores/capture.test.ts`:

```ts
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createPinia, setActivePinia } from "pinia";
import { SHARE_CACHE, writeSharePark } from "../../lib/share-target.ts";
import { useCaptureStore } from "./capture.ts";

describe("capture store", () => {
  const originalFetch = globalThis.fetch;
  const originalCaches = globalThis.caches;

  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    globalThis.caches = originalCaches;
  });

  it("consumeShare reads park into harvest and files", async () => {
    const map = new Map<string, Response>();
    const cache = {
      async put(request: RequestInfo | URL, response: Response) {
        const url = typeof request === "string" ? request : String(request);
        map.set(new URL(url, "https://pt.test").pathname, response.clone());
      },
      async match(request: RequestInfo | URL) {
        const url = typeof request === "string" ? request : String(request);
        return map.get(new URL(url, "https://pt.test").pathname)?.clone();
      },
      async delete(request: RequestInfo | URL) {
        const url = typeof request === "string" ? request : String(request);
        return map.delete(new URL(url, "https://pt.test").pathname);
      },
    };
    globalThis.caches = {
      open: async (name: string) => {
        assert.equal(name, SHARE_CACHE);
        return cache as Cache;
      },
    } as CacheStorage;
    await writeSharePark(cache, "id1", {
      title: "Friend",
      text: "the bug",
      url: "https://friend.test/app",
      files: [
        { filename: "shot.jpg", mime: "image/jpeg", bytes: new Uint8Array([1]) },
      ],
    });
    const store = useCaptureStore();
    await store.consumeShare("id1");
    assert.equal(store.sentence, "the bug");
    assert.equal(store.harvest?.page_title, "Friend");
    assert.equal(store.files.length, 1);
    assert.equal(store.files[0]?.filename, "shot.jpg");
  });

  it("file POSTs markdown, json, include, blob, project", async () => {
    const posts: { url: string; body: unknown; contentType: string | null }[] = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      let body: unknown = init?.body;
      if (typeof init?.body === "string") body = JSON.parse(init.body);
      posts.push({
        url,
        body,
        contentType: headers.get("content-type"),
      });
      if (url.endsWith("/nodes") && body instanceof FormData) {
        return Response.json({ node: { id: "n3" } }, { status: 201 });
      }
      if (url.endsWith("/nodes")) {
        const kind = (body as { payload_kind?: string }).payload_kind;
        const id = kind === "json" ? "n2" : "n1";
        return Response.json({ node: { id } }, { status: 201 });
      }
      return Response.json({ ok: true }, { status: 201 });
    };
    const store = useCaptureStore();
    store.applyFields({
      title: "Friend app",
      text: "Button never enables.",
      url: "https://friend.test/app",
    });
    store.files = [
      { filename: "shot.jpg", mime: "image/jpeg", bytes: new Uint8Array([1]) },
    ];
    await store.file("ws1", "p1");
    assert.equal(store.status, "ready");
    assert.match(store.message, /^Filed /);
    assert.equal(posts[0]?.url, "/api/workspaces/ws1/nodes");
    assert.equal((posts[0]?.body as { payload_kind: string }).payload_kind, "markdown");
    assert.equal((posts[1]?.body as { payload_kind: string }).payload_kind, "json");
    assert.equal(posts[2]?.url, "/api/nodes/n1/includes");
    assert.equal(posts[3]?.url, "/api/workspaces/ws1/nodes");
    assert.equal(posts[3]?.contentType, null);
    assert.equal(posts[4]?.url, "/api/nodes/n1/includes");
    assert.equal(posts[5]?.url, "/api/nodes/n1/projects");
  });

  it("loadProjects GETs workspace projects; createProject selects new id", async () => {
    const calls: { url: string; method: string; body: unknown }[] = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      let body: unknown = init?.body;
      if (typeof init?.body === "string") body = JSON.parse(init.body);
      calls.push({ url, method, body });
      if (method === "POST") {
        return Response.json({
          project: { id: "p2", parent_id: "p1", name: "Bug" },
        }, { status: 201 });
      }
      return Response.json({
        projects: [{ id: "p1", parent_id: null, name: "Root" }],
      });
    };
    const store = useCaptureStore();
    await store.loadProjects("ws1");
    assert.equal(store.projects[0]?.id, "p1");
    await store.createProject("ws1", "Bug", "p1");
    assert.equal(store.selectedId, "p2");
    assert.equal(calls[1]?.url, "/api/workspaces/ws1/projects");
    assert.deepEqual(calls[1]?.body, { name: "Bug", parent_id: "p1" });
  });
});
```

- [ ] **Step 2: Run** `node --test --experimental-strip-types src/app/services/capture.test.ts src/app/stores/capture.test.ts`

Expected: FAIL `MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement**

`src/app/services/capture.ts`:

```ts
import type { CaptureApi } from "../../lib/capture.ts";
import { apiJson } from "./http.ts";

export function pwaCaptureApi(): CaptureApi {
  return {
    createNode: (workspaceId, body) =>
      apiJson(`/api/workspaces/${workspaceId}/nodes`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    includeNode: async (fromId, childId) => {
      await apiJson(`/api/nodes/${fromId}/includes`, {
        method: "POST",
        body: JSON.stringify({ child_id: childId }),
      });
    },
    linkProject: async (nodeId, projectId) => {
      await apiJson(`/api/nodes/${nodeId}/projects`, {
        method: "POST",
        body: JSON.stringify({ project_id: projectId }),
      });
    },
    refNode: async (fromId, toId) => {
      await apiJson(`/api/nodes/${fromId}/refs`, {
        method: "POST",
        body: JSON.stringify({ to_id: toId }),
      });
    },
    createBlobNode: (workspaceId, form) =>
      apiJson(`/api/workspaces/${workspaceId}/nodes`, {
        method: "POST",
        body: form,
      }),
  };
}
```

`src/app/stores/capture.ts`:

```ts
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import {
  fileReport,
  rootTitle,
  type CaptureHarvest,
} from "../../lib/capture.ts";
import {
  SHARE_CACHE,
  harvestFromShare,
  parseShareId,
  readSharePark,
  suggestedSentence,
  type ShareFields,
  type ShareFile,
} from "../../lib/share-target.ts";
import { ApiError } from "../services/http.ts";
import { createProject as createProjectRequest, listProjects } from "../services/catalog.ts";
import { pwaCaptureApi } from "../services/capture.ts";

export type CaptureUiStatus = "ready" | "filing" | "error";

export const useCaptureStore = defineStore("capture", () => {
  const status = ref<CaptureUiStatus>("ready");
  const message = ref("");
  const projects = ref<{ id: string; parent_id: string | null; name: string }[]>([]);
  const selectedId = ref<string | null>(null);
  const harvest = ref<CaptureHarvest | null>(null);
  const sentence = ref("");
  const nodeType = ref<"note" | "research">("note");
  const refId = ref("");
  const files = ref<ShareFile[]>([]);
  const filing = ref(false);

  const rootId = computed(
    () => projects.value.find((p) => p.parent_id == null)?.id ?? null,
  );
  const attachProjectId = computed(() => selectedId.value ?? rootId.value);

  function applyFields(fields: ShareFields): void {
    harvest.value = harvestFromShare(fields);
    sentence.value = suggestedSentence(fields);
  }

  async function consumeShare(rawId: string): Promise<void> {
    const id = parseShareId(rawId);
    if (!id) return;
    const cache = await caches.open(SHARE_CACHE);
    const park = await readSharePark(cache, id);
    if (!park) return;
    applyFields(park);
    files.value = park.files;
  }

  async function loadProjects(workspaceId: string): Promise<void> {
    const body = await listProjects(workspaceId);
    projects.value = body.projects;
  }

  async function createProject(
    workspaceId: string,
    name: string,
    parentId: string,
  ): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) return;
    const body = await createProjectRequest(workspaceId, {
      name: trimmed,
      parent_id: parentId,
    });
    await loadProjects(workspaceId);
    selectedId.value = body.project.id;
  }

  async function file(workspaceId: string, projectId: string): Promise<void> {
    const current = harvest.value ?? harvestFromShare({ title: "", text: sentence.value, url: "" });
    if (filing.value) return;
    filing.value = true;
    status.value = "filing";
    message.value = "";
    try {
      await fileReport(pwaCaptureApi(), {
        workspaceId,
        projectId,
        sentence: sentence.value,
        type: nodeType.value,
        harvest: current,
        refId: refId.value.trim() || null,
        files: files.value,
      });
      status.value = "ready";
      message.value = `Filed ${rootTitle(current.page_title)}`;
    } catch (err) {
      status.value = "error";
      if (err instanceof ApiError) {
        message.value = `Could not file ${err.status}`;
      } else {
        message.value = "Could not file";
      }
    } finally {
      filing.value = false;
    }
  }

  return {
    status,
    message,
    projects,
    selectedId,
    harvest,
    sentence,
    nodeType,
    refId,
    files,
    filing,
    attachProjectId,
    applyFields,
    consumeShare,
    loadProjects,
    createProject,
    file,
  };
});
```

- [ ] **Step 4: Run** `node --test --experimental-strip-types src/app/services/capture.test.ts src/app/stores/capture.test.ts src/lib/capture.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/services/capture.ts src/app/services/capture.test.ts src/app/stores/capture.ts src/app/stores/capture.test.ts
git commit -m "$(cat <<'EOF'
feat: PWA capture store files share graph
EOF
)"
```

---

### Task 4: `/capture` page and shell chrome

**Files:** create `src/app/pages/CapturePage.vue`; modify `src/app/router.ts`, `src/app/App.vue`.

- [ ] **Step 1: Router + page + App**

`src/app/router.ts` — add to `APP_ROUTES` and `routes`:

```ts
  { name: "capture", path: "/capture" },
```

```ts
    {
      name: "capture",
      path: "/capture",
      component: defineAsyncComponent(() => import("./pages/CapturePage.vue")),
    },
```

`src/app/pages/CapturePage.vue`:

```vue
<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import ProjectTree from "../components/ProjectTree.vue";
import PtButton from "../components/PtButton.vue";
import PtField from "../components/PtField.vue";
import { parseShareId } from "../../lib/share-target.ts";
import { useCaptureStore } from "../stores/capture.ts";
import { useSessionStore } from "../stores/session.ts";

const session = useSessionStore();
const capture = useCaptureStore();
const route = useRoute();
const router = useRouter();
const newProjectName = ref("");

const canFile = computed(
  () =>
    capture.sentence.trim().length > 0 &&
    capture.attachProjectId != null &&
    Boolean(session.workspaceId) &&
    !capture.filing,
);

async function bootFromQuery(): Promise<void> {
  const share = parseShareId(String(route.query.share ?? ""));
  if (share) {
    await capture.consumeShare(share);
  } else if (route.query.title || route.query.text || route.query.url) {
    capture.applyFields({
      title: String(route.query.title ?? ""),
      text: String(route.query.text ?? ""),
      url: String(route.query.url ?? ""),
    });
  }
  if (route.query.share || route.query.title || route.query.text || route.query.url) {
    await router.replace({ name: "capture" });
  }
}

onMounted(() => {
  void bootFromQuery();
});

watch(
  () => session.workspaceId,
  (id) => {
    if (id) void capture.loadProjects(id);
  },
  { immediate: true },
);

async function onCreateProject(): Promise<void> {
  const ws = session.workspaceId;
  const parent = capture.attachProjectId;
  if (!ws || !parent) return;
  await capture.createProject(ws, newProjectName.value, parent);
  newProjectName.value = "";
}

async function onFile(): Promise<void> {
  const ws = session.workspaceId;
  const projectId = capture.attachProjectId;
  if (!ws || !projectId) return;
  await capture.file(ws, projectId);
}
</script>

<template>
  <section class="capture">
    <h1>Capture</h1>
    <p class="hint">Share lands here. Point a project, edit the sentence, file.</p>
    <ProjectTree
      :projects="capture.projects"
      :selected-id="capture.selectedId"
      @select="capture.selectedId = $event"
    />
    <div class="row">
      <PtField
        v-model="newProjectName"
        label="New project"
        name="project-name"
        placeholder="Name"
      />
      <PtButton
        type="button"
        :disabled="!newProjectName.trim() || !capture.attachProjectId"
        @click="onCreateProject"
      >
        Create
      </PtButton>
    </div>
    <PtField as="select" v-model="capture.nodeType" label="Type" name="type">
      <option value="note">note</option>
      <option value="research">research</option>
    </PtField>
    <PtField
      as="textarea"
      v-model="capture.sentence"
      label="Sentence"
      name="sentence"
      required
    />
    <PtField
      v-model="capture.refId"
      label="Ref"
      name="ref"
      placeholder="optional node id"
    />
    <p v-if="capture.files.length" class="hint">
      {{ capture.files.length }} image{{ capture.files.length === 1 ? "" : "s" }} from share
    </p>
    <PtButton
      variant="primary"
      type="button"
      :disabled="!canFile"
      @click="onFile"
    >
      File
    </PtButton>
    <p
      v-if="capture.message"
      class="status"
      :class="capture.status === 'error' ? 'danger' : 'muted'"
    >
      {{ capture.message }}
    </p>
  </section>
</template>

<style scoped>
.capture {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  max-width: 32rem;
  padding: 1rem 1.25rem 2rem;
  color: var(--fg);
  font-family: var(--font);
}
h1 {
  margin: 0;
  font-size: 1.25rem;
}
.hint,
.status {
  margin: 0;
  font-size: 0.8125rem;
}
.hint,
.status.muted {
  color: var(--muted);
}
.status.danger {
  color: var(--danger);
}
.row {
  display: flex;
  gap: 0.5rem;
  align-items: stretch;
}
.row input {
  min-width: 0;
  flex: 1;
}
</style>
```

Style `.row input` only (no `:deep` — Lightning CSS rejected it on the extension popup).

`src/app/App.vue` edits (do not rewrite the file):

1. Import `useCaptureStore`. `const capture = useCaptureStore();`
2. `showTree` stays `kanban` / `wiki` / `room` only (do **not** add `capture`).
3. `const captureNav = computed(() => route.name === "capture");`
4. Toast: after the config branch, add:

```ts
  if (route.name === "capture") {
    if (capture.status === "filing") return { message: "Filing", tone: "info" as const };
    if (capture.status === "error") {
      return { message: capture.message || "Could not file", tone: "error" as const };
    }
    return { message: "", tone: "info" as const };
  }
```

5. `async function openCapture(): Promise<void> { await router.replace({ name: "capture" }); }`
6. In the rail, after the Wiki button, before Config:

```vue
        <button
          type="button"
          class="nav-btn"
          :class="{ 'is-active': captureNav }"
          :aria-current="captureNav ? 'page' : undefined"
          @click="openCapture"
        >
          Capture
        </button>
```

- [ ] **Step 2:** `npm test`

Expected: PASS. Then `npm run build:app` — PASS (no Lightning `:deep` warning). Manifest in `dist/manifest.webmanifest` contains `"share_target"`. `dist/sw.js` contains `POST` and `pt-share`.

If wrangler + a browser are available, open `/capture` with a session: empty form, project tree, File disabled until sentence. `GET /capture?text=hello` prefills. Android share sheet is the product bar and may be unverified this session — say so. Do not add CORS to make a desktop fetch look like share.

- [ ] **Step 3: Commit**

```bash
git add src/app/pages/CapturePage.vue src/app/router.ts src/app/App.vue
git commit -m "$(cat <<'EOF'
feat: PWA /capture share landing
EOF
)"
```

---

### Task 5: Docs and STATUS (24 landed)

**Files:** `docs/STATUS.md`, `docs/superpowers/plans/2026-08-26-projthread-v1.md`, `AGENTS.md`, `docs/superpowers/specs/2026-09-03-projthread-capture-design.md`, `.grok/skills/using-projthread/SKILL.md`.

- [ ] **Step 1: STATUS Live** — add PWA share target (manifest `share_target` POST; SW parks images+fields; `/capture` landing; cookie session; project select/create; same report graph; image blobs). **Now:** no open slice. **Next:** none named (capture spec ends at 24). Do not start OAuth / room MCP / CORS / remote R2 / queue / `0008`/`0009` / deploy unless José asks.

- [ ] **Step 2: Index** plan **24** row: `2026-09-04-projthread-capture-share.md` **Landed**. Index **Now:** no open slice; do not start 24 (done).

- [ ] **Step 3: Capture spec** slice **24** plan file + **Landed**. Files after 22 included.

- [ ] **Step 4: AGENTS Now** — no open slice. Capture clients: extension + share target landed. Do not add CORS. Do not start a slice STATUS does not name.

- [ ] **Step 5: using-projthread** — humans may file from the installed PWA share sheet (session cookie, not MCP) as well as the Chrome extension. Knock is still `node.created` / `node.included`; `wiki_read` the root, then includes.

- [ ] **Step 6:** `npm test && npm run build:app`.

- [ ] **Step 7: Commit** `docs: PWA share target landed`

---

## Compact / pickup

After Task 5, **stop**.

```
24 landed locally.
PWA share_target POST /capture. SW parks fields+image/* in pt-share, 303 ?share=.
Cookie session. /capture form: project select/create, sentence, fileReport graph.
Images as blob includes. No CORS. No new /api. No iOS share. No scribble.
Tests + build:app. Android share sheet may be unverified.
Next: none named (capture spec complete). Do not invent 25.
Do not wrangler r2 bucket create / queues create / apply remote 0008/0009 / deploy unless José asks.
Pickup: AGENTS.md → docs/STATUS.md. If José names the next slice, write that plan only. One parent, TDD, no sub-agent.
```

---

## Out of this slice (explicit)

| Deferred | Why |
| --- | --- |
| iOS / Safari share | No Web Share Target |
| GET `share_target` | POST covers text+url+files |
| File picker on `/capture` | OS share is the ingest path |
| Scribble / distill | Named absences |
| Firefox / Web Store | Unpacked / installed PWA is v1 |
| CORS on `/api` | Same origin |
| Extension edits | 23 landed |
| Remote R2 / queue / 0008 / 0009 / deploy | Ops |

## Success

A human on Android shares a URL or image to installed ProjThread, lands on `/capture` (not the kanban), points a project, files in a few seconds. Grok Bot still wakes on `node.created` / `node.included`. The board does not fill with dumps.
