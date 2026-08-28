# ProjThread Node Rel Implementation Plan

> For Grok Build: one session, one slice. Compact after each task. Scout only if a file is not where this plan says. Do not add tests the plan did not ask for. Stop when STATUS is updated. Do not dispatch reviewer or superpowers:subagent-driven-development sub-agents.

**Goal:** Workspace node–node edges on one table so Grok Bot (and later the PWA) can **compose** a page from smaller pages and **cite** another page without lying that a citation is a child. Attach to a card stays the existing M2M and is a third, independent write.

**Architecture:** D1 `node_rel`. Extend `WikiStore` + `wiki-http` only. Cycle-check **includes** in `src/lib/node-rel.ts` (do not reuse `project-tree.ts` — that is `parent_id` forests). `GET /api/nodes/:id` grows `{ includes, refs }` with **no** child `content`. No Room DO, no Activity, no PWA chrome.

**Tech Stack:** Existing Worker + D1, `node --test --experimental-strip-types`. No new bindings, no Vue edits, no PrimeVue, no R2, no Vectorize, no MCP, no Channels, no Chores.

This slice exists so the **test surface is the contract**: include ≠ ref ≠ attach.

---

## Locked calls (do not re-litigate)

| Topic | Call |
| --- | --- |
| Table | One `node_rel (from_id, to_id, kind, position)`. `kind` ∈ {`includes`, `ref`}. PK `(from_id, to_id, kind)` so the same pair may be both include and ref (tests must show they split). |
| `includes` | Ordered parts. `position` INTEGER NOT NULL. Omit on POST → append `MAX+1` (empty parent starts at `0`). `ORDER BY position, to_id`. Duplicate positions allowed (no renumber). |
| `ref` | Cite. `position` always NULL. Cycles **allowed** (A↔B). Body must not send `position`. |
| Cycle | **includes only.** Self-include **400**. A→B→A **400**. Helper walks **includes** edges only. |
| Same workspace | `to` node must exist and `workspace_id` match `from`. Else **400**. |
| Attach | Unchanged `node_work_item`. Include/ref must not write it. Attach must not write `node_rel`. |
| GET node | `{ node, work_item_ids, includes, refs }`. `includes: [{ id, title, position }]`, `refs: [{ id, title }]`. **No** `content` on those rows. List workspace nodes still omits edges and content. |
| POST includes | `POST /api/nodes/:id/includes` `{ child_id, position? }`. New **201**. Same pair again **200** (optional new `position` updates). Payload = GET node. |
| POST refs | `POST /api/nodes/:id/refs` `{ to_id }`. New **201**. Same pair **200**. Payload = GET node. |
| Auth | Same cookie as wiki. No cookie **401**; outsider **403**; missing from-node **404**. |
| Create node | Do **not** add `parent_id` / `include` on `POST .../nodes`. Two writes: create, then include or ref. |
| DELETE / unlink | Out. |
| Activity / DO / `ref_node_id` | Out. Include-only does not wake the room. |
| PWA | Out. Extra GET keys are ignored by the existing store. Do not edit `src/app/*`. |
| Catalog / room | Do not modify `catalog.ts`, `catalog-http.ts`, `src/room/*`, `wrangler.jsonc`. |

---

## File map

- `docs/superpowers/plans/2026-08-28-projthread-node-rel.md` — this plan
- `src/lib/node-rel.ts` — `wouldCycleIncludes`
- `src/lib/node-rel.test.ts` — cycle cases
- `migrations/0005_node_rel.sql` — table + index
- `src/worker/wiki.ts` — store methods + memory impl
- `src/worker/wiki.test.ts` — include / ref / attach independence
- `src/worker/wiki-http.ts` — routes + GET shape
- `src/worker/wiki-http.test.ts` — contract HTTP
- docs after landing — STATUS, AGENTS, v1 index, spec parked paragraph

---

## Out of this slice (explicit)

