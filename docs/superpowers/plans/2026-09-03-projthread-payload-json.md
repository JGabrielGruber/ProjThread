# ProjThread payload_kind json — implementation plan

> For Grok Build: one session, one slice. Compact after each task. Scout only if a file is not where this plan says. Do not add tests the plan did not ask for. Stop when STATUS is updated. Do not dispatch reviewer or superpowers:subagent-driven-development sub-agents. Do not start OAuth. Do not start room MCP. Do not bind Queues or R2. Do not build the capture extension. Do not add `node_project` write HTTP (slice 20). Do not notify.

**Goal:** Wiki nodes may be `payload_kind=json`: canonical JSON object/array in `content`, PWA pretty reader + source edit, MCP create/read. Markdown unchanged. Blob still 400.

**Architecture:** Keep `WikiStore` + `wiki-http`. Widen the D1 CHECK and the TypeScript `PayloadKind` union. Validate JSON only on write when kind is json (parse + `JSON.stringify`; no HTML strip). Client: do not `v-html` JSON. MCP wrap passes `payload_kind` through existing HTTP.

**Tech Stack:** Existing Worker + D1 + Vue 3 PWA + `/mcp` façade. `node --test --experimental-strip-types`. No new deps, no bindings.

Spec: `docs/superpowers/specs/2026-09-03-projthread-capture-design.md` slice **19**.

---

## Locked calls (do not re-litigate)

| Topic | Call |
| --- | --- |
| Union | `payload_kind` ∈ `markdown` \| `json` \| `blob`. Omit on POST → `markdown`. |
| Blob | POST `blob` still **400**. Blob columns stay NULL. R2 unbound. |
| JSON body | Object or array only (`typeof === "object"` after parse, including arrays; reject `null`, numbers, strings, booleans). Persist `JSON.stringify(parsed)` (minified, key order as parsed). |
| Invalid JSON | **400** `{ error: "bad_request" }`. |
| Byte cap | Same `NODE_CONTENT_MAX_BYTES` (32768) **after** stringify. Over → 400. |
| HTML strip | Markdown `content` / title / summary only. **Do not** `stripRawHtml` on json `content`. |
| PATCH `payload_kind` | Still **400**. Kind is immutable. |
| PATCH json `content` | Re-validate as json. Markdown nodes still strip HTML. |
| List | Still omits `content`. `payload_kind` already on list rows. |
| Search | Title/summary substring only. Do not search JSON bodies. |
| MCP | `wiki_create` optional `payload_kind`. `wiki_read` `content[0]` is the JSON text when json (same envelope as markdown). Hits omit bodies. |
| PWA | Read: `<pre>` pretty-print, not `v-html`. Edit: textarea. Create modal: kind `markdown` \| `json`. |
| Bindings | `wrangler.jsonc` unchanged. |
| Out | Notify, Queues, R2, extension, `node_project` POST, inbox, Vectorize. |

---

## File map

| Path | Job |
| --- | --- |
| `migrations/0008_payload_kind_json.sql` | Rebuild `node` CHECK to include `json`. Preserve rows + `pinned`. |
| `src/lib/wiki-json.ts` | `canonicalizeJson(src)` → string or null. |
| `src/lib/wiki-json.test.ts` | Object/array ok; primitives and invalid → null; round-trip stringify. |
| `src/worker/wiki.ts` | `PayloadKind` includes `json`. |
| `src/worker/wiki-http.ts` | POST/PATCH json validation. |
| `src/worker/wiki-http.test.ts` | New cases below. Existing blob 400 stays. |
| `src/worker/mcp.ts` | `wiki_create` input + wrap body `payload_kind`. |
| `src/worker/mcp.test.ts` | Create json; `content[0]` is JSON text. |
| `src/app/models/wiki.ts` | `WikiCreate.payload_kind?`. |
| `src/app/services/wiki.ts` | Pass `payload_kind` on create. |
| `src/app/pages/WikiPage.vue` | Kind select; json read/edit. |
| `src/app/styles.css` or wiki page CSS | `pre.wiki-json` uses tokens, not a new kit. |
| `docs/STATUS.md`, index, AGENTS invariant, v1 payload sentence | After tests pass. |

Do not modify `catalog.ts`, room, wrangler, `node-rel`.

---

### Task 1: Canonicalize helper

