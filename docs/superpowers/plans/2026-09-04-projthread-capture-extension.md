# ProjThread capture extension (23) — implementation plan

> For Grok Build: one session, one slice. Compact after each task. Scout only if a file is not where this plan says. Do not add tests the plan did not ask for. Stop when STATUS is updated. Do not dispatch reviewer or superpowers:subagent-driven-development sub-agents. Do not start OAuth. Do not start room MCP. Do not start **24** (share target). Do not add CORS to the Worker. Do not run `wrangler r2 bucket create` or deploy unless José asks. Do not modify wiki HTTP, notify, or the PWA wiki page unless a test proves they are broken.

**Goal:** Chrome MV3 extension files a wiki **report graph** from a foreign page: session once, project select/create, markdown root + json metadata + `includes` + `node_project`, optional screenshot blob.

**Architecture:** No new Worker surface. Popup is the client (not an in-page portal). Cookie cannot leave our origin, so the popup uses **Bearer** (`Authorization: Bearer <session.id>` from Admin → Issue token) against a **configured origin**. Graph write lives in `src/lib/capture.ts` (node:test). Vue popup reuses tokens + `PtButton` / `PtField` / `ProjectTree`. `activeTab` + `scripting` harvest URL/title/selection; `captureVisibleTab` is best-effort PNG. Host access is `optional_host_permissions` requested for that origin (Chrome bypasses CORS; do not open `/api` to the web).

**Tech Stack:** Chrome MV3, Vue 3 + Vite (`src/extension`, `dist/extension`). Existing `/api/*`. `node --test --experimental-strip-types`. No new npm deps. No `@types/chrome`. No WXT. No Firefox. No Workers AI.

Spec: `docs/superpowers/specs/2026-09-03-projthread-capture-design.md` slice **23**. Share target is **24**.

---

## Locked calls (do not re-litigate)

