# ProjThread Session Bearer Implementation Plan

> For Grok Build: one session, one slice. Compact after each task. Scout only if a file is not where this plan says. Do not add tests the plan did not ask for. Stop when STATUS is updated. Do not dispatch reviewer or superpowers:subagent-driven-development sub-agents.

**Goal:** Non-browser clients (Grok Bot, curl, later MCP) present the same D1 `session` as `Authorization: Bearer <session.id>`, and admin can **issue** that id without overwriting the operator’s cookie.

**Architecture:** One helper `sessionIdFromRequest`. If the request carries a Bearer scheme, that token is the only credential (no cookie fallback). Otherwise keep `pt_session`. Admin `POST /api/admin/sessions` gains `set_cookie: false` for issue-token. Same `session` row, same `resolveSession`, same membership. No new table, no OAuth, no KV, no MCP.

**Tech Stack:** Existing Worker + D1, admin Vue (tokens only), `node --test --experimental-strip-types`. No new bindings, no PrimeVue, no PWA store changes, no Room/WS Bearer, no MCP.

---

## Locked calls (do not re-litigate)

| Topic | Call |
| --- | --- |
| Credential | Opaque `session.id` (already minted). Not a second token type. |
| HTTP app gate | `sessionIdFromRequest` → `resolveSession` → membership. `/api/me`, catalog, wiki. |
| Bearer parse | `Authorization` matching `/^Bearer\b/i`: use the token (`\S+` after `Bearer`). Missing token → empty string → 401. **Do not** fall back to cookie. |
| Non-Bearer `Authorization` | Ignore; use cookie. |
| No Authorization | Cookie `pt_session` unchanged. |
| WS / `room-http.ts` | **Cookie only.** Do not touch. |
| Admin default mint | `{ principal_id }` still **201 + Set-Cookie** (Enter as). |
| Issue token | `{ principal_id, set_cookie: false }` → **201 `{ session }`**, **no** `Set-Cookie`. Only boolean `false` suppresses the cookie. |
| Admin UI | Per principal: **Enter as** (today’s mint + redirect) and **Issue token** (no redirect; show id + `expires_at` once; copy). |
| Membership | Out. Create agent principal in admin, add member in Config, then issue. |
| List/revoke UI | Out. `POST /api/admin/sessions/:id/revoke` stays. |
| Access | Unchanged. Service Credential is admin-plane only. Do not put Access on `/api/*` or `/mcp`. |
| MCP / OAuth / KV | Named absences. |

---

## File map

- `docs/superpowers/plans/2026-08-28-projthread-session-bearer.md` — this plan
- `src/lib/session-id.ts` — `parseBearerSessionId`, `sessionIdFromRequest`
- `src/lib/session-id.test.ts` — parse rules
- `src/worker/me.ts`, `catalog-http.ts`, `wiki-http.ts` — use helper
- `src/worker/me.test.ts`, `catalog-http.test.ts`, `wiki-http.test.ts` — Bearer wiring
- `src/worker/admin.ts` — `set_cookie: false`
- `src/worker/admin.test.ts` — no Set-Cookie on issue
- `src/admin/App.vue` — Enter as / Issue token
- docs after landing — STATUS, AGENTS, spec auth + absences

Do not modify `src/worker/room-http.ts`, `src/room/*`, `src/app/*`, `wrangler.jsonc`, migrations.

---

## Out of this slice (explicit)

| Deferred | Why |
| --- | --- |
| MCP `/mcp` | Adapter after agents can already hit HTTP. |
| Distinct agent tokens / OAuth | Same session id is enough for one operator + Grok Bot. |
| Bearer on WS | Room is not the agent path. |
| Session list UI | Revoke-by-id exists; do not grow admin into Config. |
| Access on `/api/*` | Would break the PWA cookie plane. |
| Deploy | Parked on custom domain. |

---

## STATUS.md after this slice

When the last task lands (not when this file is only written):