**Files:** create `src/lib/wiki-json.ts`, `src/lib/wiki-json.test.ts`.

- [ ] **Step 1: Failing tests**

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canonicalizeJson } from "./wiki-json.ts";

describe("canonicalizeJson", () => {
  it("stringifies objects and arrays", () => {
    assert.equal(canonicalizeJson('{"b":1,"a":2}'), '{"b":1,"a":2}');
    assert.equal(canonicalizeJson("[1,2]"), "[1,2]");
  });
  it("rejects invalid and non-containers", () => {
    assert.equal(canonicalizeJson("{"), null);
    assert.equal(canonicalizeJson("null"), null);
    assert.equal(canonicalizeJson("1"), null);
    assert.equal(canonicalizeJson('"x"'), null);
    assert.equal(canonicalizeJson("true"), null);
  });
});
```

- [ ] **Step 2: Run** `node --test --experimental-strip-types src/lib/wiki-json.test.ts` — fail (module missing).
- [ ] **Step 3: Implement** `canonicalizeJson`: `JSON.parse` in try/catch; if value is `null` or `typeof !== "object"` return null; else `JSON.stringify(value)`.
- [ ] **Step 4: Re-run** — pass.
- [ ] **Step 5: Commit** `feat: canonicalize wiki json payloads`

---

### Task 2: Migration

**Files:** create `migrations/0008_payload_kind_json.sql`.

SQLite cannot alter a CHECK. Rebuild `node`. Child FKs (`node_work_item`, `node_project`, `node_rel`) keep the same ids.

```sql
PRAGMA foreign_keys = OFF;

CREATE TABLE node_new (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace(id),
  organization_id TEXT NOT NULL REFERENCES organization(id),
  type TEXT NOT NULL CHECK (type IN (
    'note',
    'decision',
    'process',
    'research'
  )),
  payload_kind TEXT NOT NULL CHECK (payload_kind IN ('markdown', 'json', 'blob')),
  title TEXT NOT NULL,
  summary TEXT,
  content TEXT,
  blob_key TEXT,
  mime_type TEXT,
  byte_size INTEGER,
  filename TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0
);

INSERT INTO node_new (
  id, workspace_id, organization_id, type, payload_kind, title, summary, content,
  blob_key, mime_type, byte_size, filename, created_at, updated_at, pinned
)
SELECT
  id, workspace_id, organization_id, type, payload_kind, title, summary, content,
  blob_key, mime_type, byte_size, filename, created_at, updated_at, pinned
FROM node;

DROP TABLE node;
ALTER TABLE node_new RENAME TO node;

CREATE INDEX idx_node_workspace ON node (workspace_id);