| Deferred | Why |
| --- | --- |
| PWA outline / attachment list | José: ignore interface; card detail is crude. |
| GET work-item → nodes | Attach list is catalog chrome later. |
| Activity on attach/include | Tape is sequence, not inventory; keep DO asleep. |
| DELETE rel, transclusion, deep GET | Agent walks one level. |
| `node.parent_id` | Would shape the whole wiki as a folder tree. |
| Ontology, graph canvas, node versioning | Named absences. |
| Child rooms | Named absence. Wrong primitive. |
| Deploy | Parked on custom domain. |

---

## STATUS.md after this slice

When the last task lands (not when this file is only written):

**Live:** … + node–node `includes` + `ref` (GET outline/cites without child content; attach still `node_work_item`)
**Now:** no open slice. Park Deploy until a custom domain exists.
**Next:** when a domain exists, write the Deploy plan. Until then, wait.
**Parked (product):** node-rel **HTTP shipped**. PWA outline/attachment chrome still parked. Ontology / graph canvas / child rooms still absences.

---

### Task 1: Maps

Files: this plan, `docs/STATUS.md`, `AGENTS.md`, `docs/superpowers/plans/2026-08-26-projthread-v1.md`, spec parked section.

- [x] Step 1: STATUS **Now:** execute this plan. Do not implement Deploy. Do not start PWA chrome for outlines.
- [x] Step 2: AGENTS **Now:** node-rel plan (see STATUS).
- [x] Step 3: Index a plan **9** row: `2026-08-28-projthread-node-rel.md`. Ships: `node_rel` includes + ref HTTP; no PWA.
- [x] Step 4: Spec **Parked: node edges** — this slice **ships both HTTP kinds**; UI still out; attach still independent.
- [x] Step 5: Commit docs: `docs: node-rel plan (includes + ref HTTP, no PWA)`

### Task 2: Cycle helper (includes only)

Files: create `src/lib/node-rel.ts`, `src/lib/node-rel.test.ts`. Do not import `project-tree.ts`.

```ts
export type IncludeEdge = { from_id: string; to_id: string };

export function wouldCycleIncludes(
  parentId: string,
  childId: string,
  edges: IncludeEdge[],
): boolean {
  if (parentId === childId) return true;
  const children = new Map<string, string[]>();
  for (const e of edges) {
    const list = children.get(e.from_id) ?? [];
    list.push(e.to_id);
    children.set(e.from_id, list);
  }
  const seen = new Set<string>();
  const stack = [childId];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    if (id === parentId) return true;
    for (const c of children.get(id) ?? []) stack.push(c);
  }
  return false;
}
```

Tests (`node --test --experimental-strip-types src/lib/node-rel.test.ts`):

- self: `wouldCycleIncludes("a", "a", [])` true
- A includes B, adding B includes A true
- A includes B, adding A includes C false
- empty edges, A includes B false

- [x] Step 1: Write tests, then helper, until PASS.
- [x] Step 2: Commit `feat: includes cycle-check (node-rel)`

### Task 3: D1 + WikiStore

Files: `migrations/0005_node_rel.sql`, `src/worker/wiki.ts`, `src/worker/wiki.test.ts`.

Migration:

```sql
CREATE TABLE node_rel (
  from_id TEXT NOT NULL REFERENCES node(id),
  to_id TEXT NOT NULL REFERENCES node(id),
  kind TEXT NOT NULL CHECK (kind IN ('includes', 'ref')),
  position INTEGER,
  PRIMARY KEY (from_id, to_id, kind),
  CHECK (
    (kind = 'includes' AND position IS NOT NULL)
    OR (kind = 'ref' AND position IS NULL)
  )
);

CREATE INDEX idx_node_rel_from ON node_rel (from_id, kind, position);
```

Types:

```ts
export type RelKind = "includes" | "ref";
export type IncludeRow = { id: string; title: string; position: number };
export type RefRow = { id: string; title: string };
```

Add to `WikiStore` (keep existing methods):