**Live:** … + app HTTP accepts `Authorization: Bearer <session.id>` (same D1 session as `pt_session`); admin **Issue token** (`set_cookie: false`, no operator cookie clobber) alongside **Enter as**.
**Now:** no open slice. Park Deploy until a custom domain exists.
**Next:** when a domain exists, write the Deploy plan. Until then, wait. (MCP stays an absence.)
**Parked (product):** PWA outline / attachment chrome. MCP. Distinct agent OAuth tokens.

---

### Task 1: Maps

Files: this plan, `docs/STATUS.md`, `AGENTS.md`, `docs/superpowers/plans/2026-08-26-projthread-v1.md`, spec parked section.

- [x] Step 1: STATUS **Now:** execute this plan. Do not implement Deploy. Do not start MCP.
- [x] Step 2: AGENTS **Now:** session-bearer plan (see STATUS).
- [x] Step 3: Index a plan **10** row: `2026-08-28-projthread-session-bearer.md`. Ships: Bearer on existing session + admin issue-token.
- [x] Step 4: Spec **Parked: session Bearer** — this slice ships same-id Bearer on app HTTP; MCP still out.

---

### Task 2: Session id helper

Files: create `src/lib/session-id.ts`, `src/lib/session-id.test.ts`. Import `parseSessionId` from `src/lib/cookies.ts`. Do not change cookie serialization.

```ts
import { parseSessionId } from "./cookies.ts";

export function parseBearerSessionId(
  authorization: string | null,
): string | null {
  if (authorization == null) return null;
  const trimmed = authorization.trim();
  if (!/^Bearer\b/i.test(trimmed)) return null;
  const match = /^Bearer\s+(\S+)/i.exec(trimmed);
  return match?.[1] ?? "";
}

export function sessionIdFromRequest(request: Request): string | null {
  const bearer = parseBearerSessionId(request.headers.get("authorization"));
  if (bearer !== null) return bearer;
  return parseSessionId(request.headers.get("cookie"));
}
```

- [x] **Step 1: Failing tests** in `src/lib/session-id.test.ts`

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseBearerSessionId,
  sessionIdFromRequest,
} from "./session-id.ts";

const ID = "01ABCDEFGHJKMNPQRSTVWXYZ12";

describe("parseBearerSessionId", () => {
  it("reads Bearer token case-insensitively", () => {
    assert.equal(parseBearerSessionId(`Bearer ${ID}`), ID);
    assert.equal(parseBearerSessionId(`bearer ${ID}`), ID);
  });

  it("returns empty string for Bearer with no token", () => {
    assert.equal(parseBearerSessionId("Bearer"), "");
    assert.equal(parseBearerSessionId("Bearer   "), "");
  });

  it("returns null when missing or not Bearer", () => {
    assert.equal(parseBearerSessionId(null), null);
    assert.equal(parseBearerSessionId("Basic abc"), null);
  });
});

describe("sessionIdFromRequest", () => {
  it("prefers Bearer over cookie", () => {
    const req = new Request("http://127.0.0.1/api/me", {
      headers: {
        authorization: `Bearer ${ID}`,
        cookie: "pt_session=01COOKIESESSIONID00000000000",
      },
    });
    assert.equal(sessionIdFromRequest(req), ID);
  });

  it("does not fall back to cookie on empty Bearer", () => {
    const req = new Request("http://127.0.0.1/api/me", {
      headers: {
        authorization: "Bearer",
        cookie: `pt_session=${ID}`,
      },
    });
    assert.equal(sessionIdFromRequest(req), "");
  });

  it("uses cookie when Authorization is absent or not Bearer", () => {
    const cookieReq = new Request("http://127.0.0.1/api/me", {
      headers: { cookie: `pt_session=${ID}` },
    });
    assert.equal(sessionIdFromRequest(cookieReq), ID);

    const basic = new Request("http://127.0.0.1/api/me", {
      headers: {
        authorization: "Basic abc",
        cookie: `pt_session=${ID}`,
      },
    });
    assert.equal(sessionIdFromRequest(basic), ID);
  });
});
```

- [x] **Step 2: Run** `node --test --experimental-strip-types src/lib/session-id.test.ts` — FAIL (module missing).
- [x] **Step 3: Implement** `src/lib/session-id.ts` as above.
- [x] **Step 4: Run the same command** — PASS.

---

### Task 3: Wire app HTTP

Files: `src/worker/me.ts`, `src/worker/catalog-http.ts`, `src/worker/wiki-http.ts` and their tests.

Replace cookie-only gates:

```ts
import { sessionIdFromRequest } from "../lib/session-id.ts";