PRAGMA foreign_keys = ON;
```

- [ ] **Step 1: Add the file.** Do not apply remote D1 unless José asks. Local: `npx wrangler d1 migrations apply DB --local` after Worker tests, or rely on wrangler persist in later verify.
- [ ] **Step 2: Commit** `feat: allow payload_kind json on node`

If D1 rejects `PRAGMA` in a migration, keep the rebuild and drop the pragma lines; do not change the CHECK.

---

### Task 3: HTTP create/patch

**Files:** modify `src/worker/wiki.ts` (`PayloadKind = "markdown" | "json" | "blob"`), `src/worker/wiki-http.ts`, `src/worker/wiki-http.test.ts`.

Create path today:

```ts
if ("payload_kind" in body && body.payload_kind !== "markdown") {
  return Response.json({ error: "bad_request" }, { status: 400 });
}
```

Replace with parse:

- omitted → `"markdown"`
- `"markdown"` | `"json"` ok
- anything else (including `"blob"`) → 400

After `parseOptionalText` for `content`:

- if kind is `json` and content is non-null: `canonicalizeJson(content)`; null → 400; then `rejectContent` on the canonical string; store canonical.
- if kind is `markdown`: keep `stripRawHtml` on title/summary/content as today.

PATCH `content` when `node.payload_kind === "json"`: same canonicalize; do not strip HTML.

- [ ] **Step 1: Failing tests** in `wiki-http.test.ts` (same `memberContext` as blob 400):

  1. POST `{ title: "Meta", payload_kind: "json", content: "{\"url\":\"https://example.com\"}" }` → 201, `payload_kind` json, `content` `{"url":"https://example.com"}`.
  2. POST json `content: "{"` → 400, no extra list row.
  3. POST json `content: "null"` → 400.
  4. POST `payload_kind: "blob"` still 400.
  5. POST omit kind still markdown (existing Egg case still passes).
  6. PATCH json node `content` valid object → 200 canonical.
  7. PATCH json node `content: "1"` → 400.
  8. PATCH `{ payload_kind: "json" }` on a markdown node → 400, kind unchanged.

- [ ] **Step 2: Run** `node --test --experimental-strip-types src/worker/wiki-http.test.ts` — new cases fail.
- [ ] **Step 3: Implement** in `wiki-http.ts`. Import `canonicalizeJson`.
- [ ] **Step 4: Re-run wiki-http + wiki tests** — pass.
- [ ] **Step 5: Commit** `feat: accept wiki payload_kind json`

---

### Task 4: MCP wrap

**Files:** modify `src/worker/mcp.ts`, `src/worker/mcp.test.ts`.

`wiki_create` `inputSchema` add `payload_kind: z.enum(["markdown", "json"]).optional()`. Description: may create json; do not use for blob; search still title/summary.

Wrap body: `compactJson({ title, type, summary, content, work_item_id, payload_kind })`.

- [ ] **Step 1: Test** `wiki_create` with `payload_kind: "json"` and `content: "{\"k\":1}"` → envelope `content[0].text` is `{"k":1}` (or the canonical string), `content[1]` JSON has `payload_kind: "json"` and does **not** repeat `node.content` if that is already the envelope rule.
- [ ] **Step 2: Run** `node --test --experimental-strip-types src/worker/mcp.test.ts` — fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Re-run mcp tests** — pass.
- [ ] **Step 5: Commit** `feat: mcp wiki_create payload_kind json`

---

### Task 5: PWA reader and create

**Files:** `src/app/models/wiki.ts`, `src/app/services/wiki.ts`, `src/app/pages/WikiPage.vue`, tokenized CSS on the wiki page (no new kit).

`WikiCreate` gains optional `payload_kind?: "markdown" | "json"`. `createNode` JSON body includes it when set (do not force `Record<string, string>` if that blocks it — use `Record<string, unknown>` or a typed payload).

WikiPage:

- `draftKind` `'markdown' | 'json'`, default markdown.
- Create modal: select like Type.
- Read: if `wiki.node.payload_kind === "json"`, render `<pre class="wiki-json">{{ pretty }}</pre>` where `pretty` is `JSON.stringify(JSON.parse(content), null, 2)` inside try/catch (fallback raw text). **Never** `v-html` json.
- Markdown read stays `v-html="rendered"`.
- List meta: show `payload_kind` when not markdown (or always show kind).
- Edit textarea unchanged (source is canonical JSON).

- [ ] **Step 1:** Extend `src/app/stores/wiki.test.ts` create payload if the store tests POST body — include `payload_kind` when provided. If no store test for create body, add one case in the existing wiki store test file only.
- [ ] **Step 2:** Implement UI. Tokens only (`var(--pt-*)` / existing wiki muted).
- [ ] **Step 3:** `npm test` — pass.
- [ ] **Step 4: Commit** `feat: pwa json wiki reader`

---

### Task 6: Docs and STATUS

**Files:** `docs/STATUS.md`, `docs/superpowers/plans/2026-08-26-projthread-v1.md`, `AGENTS.md` (payload_kind invariant only), spec v1 wiki table one-line pointer.

- [ ] **Step 1:** STATUS **Now:** no open slice (this plan landed). **Live:** + json wiki nodes (local; remote after José applies `0008`). Do not claim remote until applied.
- [ ] **Step 2:** Index: plan **19** row landed. **Next** still park Deploy / OAuth / room MCP; capture spec slices 20–23 named, no open plan unless José opens `node_project` write.
- [ ] **Step 3:** `AGENTS.md` nodes bullet: `payload_kind` `markdown` \| `json` \| `blob`; v1 writes markdown **or** json; blob columns reserved.
- [ ] **Step 4:** `npm test` once more.
- [ ] **Step 5: Commit** `docs: payload_kind json landed`

---

## Verify

```bash
node --test --experimental-strip-types src/lib/wiki-json.test.ts src/worker/wiki-http.test.ts src/worker/wiki.test.ts src/worker/mcp.test.ts src/app/stores/wiki.test.ts
npm test
```

No wrangler bind. No remote D1. No extension.