| Topic | Call |
| --- | --- |
| Client | Chrome MV3 **action popup**. No content_scripts. No overlay on the host page (named absence: in-page portal). |
| Auth | Paste **origin** + **session id** once. Persist `chrome.storage.local`. `GET /api/me` with Bearer. No cookie. No OAuth. |
| Origin | `http` or `https` origin only (no path/query/hash). Never a hostname literal in TS. Manifest uses `optional_host_permissions: ["http://*/*","https://*/*"]`; on save, `chrome.permissions.request({ origins: [origin + "/*"] })`. |
| CORS | **Do not** add `Access-Control-*` on the Worker. |
| Workspace | `me.workspace_id` if set; else the sole membership; else a `<select>` then `PATCH /api/me`. |
| Project | Required. Tree select (root allowed). Create: `POST /api/workspaces/:ws/projects` `{ name, parent_id }` where `parent_id` is the selected project or the forest root. Then select the new id. |
| Graph | 1) POST markdown root (`type` note\|research, `content` = sentence, `summary` = first line clipped). 2) POST json metadata. 3) `POST /api/nodes/:root/includes` `{ child_id }`. 4) optional screenshot blob + include. 5) `POST /api/nodes/:root/projects` `{ project_id }`. 6) optional `POST .../refs` `{ to_id }`. **No** `node_work_item`. |
| Metadata JSON | `{ url, page_title, selection, viewport, captured_at }`. `selection` null if empty; clip to 8000 chars. Object only. |
| Title | Page title, or `"Capture"` if blank; clip 200 UTF-8 bytes. Metadata node title `"Capture metadata"`. Screenshot title `"Capture screenshot"`. |
| Screenshot | Checkbox, default on. `captureVisibleTab` PNG after the user opened the popup. Failure (chrome://, 503 BLOBS) → still file text+json; muted note. No scribble. |
| Distill | Out. |
| File | Single-flight. Success copy: **Filed** (root title). Do not `window.open` the board. |
| Chrome | `src/styles/tokens.css`. No hardcoded colors. Popup ~22rem, phone-calm. |
| Out | Share target (24), scribble, CORS, Worker/MCP/PWA wiki edits, second queue, people picker, `/admin` in the extension, Chrome Web Store, Firefox. |

---

## File map

| Path | Job |
| --- | --- |
| `src/lib/capture.ts` | `parseOrigin`, harvest clip, `fileReport`, `pngFromDataUrl`. |
| `src/lib/capture.test.ts` | Origin / graph order / skip screenshot / png parse. |
| `src/lib/capture-http.ts` | Bearer `apiJson` + `captureApi(creds)`. |
| `src/lib/capture-http.test.ts` | Paths, Bearer header, FormData has no JSON content-type. |
| `src/extension/vite.config.ts` | Multi-page: `popup.html`; `entryFileNames: "[name].js"`; `base: "./"`; out `dist/extension`. |
| `src/extension/manifest.json` | MV3 as locked. |
| `src/extension/popup.html` `main.ts` `Popup.vue` | Client UI. |
| `src/extension/chrome-min.d.ts` | Minimal `chrome` typing. |
| `src/extension/public/icons/` | Copy of app 192/512 (build publicDir). |
| `package.json` | `build:extension`. Do not fold into `wrangler deploy`. |
| Docs | Task 5. |

Do not modify `src/worker`. Do not modify `src/app/pages`. Reuse `src/app/components/{PtButton,PtField,ProjectTree}.vue` by relative import.

---

### Task 1: Report graph lib

**Files:** create `src/lib/capture.ts`, `src/lib/capture.test.ts`.

- [ ] **Step 1: Failing tests**

`src/lib/capture.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SELECTION_MAX_CHARS,
  fileReport,
  metadataPayload,
  parseOrigin,
  pngFromDataUrl,
  rootSummary,
  rootTitle,
  type CaptureApi,
} from "./capture.ts";

function recordingApi(): CaptureApi & { calls: string[] } {
  const calls: string[] = [];
  let n = 0;
  return {
    calls,
    async createNode(_ws, body) {
      n += 1;
      const id = `n${n}`;
      calls.push(`create:${body.payload_kind}:${body.title}:${id}`);
      return { node: { id } };
    },
    async includeNode(fromId, childId) {
      calls.push(`include:${fromId}:${childId}`);
    },
    async linkProject(nodeId, projectId) {
      calls.push(`project:${nodeId}:${projectId}`);
    },
    async refNode(fromId, toId) {
      calls.push(`ref:${fromId}:${toId}`);
    },
    async createBlobNode(_ws, form) {
      n += 1;
      const id = `n${n}`;
      calls.push(`blob:${form.get("title")}:${id}`);
      return { node: { id } };
    },
  };
}

describe("parseOrigin", () => {
  it("accepts http(s) origin and strips trailing slash", () => {
    assert.equal(parseOrigin("https://projthread.example.com/"), "https://projthread.example.com");
    assert.equal(parseOrigin("http://127.0.0.1:8787"), "http://127.0.0.1:8787");
  });
  it("rejects path, query, non-http", () => {
    assert.equal(parseOrigin("https://example.com/api"), null);
    assert.equal(parseOrigin("https://example.com/?x=1"), null);
    assert.equal(parseOrigin("chrome-extension://abc"), null);
    assert.equal(parseOrigin("not a url"), null);
  });
});

describe("titles", () => {
  it("falls back to Capture and clips summary to first line", () => {
    assert.equal(rootTitle("  "), "Capture");
    assert.equal(rootSummary("Hello\nworld"), "Hello");
  });
});

describe("metadataPayload", () => {
  it("nulls empty selection and clips long selection", () => {
    const captured_at = "2026-09-04T00:00:00.000Z";
    assert.equal(
      metadataPayload(
        { url: "https://a.test/", page_title: "A", selection: "", viewport: null },
        captured_at,
      ).selection,
      null,
    );
    const long = "x".repeat(SELECTION_MAX_CHARS + 10);
    assert.equal(
      metadataPayload(
        { url: "https://a.test/", page_title: "A", selection: long, viewport: { width: 1, height: 2 } },
        captured_at,
      ).selection?.length,
      SELECTION_MAX_CHARS,
    );
  });
});

describe("fileReport", () => {
  const harvest = {
    url: "https://friend.test/app",
    page_title: "Friend app",
    selection: "the bug",
    viewport: { width: 800, height: 600 },
  };

  it("creates markdown, json, includes, project; no work item", async () => {
    const api = recordingApi();
    const result = await fileReport(api, {
      workspaceId: "ws1",
      projectId: "p1",
      sentence: "Button never enables.",
      harvest,
      now: () => "2026-09-04T00:00:00.000Z",
    });
    assert.equal(result.rootId, "n1");
    assert.equal(result.metadataId, "n2");
    assert.equal(result.screenshotId, null);
    assert.deepEqual(api.calls, [
      "create:markdown:Friend app:n1",
      "create:json:Capture metadata:n2",
      "include:n1:n2",
      "project:n1:p1",
    ]);
  });

  it("includes screenshot blob when provided", async () => {
    const api = recordingApi();
    const result = await fileReport(api, {
      workspaceId: "ws1",
      projectId: "p1",
      sentence: "See shot.",
      harvest,
      screenshot: { bytes: new Uint8Array([1, 2, 3]), mime: "image/png", filename: "capture.png" },
      now: () => "2026-09-04T00:00:00.000Z",
    });
    assert.equal(result.screenshotId, "n3");
    assert.ok(api.calls.includes("blob:Capture screenshot:n3"));
    assert.ok(api.calls.includes("include:n1:n3"));
  });

  it("optional ref after project", async () => {
    const api = recordingApi();
    await fileReport(api, {
      workspaceId: "ws1",
      projectId: "p1",
      sentence: "Related.",
      harvest,
      refId: "old",
      now: () => "2026-09-04T00:00:00.000Z",
    });
    assert.equal(api.calls.at(-1), "ref:n1:old");
  });

  it("rejects blank sentence and blank project before writes", async () => {
    const api = recordingApi();
    await assert.rejects(
      () => fileReport(api, { workspaceId: "ws1", projectId: "p1", sentence: "  ", harvest }),
    );
    await assert.rejects(
      () => fileReport(api, { workspaceId: "ws1", projectId: "", sentence: "x", harvest }),
    );
    assert.equal(api.calls.length, 0);
  });
});

describe("pngFromDataUrl", () => {
  it("decodes a tiny png data url", () => {
    const raw = Uint8Array.from([137, 80, 78, 71]);
    let bin = "";
    for (const b of raw) bin += String.fromCharCode(b);
    const got = pngFromDataUrl(`data:image/png;base64,${btoa(bin)}`);
    assert.equal(got?.mime, "image/png");
    assert.equal(got?.filename, "capture.png");
    assert.deepEqual([...got!.bytes], [137, 80, 78, 71]);
  });
  it("rejects non-png", () => {
    assert.equal(pngFromDataUrl("data:image/jpeg;base64,xx"), null);
  });
});
```

- [ ] **Step 2: Run** `node --test --experimental-strip-types src/lib/capture.test.ts`

Expected: FAIL `MODULE_NOT_FOUND` `./capture.ts`

- [ ] **Step 3: Implement** `src/lib/capture.ts`

```ts
import {
  NODE_SUMMARY_MAX_BYTES,
  NODE_TITLE_MAX_BYTES,
  utf8Bytes,
} from "./wiki-text.ts";

export const SELECTION_MAX_CHARS = 8000;

export type CaptureHarvest = {
  url: string;
  page_title: string;
  selection: string | null;
  viewport: { width: number; height: number } | null;
};

export type CaptureMeta = CaptureHarvest & { captured_at: string };

export type CaptureApi = {
  createNode(
    workspaceId: string,
    body: Record<string, unknown>,
  ): Promise<{ node: { id: string } }>;
  includeNode(fromId: string, childId: string): Promise<void>;
  linkProject(nodeId: string, projectId: string): Promise<void>;
  refNode(fromId: string, toId: string): Promise<void>;
  createBlobNode?(
    workspaceId: string,
    form: FormData,
  ): Promise<{ node: { id: string } }>;
};

export type ReportInput = {
  workspaceId: string;
  projectId: string;
  sentence: string;
  type?: "note" | "research";
  harvest: CaptureHarvest;
  refId?: string | null;
  screenshot?: { bytes: Uint8Array; mime: string; filename: string } | null;
  now?: () => string;
};

export type ReportResult = {
  rootId: string;
  metadataId: string;
  screenshotId: string | null;
};

export function parseOrigin(raw: string): string | null {
  const trimmed = raw.trim().replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (url.pathname !== "/" && url.pathname !== "") return null;
  if (url.search || url.hash) return null;
  return url.origin;
}

export function clipUtf8(text: string, maxBytes: number): string {
  let s = text;
  while (s.length > 0 && utf8Bytes(s) > maxBytes) s = s.slice(0, -1);
  return s;
}

export function rootTitle(pageTitle: string): string {
  const t = pageTitle.trim() || "Capture";
  return clipUtf8(t, NODE_TITLE_MAX_BYTES);
}

export function rootSummary(sentence: string): string {
  const line = sentence.trim().split("\n")[0] ?? "";
  return clipUtf8(line, NODE_SUMMARY_MAX_BYTES);
}

export function metadataPayload(
  harvest: CaptureHarvest,
  capturedAt: string,
): CaptureMeta {
  let selection = harvest.selection;
  if (selection === "") selection = null;
  if (selection && selection.length > SELECTION_MAX_CHARS) {
    selection = selection.slice(0, SELECTION_MAX_CHARS);
  }
  return {
    url: harvest.url,
    page_title: harvest.page_title,
    selection,
    viewport: harvest.viewport,
    captured_at: capturedAt,
  };
}

export function pngFromDataUrl(
  dataUrl: string,
): { bytes: Uint8Array; mime: string; filename: string } | null {
  const match = /^data:(image\/png);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match) return null;
  const bin = atob(match[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, mime: "image/png", filename: "capture.png" };
}

export async function fileReport(
  api: CaptureApi,
  input: ReportInput,
): Promise<ReportResult> {
  const sentence = input.sentence.trim();
  if (!sentence) throw new Error("sentence");
  if (!input.projectId) throw new Error("project");
  const capturedAt = (input.now ?? (() => new Date().toISOString()))();
  const type = input.type ?? "note";
  const root = await api.createNode(input.workspaceId, {
    title: rootTitle(input.harvest.page_title),
    type,
    payload_kind: "markdown",
    content: sentence,
    summary: rootSummary(sentence),
  });
  const metadata = await api.createNode(input.workspaceId, {
    title: "Capture metadata",
    type: "note",
    payload_kind: "json",
    content: JSON.stringify(metadataPayload(input.harvest, capturedAt)),
  });
  await api.includeNode(root.node.id, metadata.node.id);
  let screenshotId: string | null = null;
  if (input.screenshot && api.createBlobNode) {
    const form = new FormData();
    form.set("title", "Capture screenshot");
    form.set("type", "note");
    form.set("payload_kind", "blob");
    form.set(
      "file",
      new Blob([input.screenshot.bytes], { type: input.screenshot.mime }),
      input.screenshot.filename,
    );
    const shot = await api.createBlobNode(input.workspaceId, form);
    screenshotId = shot.node.id;
    await api.includeNode(root.node.id, shot.node.id);
  }
  await api.linkProject(root.node.id, input.projectId);
  const refId = input.refId?.trim();
  if (refId) await api.refNode(root.node.id, refId);
  return {
    rootId: root.node.id,
    metadataId: metadata.node.id,
    screenshotId,
  };
}
```

- [ ] **Step 4: Run** `node --test --experimental-strip-types src/lib/capture.test.ts`

Expected: PASS

- [ ] **Step 5: Commit** `feat: capture report graph writer`

---

### Task 2: Bearer catalog client

**Files:** create `src/lib/capture-http.ts`, `src/lib/capture-http.test.ts`.

- [ ] **Step 1: Failing tests**

`src/lib/capture-http.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { captureApi } from "./capture-http.ts";

type Call = { url: string; method: string; auth: string | null; ctype: string | null; body: string | null };

function installFetch(handler: (req: Request) => Promise<Response> | Response): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    calls.push({
      url: req.url,
      method: req.method,
      auth: req.headers.get("authorization"),
      ctype: req.headers.get("content-type"),
      body: req.method === "GET" ? null : await req.clone().text(),
    });
    return handler(req);
  }) as typeof fetch;
  return calls;
}

const creds = { origin: "https://pt.test", token: "sess_1" };

describe("captureApi", () => {
  it("GET me uses Bearer and origin prefix", async () => {
    const calls = installFetch(() =>
      Response.json({
        principal: { id: "p", type: "user", display_name: "J" },
        memberships: [],
        workspace_id: "ws1",
      }),
    );
    const me = await captureApi(creds).getMe();
    assert.equal(me.workspace_id, "ws1");
    assert.equal(calls[0]?.url, "https://pt.test/api/me");
    assert.equal(calls[0]?.auth, "Bearer sess_1");
  });

  it("createNode JSON content-type; FormData omits it", async () => {
    const calls = installFetch(() => Response.json({ node: { id: "n1" } }, { status: 201 }));
    const api = captureApi(creds);
    await api.createNode("ws1", { title: "T", payload_kind: "markdown" });
    const form = new FormData();
    form.set("payload_kind", "blob");
    form.set("title", "S");
    form.set("file", new Blob([new Uint8Array([1])], { type: "image/png" }), "capture.png");
    await api.createBlobNode("ws1", form);
    assert.equal(calls[0]?.ctype, "application/json");
    assert.equal(calls[0]?.url, "https://pt.test/api/workspaces/ws1/nodes");
    assert.equal(calls[1]?.url, "https://pt.test/api/workspaces/ws1/nodes");
    assert.equal(calls[1]?.ctype === null || calls[1]?.ctype?.startsWith("multipart/form-data"), true);
    assert.notEqual(calls[1]?.ctype, "application/json");
  });

  it("include, project, ref, list projects, create project, patch me", async () => {
    const calls = installFetch((req) => {
      if (req.url.endsWith("/projects") && req.method === "GET") {
        return Response.json({ projects: [{ id: "root", parent_id: null, name: "W" }] });
      }
      if (req.url.endsWith("/projects") && req.method === "POST") {
        return Response.json({ project: { id: "p2", parent_id: "root", name: "New" } }, { status: 201 });
      }
      return Response.json({ node: { id: "n1" }, project: { id: "p2" } });
    });
    const api = captureApi(creds);
    await api.includeNode("n1", "n2");
    await api.linkProject("n1", "p1");
    await api.refNode("n1", "old");
    const listed = await api.listProjects("ws1");
    const created = await api.createProject("ws1", { name: "New", parent_id: "root" });
    await api.patchMe("ws1");
    assert.equal(calls[0]?.url, "https://pt.test/api/nodes/n1/includes");
    assert.ok(calls[0]?.body?.includes("child_id"));
    assert.equal(calls[1]?.url, "https://pt.test/api/nodes/n1/projects");
    assert.ok(calls[1]?.body?.includes("project_id"));
    assert.equal(calls[2]?.url, "https://pt.test/api/nodes/n1/refs");
    assert.ok(calls[2]?.body?.includes("to_id"));
    assert.equal(listed.projects[0]?.id, "root");
    assert.equal(created.project.id, "p2");
    assert.equal(calls.at(-1)?.url, "https://pt.test/api/me");
    assert.equal(calls.at(-1)?.method, "PATCH");
  });

  it("401 throws status", async () => {
    installFetch(() => new Response("no", { status: 401 }));
    await assert.rejects(() => captureApi(creds).getMe(), (err: unknown) => {
      assert.equal((err as { status: number }).status, 401);
      return true;
    });
  });
});
```

- [ ] **Step 2: Run** `node --test --experimental-strip-types src/lib/capture-http.test.ts`

Expected: FAIL `MODULE_NOT_FOUND`

- [ ] **Step 3: Implement** `src/lib/capture-http.ts`

```ts
import type { CaptureApi } from "./capture.ts";

export class CaptureHttpError extends Error {
  readonly status: number;
  constructor(status: number) {
    super("error");
    this.status = status;
  }
}

export type CaptureCreds = { origin: string; token: string };

export type MeBody = {
  principal: { id: string; type: string; display_name: string };
  memberships?: {
    workspace_id: string;
    workspace_name: string;
    role: string;
  }[];
  workspace_id: string | null;
};

export type CaptureClient = CaptureApi & {
  getMe(): Promise<MeBody>;
  patchMe(workspaceId: string): Promise<MeBody>;
  listProjects(workspaceId: string): Promise<{
    projects: { id: string; parent_id: string | null; name: string }[];
  }>;
  createProject(
    workspaceId: string,
    body: { name: string; parent_id: string | null },
  ): Promise<{ project: { id: string; parent_id: string | null; name: string } }>;
  createBlobNode(
    workspaceId: string,
    form: FormData,
  ): Promise<{ node: { id: string } }>;
};

async function apiJson<T>(
  creds: CaptureCreds,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${creds.token}`);
  if (
    init.body != null &&
    !headers.has("content-type") &&
    !(typeof FormData !== "undefined" && init.body instanceof FormData)
  ) {
    headers.set("content-type", "application/json");
  }
  const res = await fetch(`${creds.origin}${path}`, { ...init, headers });
  if (!res.ok) throw new CaptureHttpError(res.status);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function captureApi(creds: CaptureCreds): CaptureClient {
  return {
    getMe: () => apiJson(creds, "/api/me"),
    patchMe: (workspaceId) =>
      apiJson(creds, "/api/me", {
        method: "PATCH",
        body: JSON.stringify({ workspace_id: workspaceId }),
      }),
    listProjects: (workspaceId) =>
      apiJson(creds, `/api/workspaces/${workspaceId}/projects`),
    createProject: (workspaceId, body) =>
      apiJson(creds, `/api/workspaces/${workspaceId}/projects`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    createNode: (workspaceId, body) =>
      apiJson(creds, `/api/workspaces/${workspaceId}/nodes`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    createBlobNode: (workspaceId, form) =>
      apiJson(creds, `/api/workspaces/${workspaceId}/nodes`, {
        method: "POST",
        body: form,
      }),
    includeNode: async (fromId, childId) => {
      await apiJson(creds, `/api/nodes/${fromId}/includes`, {
        method: "POST",
        body: JSON.stringify({ child_id: childId }),
      });
    },
    linkProject: async (nodeId, projectId) => {
      await apiJson(creds, `/api/nodes/${nodeId}/projects`, {
        method: "POST",
        body: JSON.stringify({ project_id: projectId }),
      });
    },
    refNode: async (fromId, toId) => {
      await apiJson(creds, `/api/nodes/${fromId}/refs`, {
        method: "POST",
        body: JSON.stringify({ to_id: toId }),
      });
    },
  };
}
```

- [ ] **Step 4: Run** `node --test --experimental-strip-types src/lib/capture.test.ts src/lib/capture-http.test.ts`

Expected: PASS

- [ ] **Step 5: Commit** `feat: capture bearer http client`

---

### Task 3: MV3 Vite shell

**Files:** create `src/extension/vite.config.ts`, `src/extension/manifest.json`, `src/extension/popup.html`, `src/extension/main.ts`, `src/extension/Popup.vue`, `src/extension/chrome-min.d.ts`; copy icons; modify `package.json`.

- [ ] **Step 1:** Add script (do not add to `build` / `deploy`):

```json
"build:extension": "vite build --config src/extension/vite.config.ts"
```

- [ ] **Step 2:** `src/extension/chrome-min.d.ts`

```ts
declare const chrome: {
  storage: {
    local: {
      get(keys: string[] | string): Promise<Record<string, string | undefined>>;
      set(items: Record<string, string>): Promise<void>;
      remove(keys: string[] | string): Promise<void>;
    };
  };
  permissions: {
    request(opt: { origins?: string[] }): Promise<boolean>;
    contains(opt: { origins?: string[] }): Promise<boolean>;
  };
  tabs: {
    query(query: { active?: boolean; currentWindow?: boolean }): Promise<
      { id?: number; windowId?: number; url?: string; title?: string }[]
    >;
    captureVisibleTab(
      windowId?: number,
      options?: { format?: string },
    ): Promise<string>;
  };
  scripting: {
    executeScript<T>(opt: {
      target: { tabId: number };
      func: () => T;
    }): Promise<{ result?: T }[]>;
  };
};
```

- [ ] **Step 3:** `src/extension/vite.config.ts`

```ts
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  base: "./",
  plugins: [vue()],
  publicDir: resolve(root, "public"),
  build: {
    outDir: resolve(root, "../../dist/extension"),
    emptyOutDir: true,
    rollupOptions: {
      input: { popup: resolve(root, "popup.html") },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
});
```

Copy `src/app/public/icons/icon-192.png` and `icon-512.png` to `src/extension/public/icons/`. Also copy `manifest.json` into `src/extension/public/manifest.json` so Vite emits it at the extension root (Vite copies `public/` as-is). Keep a source `src/extension/manifest.json` only if it is the public one — **one file:** `src/extension/public/manifest.json`.

`src/extension/public/manifest.json`:

```json
{
  "manifest_version": 3,
  "name": "ProjThread Capture",
  "version": "0.23.0",
  "description": "File a wiki report from the page you are on.",
  "action": {
    "default_title": "ProjThread",
    "default_popup": "popup.html",
    "default_icon": {
      "192": "icons/icon-192.png"
    }
  },
  "icons": {
    "192": "icons/icon-192.png",
    "512": "icons/icon-512.png"
  },
  "permissions": ["storage", "activeTab", "scripting"],
  "optional_host_permissions": ["http://*/*", "https://*/*"]
}
```

`src/extension/popup.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>ProjThread</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
```

`src/extension/main.ts`:

```ts
import { createApp } from "vue";
import "../styles/tokens.css";
import Popup from "./Popup.vue";

createApp(Popup).mount("#app");
```

`src/extension/Popup.vue` (stub — full UI in Task 4):

```vue
<script setup lang="ts">
</script>
<template>
  <main class="shell">
    <h1>ProjThread</h1>
  </main>
</template>
<style>
html,
body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font-family: var(--font);
}
.shell {
  box-sizing: border-box;
  width: 22rem;
  padding: 0.75rem;
}
h1 {
  font-size: 1rem;
  font-weight: 600;
  margin: 0;
}
</style>
```

- [ ] **Step 4:** `npm run build:extension`

Expected: `dist/extension/popup.html`, `dist/extension/manifest.json`, `dist/extension/icons/icon-192.png`, a `popup.js` (or hashed under `assets` only for CSS — **JS entry must stay `popup.js` or the HTML script src that Vite rewrote**). Open `dist/extension/popup.html` and confirm the script `src` matches a file that exists. If Vite rewrote `./main.ts` to `./popup.js`, that is correct.

- [ ] **Step 5:** `npm test` still passes (lib tests on the default glob).

- [ ] **Step 6: Commit** `feat: capture extension vite shell`

---

### Task 4: Session, workspace, project picker

**Files:** modify `src/extension/Popup.vue` (and only that Vue).

- [ ] **Step 1:** Replace `Popup.vue` with the session + project client. No new test file (lib already covers HTTP). Manual bar is `build:extension`.

Behavior:

1. On mount, `chrome.storage.local.get(["origin","token"])`. If both set and `parseOrigin(origin)`, `captureApi({origin, token}).getMe()`. 401 → sign-in. Else ready.
2. Sign-in: origin + token fields, Save. `parseOrigin` else inline error. `chrome.permissions.request({ origins: [origin + "/*"] })` — if false, error `host permission denied`. Then `getMe`; persist origin+token; ready.
3. Sign out: `chrome.storage.local.remove`, back to sign-in (do not revoke host permission).
4. Workspace: if `me.workspace_id` use it. Else if `memberships.length === 1` use that id (PATCH if you want it sticky). Else `<select>` of memberships, on change PATCH.
5. `listProjects(workspaceId)`. `ProjectTree` `selectedId` null means root; resolve attach id as `selectedId ?? root.id`. Root = first project with `parent_id == null` (if several, tree still lists them; attach uses the selected row’s id, never null).
6. Create project: name field + button. POST `{ name, parent_id: selectedId ?? root.id }`. On 201, refresh list and select the new id.
7. Type: `note` | `research`. Sentence textarea. Optional ref id. Screenshot checkbox default checked. File report disabled until sentence + project id.
8. Status line uses `var(--muted)` / `var(--danger)` tokens only.

Use:

```ts
import ProjectTree from "../app/components/ProjectTree.vue";
import PtButton from "../app/components/PtButton.vue";
import PtField from "../app/components/PtField.vue";
import { captureApi, CaptureHttpError, type CaptureClient, type MeBody } from "../lib/capture-http.ts";
import { parseOrigin } from "../lib/capture.ts";
```

Sign-in hint text: `Admin → Issue token` (no cookie).

File/harvest handlers may be empty `async function fileReportUi() {}` until Task 5, but the File button must exist and be disabled when sentence blank.

- [ ] **Step 2:** `npm run build:extension` — PASS. `npm test` — PASS.

- [ ] **Step 3: Commit** `feat: capture popup session and project picker`

---

### Task 5: Harvest, file, screenshot

**Files:** modify `src/extension/Popup.vue` only.

- [ ] **Step 1:** Implement harvest + `fileReport`.

Harvest (popup open is the user gesture):

```ts
type HarvestDom = {
  url: string;
  page_title: string;
  selection: string;
  viewport: { width: number; height: number };
};

async function harvestTab(): Promise<{
  harvest: import("../lib/capture.ts").CaptureHarvest;
  windowId?: number;
}> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  let url = tab?.url ?? "";
  let page_title = tab?.title ?? "";
  let selection: string | null = null;
  let viewport: { width: number; height: number } | null = null;
  if (tab?.id != null) {
    try {
      const [inj] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (): HarvestDom => ({
          url: location.href,
          page_title: document.title,
          selection: window.getSelection()?.toString() ?? "",
          viewport: { width: window.innerWidth, height: window.innerHeight },
        }),
      });
      const result = inj?.result;
      if (result) {
        url = result.url;
        page_title = result.page_title;
        selection = result.selection;
        viewport = result.viewport;
      }
    } catch {
      /* chrome:// and the like */
    }
  }
  return {
    harvest: { url, page_title, selection, viewport },
    windowId: tab?.windowId,
  };
}
```

On File (single-flight flag):

1. Disable the button while `filing`.
2. `const { harvest, windowId } = await harvestTab()`.
3. Screenshot if checkbox on: `try { const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "png" }); shot = pngFromDataUrl(dataUrl); } catch { note = "No screenshot"; }`. If `pngFromDataUrl` null, same note.
4. `fileReport(api, { workspaceId, projectId, sentence, type, harvest, refId, screenshot: shot })`.
5. If `createBlobNode` throws `CaptureHttpError` 503, retry `fileReport` **without** screenshot (do **not** duplicate: only retry when the failure happened on the blob step). Simpler lock: wrap screenshot upload only — `fileReport` already skips blob when `screenshot` is null. So: first attempt with shot; if error and shot was set, set note `No screenshot` and retry with `screenshot: null` **only if no markdown node was created**. Because `fileReport` is not transactional, **do not retry the whole graph**. Catch blob inside `fileReport`? Keep lib pure. In the popup:

   Lock: call `fileReport` with screenshot. If it throws, show `var(--danger)` `Could not file` + status code. Do **not** retry. Screenshot 503 fails the click; user unchecks Screenshot and files again (orphans possible from the first try — accepted; no DELETE).

6. Success: `filedTitle = rootTitle(harvest.page_title)`; status `Filed`.

Pre-fill sentence with selection when non-empty so the human can edit (the sentence is the root; selection also stays in metadata). If they clear it, they must type.

- [ ] **Step 2:** `npm test && npm run build:extension`

Expected: PASS. Load unpacked: Chrome → `chrome://extensions` → Load unpacked → `dist/extension`. Against local wrangler: origin `http://127.0.0.1:8787`, token from Admin Issue token. If Chrome is not available this session, say so; tests + build are the automated bar.