const sessionId = sessionIdFromRequest(request);
```

Remove the `parseSessionId` import from those three files. Keep `resolveSession` as-is (`""` → null → 401).

Do **not** change `src/worker/room-http.ts` or `src/worker/admin.ts` (admin revoke still matches the operator cookie).

- [x] **Step 1: Failing tests**

`src/worker/me.test.ts` — `mintCookie` already returns `session`. Add:

```ts
  it("returns the principal for a live Bearer session", async () => {
    const store = memoryStore();
    const { principal, session } = await mintCookie(store);
    const res = await handleMe(
      new Request(`${ORIGIN}/api/me`, {
        headers: { authorization: `Bearer ${session.id}` },
      }),
      env,
      store,
      memoryCatalog(),
    );
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { principal, memberships: [] });
  });

  it("returns 401 for a bad Bearer even when the cookie is live", async () => {
    const store = memoryStore();
    const { cookie } = await mintCookie(store);
    const res = await handleMe(
      new Request(`${ORIGIN}/api/me`, {
        headers: { authorization: "Bearer", cookie },
      }),
      env,
      store,
      memoryCatalog(),
    );
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: "unauthorized" });
  });
```

`src/worker/catalog-http.test.ts` — import `COOKIE_NAME` if missing; after the existing 401-without-cookie test:

```ts
  it("GET projects accepts a live Bearer session", async () => {
    const { cookie, catalog, bundle, sessions } = await memberContext();
    const sessionId = cookie.slice(`${COOKIE_NAME}=`.length);
    const res = await handleCatalog(
      new Request(
        `${ORIGIN}/api/workspaces/${bundle.workspace.id}/projects`,
        { headers: { authorization: `Bearer ${sessionId}` } },
      ),
      env,
      sessions,
      catalog,
    );
    assert.equal(res.status, 200);
  });
```

`src/worker/wiki-http.test.ts` — import `COOKIE_NAME` from `../lib/cookies.ts` if missing; after “GET list member is 200 empty nodes”:

```ts
  it("GET list member accepts a live Bearer session", async () => {
    const { cookie, catalog, wiki, bundle, sessions } = await memberContext();
    const sessionId = cookie.slice(`${COOKIE_NAME}=`.length);
    const res = await handleWiki(
      new Request(`${ORIGIN}/api/workspaces/${bundle.workspace.id}/nodes`, {
        headers: { authorization: `Bearer ${sessionId}` },
      }),
      env,
      sessions,
      catalog,
      wiki,
    );
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { nodes: [] });
  });
```

Keep existing cookie 401/200 tests.

- [x] **Step 2: Run** `node --test --experimental-strip-types src/worker/me.test.ts src/worker/catalog-http.test.ts src/worker/wiki-http.test.ts` — new cases FAIL.
- [x] **Step 3: Wire** the three handlers to `sessionIdFromRequest`.
- [x] **Step 4: Re-run** — PASS. Cookie-only tests still pass.

---

### Task 4: Admin issue without Set-Cookie

Files: `src/worker/admin.ts` `createSession`, `src/worker/admin.test.ts`.

In `createSession`, after validating `principal_id`:

```ts
  const setCookie = body.set_cookie !== false;
```

Return 201 `{ session }` with `Set-Cookie` only when `setCookie` is true.

- [x] **Step 1: Failing test** in the existing mint describe, after the Set-Cookie case:

```ts
  it("omits Set-Cookie when set_cookie is false", async () => {
    const store = memoryStore();
    const created = await handleAdmin(
      adminRequest("/api/admin/principals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "agent", display_name: "Grok Bot" }),
      }),
      env,
      store,
      stubCatalog(),
    );
    const principal = (await created.json()) as Principal;

    const minted = await handleAdmin(
      adminRequest("/api/admin/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          principal_id: principal.id,
          set_cookie: false,
        }),
      }),
      env,
      store,
      stubCatalog(),
    );
    assert.equal(minted.status, 201);
    assert.equal(minted.headers.get("set-cookie"), null);
    const body = (await minted.json()) as { session: SessionRow };
    assert.equal(body.session.principal_id, principal.id);
    assert.ok(body.session.id);
    assert.ok(body.session.expires_at);
  });