- `listIncludes(fromId): Promise<IncludeRow[]>`
- `listRefs(fromId): Promise<RefRow[]>`
- `listIncludeEdges(workspaceId): Promise<IncludeEdge[]>` — both ends in that workspace (join `node`)
- `includeNode(fromId, toId, position): Promise<"inserted" | "exists">` — `INSERT OR REPLACE` so a second include can move `position`
- `refNode(fromId, toId): Promise<"inserted" | "exists">` — `INSERT OR IGNORE`

Memory store: a `Map` keyed `from:to:kind`. `includeNode` always writes (replace). `refNode` skip if present.

Store tests (memory): two nodes same ws, one other ws.

1. include n1→n2 pos 0; `listIncludes("n1")` is `[{ id: n2, title, position: 0 }]`; `listRefs("n1")` `[]`
2. ref n1→n3; `listRefs` has n3 title; includes still only n2
3. include **and** ref n1→n2; both lists contain n2; titles no `content` field
4. `linkNodeWorkItem(n2, wi-1)` does not change includes/refs
5. `listIncludeEdges` does not include a ref-only edge

- [x] Step 1: Tests then store. PASS `src/worker/wiki.test.ts`
- [x] Step 2: Commit `feat: node_rel store (includes + ref)`

### Task 4: HTTP contract

Files: `src/worker/wiki-http.ts`, `src/worker/wiki-http.test.ts`.

`matchNodePath` tails: `work-items` | `includes` | `refs`. Dispatch POST includes / POST refs.

`nodeResponse` always loads `work_item_ids`, `includes`, `listRefs`. Existing GET/create/patch/link tests must assert `includes: []` and `refs: []` on a fresh node (update the current GET-node test).

Include POST:

- load `child` via `wiki.getNode(child_id)`; missing or other workspace **400**
- `wouldCycleIncludes(from.id, child.id, await wiki.listIncludeEdges(from.workspace_id))` → **400**
- position: if omitted, `max(existing positions)+1` or `0`; if present, must be integer (not float / string) else **400**
- `includeNode` then `nodeResponse` 201/200 (`exists` if that pair+kind already existed **before** write — memory/D1: check listIncludes for child id first)

Ref POST:

- `to_id` required string
- load to-node; missing / other workspace / `to_id === from.id` **400**
- if `"position" in body` **400**
- `refNode` 201/200

New HTTP cases (same `memberContext` as wiki-http.test):

1. GET fresh node: `includes` `[]`, `refs` `[]`, `work_item_ids` `[]`
2. POST includes `{ child_id }` 201; GET parent `includes[0].title` set, `"content" in includes[0]` false; GET child `includes` still `[]`
3. POST includes same child 200; still one include
4. POST refs `{ to_id: otherPlan }` 201; GET `refs[0].id` is otherPlan; `includes` unchanged
5. POST refs otherPlan→parent (reverse) 201 (cycle allowed)
6. POST includes that would cycle 400; GET includes unchanged
7. POST includes `{ child_id: otherWorkspaceNode }` 400
8. POST refs with `{ to_id, position: 0 }` 400
9. POST includes then `POST work-items`; GET has both `includes` and `work_item_ids`; neither clobbers
10. outsider POST includes 403; missing from id 404; no cookie 401

- [x] Step 1: Extend routing + `nodeResponse`. Tests PASS `src/worker/wiki-http.test.ts`
- [x] Step 2: Commit `feat: includes and ref HTTP`

### Task 5: Local D1 smoke + STATUS

Apply `0005` on local D1 the same way previous wiki migrations were applied at smoke (wrangler). Do not deploy.

- [x] Step 1: `node --test --experimental-strip-types src/lib/node-rel.test.ts src/worker/wiki.test.ts src/worker/wiki-http.test.ts` PASS
- [x] Step 2: STATUS Live adds includes+ref HTTP. Now: no open slice. Park Deploy. Parked product: PWA outline/attachment chrome only (HTTP shipped). Index: plan 9 landed. AGENTS Now: no open slice.
- [x] Step 3: Commit `docs: node-rel landed (includes + ref HTTP)`