- [ ] **Step 3: Commit** `feat: capture popup files report graph`

---

### Task 6: Docs and STATUS (23 landed)

**Files:** `docs/STATUS.md`, `docs/superpowers/plans/2026-08-26-projthread-v1.md`, `AGENTS.md`, `docs/superpowers/specs/2026-09-03-projthread-capture-design.md`, `.grok/skills/using-projthread/SKILL.md`.

- [ ] **Step 1: STATUS Live** — add capture extension (MV3 popup; Bearer origin+token; project select/create; report graph markdown+json+includes+`node_project`; optional PNG blob). **Now:** no open slice. **Next:** write plan **24** share target (not written). Do not start 24. Do not add CORS. Do not remote-create R2 / queue / apply `0008`/`0009` / deploy unless José asks.

- [ ] **Step 2: Index** plan **23** row: `2026-09-04-projthread-capture-extension.md` **Landed**. 24 still unwritten.

- [ ] **Step 3: Capture spec** slice **23** plan file + **Landed**. Screenshot without scribble.

- [ ] **Step 4: AGENTS Now** — no open slice. Do not start 24 unless STATUS names it. Capture clients: extension landed; share target not started.

- [ ] **Step 5: using-projthread** — humans may file a report from the Chrome extension (Bearer session, not MCP). Knock is still `node.created` / `node.included`; `wiki_read` the root, then includes.