```

Default mint test must still assert Set-Cookie.

- [x] **Step 2: Run** `node --test --experimental-strip-types src/worker/admin.test.ts` — FAIL (cookie still set).
- [x] **Step 3: Implement** `set_cookie !== false` in `createSession`.
- [x] **Step 4: Re-run** — PASS.

---

### Task 5: Admin Vue — Enter as / Issue token

Files: `src/admin/App.vue` only. Tokens (`var(--*)`). No PrimeVue. No PWA.

Rename the existing mint button to **Enter as** (same `mint()`: POST `{ principal_id }`, then `location.href = "/"`).

Add **Issue token**: POST `{ principal_id, set_cookie: false }`, `credentials: "include"`. On 201, store `{ display_name, session_id, expires_at }` in a ref and render them (readonly input for the id + Copy). Do not redirect. Do not Set-Cookie on that path (Worker already omits it).

```ts
type Issued = {
  display_name: string;
  session_id: string;
  expires_at: string;
};

const issued = ref<Issued | null>(null);

async function issueToken(p: Principal) {
  error.value = "";
  issued.value = null;
  try {
    const res = await fetch("/api/admin/sessions", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ principal_id: p.id, set_cookie: false }),
    });
    if (!res.ok) {
      error.value = "Issue token failed";
      return;
    }
    const body = (await res.json()) as {
      session: { id: string; expires_at: string };
    };
    issued.value = {
      display_name: p.display_name,
      session_id: body.session.id,
      expires_at: body.session.expires_at,
    };
  } catch {
    error.value = "Issue token failed";
  }
}

async function copyIssued() {
  if (!issued.value) return;
  await navigator.clipboard.writeText(issued.value.session_id);
}
```

Template: keep the principal row; two buttons. Below the list, if `issued`:

```html
    <section v-if="issued" class="issued">
      <p>
        Token for {{ issued.display_name }} (expires {{ issued.expires_at }})
      </p>
      <input :value="issued.session_id" readonly name="issued_session_id" />
      <button type="button" @click="copyIssued">Copy</button>
    </section>
```

Style with existing `--fg` / `--muted` / `--accent`. No new color literals.

- [x] **Step 1: Edit** `src/admin/App.vue` as above.
- [x] **Step 2: `npm test`** — all existing tests still pass (no admin Vue test file).
- [x] **Step 3: Browser** — `npm run dev`. Access admin. **Enter as** still lands in the PWA as that principal. **Issue token** leaves you on admin, shows the id, does not replace `pt_session` for the operator. Copy works. (If clipboard is blocked, the readonly input is enough.)

---

### Task 6: Land docs

Files: `docs/STATUS.md`, `AGENTS.md`, `docs/superpowers/specs/2026-08-26-projthread-v1-design.md`.

- [x] **Step 1: STATUS** — Live line includes Bearer + Issue token. **Now:** no open slice. Park Deploy. MCP stays parked/absence.
- [x] **Step 2: AGENTS** — **Now:** no open slice. Invariants: app HTTP is cookie **or** Bearer; WS remains cookie. “Agent Bearer tokens later” → this thin path shipped; distinct OAuth / MCP still absences.
- [x] **Step 3: Spec** — Architecture table `/api/*` gate: cookie **or** `Authorization: Bearer <session.id>`. Auth §2: default mint Set-Cookie; `set_cookie: false` returns the row only. Replace “Agents’ native path later: Bearer…” with: v1 Bearer **is** the session id; distinct agent OAuth later. Named absences: drop “Bearer agents”; keep MCP.
- [x] **Step 4: `npm test`** once more.

Do not commit unless José asks. Do not write or implement Deploy or MCP.