- [ ] **Step 6:** `npm test && npm run build:extension`.

- [ ] **Step 7: Commit** `docs: capture extension landed`

---

## Compact / pickup

After Task 6, **stop**.

```
23 landed locally.
MV3 popup dist/extension. Bearer origin+token (Admin Issue token). No CORS. No cookie.
Graph: markdown root + json metadata + includes + node_project; optional PNG blob include; optional ref.
Project select/create. No scribble. No share target.
Tests + build:extension. Chrome load-unpacked may be unverified.
Next: write plan 24 share target (not written).
Do not start 24 unless STATUS names it. Do not wrangler r2 bucket create / queues create / apply remote 0008/0009 / deploy unless José asks.
Pickup: AGENTS.md → docs/STATUS.md. If José says write 24, write the plan only. One parent, TDD, no sub-agent.
```

---

## Out of this slice (explicit)

| Deferred | Why |
| --- | --- |
| PWA share target | **24** |
| Scribble / annotation | Mini editor; PNG as captured is enough |
| On-device distill | Spec optional; Worker stores nodes |
| CORS on `/api` | Extension host_permissions; do not open the web |
| In-page portal / bookmarklet | Named absence |
| Firefox / Web Store | Unpacked Chrome is the v1 path |
| PWA `/capture` route | 24 lands share there; 23 must not steal that route |
| Remote R2 / queue / 0008 / 0009 / deploy | Ops |

## Success

On a friend’s site, José opens the popup, has a session, points a project, types a sentence, files. Wiki has a markdown root `includes` a json metadata node, `project_ids` set, no card. If notify is live, Grok Bot gets `node.created` then `node.included` and `wiki_read`s. The board is empty of dumps.
