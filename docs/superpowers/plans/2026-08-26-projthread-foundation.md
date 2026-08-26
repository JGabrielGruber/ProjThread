# ProjThread Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One Worker, one origin, D1, Cloudflare Access on `/admin`, session cookies the operator can mint, and a public PWA that reads `/api/me` or shows “no session.”

**Architecture:** Static Vite assets (`src/app` → `/`, `src/admin` → `/admin`). Worker (`src/worker/index.ts`) is the origin: Access on `/admin*` and `/api/admin/*`; cookie on `/api/me`. Session id is opaque (`pt_session` → D1 `session` row). Copy PalmEngine Access verification; do not invent JWT crypto.

**Tech Stack:** Vite 6, Vue 3, TypeScript, Wrangler 4, D1, `node --test --experimental-strip-types`. No Durable Objects, PrimeVue, Vectorize, R2, or Pinia features beyond a tiny status/session store. No hostname literals.

---

## File map

| Path | Job |
| --- | --- |
| `package.json`, `tsconfig.json`, `wrangler.jsonc`, `.gitignore`, `.dev.vars.example` | Tooling |
| `migrations/0001_auth.sql` | `principal`, `session`, `organization` |
| `src/lib/id.ts` | ULID |
| `src/lib/cookies.ts` | `pt_session` parse/serialize |
| `src/worker/access.ts` | Access JWT + `X-Admin-Dev` (from PalmEngine) |
| `src/worker/env.ts` | `Env` type |
| `src/worker/session.ts` | Mint, lookup, revoke (injectable DB) |
| `src/worker/admin.ts` | `/api/admin/principals`, `/api/admin/sessions` |
| `src/worker/me.ts` | `GET /api/me` |
| `src/worker/shell.ts` | Serve `/admin` HTML from `ASSETS` after Access |
| `src/worker/index.ts` | Dispatch |
| `src/admin/` | Super-admin SPA: principals + mint |
| `src/app/` | Public PWA shell: no-session vs principal name |

Do not add `Room`, PrimeVue, or wiki in this plan.

---

### Task 1: Maps

**Files:**
- Modify: `docs/STATUS.md`
- Modify: `AGENTS.md`
- Create: this plan, `docs/superpowers/plans/2026-08-26-projthread-v1.md`

- [ ] **Step 1: Point STATUS at foundation**

Set:

```
**Now:** foundation plan (session vending)
**Plan:** `docs/superpowers/plans/2026-08-26-projthread-foundation.md`
**Spec:** `docs/superpowers/specs/2026-08-26-projthread-v1-design.md`
```

- [ ] **Step 2: Point AGENTS.md “Read next” at the spec + this plan**

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md docs/STATUS.md docs/superpowers/specs/2026-08-26-projthread-v1-design.md docs/superpowers/plans/ docs/context/
git commit -m "docs: approve v1 spec and foundation plan"
```

---

### Task 2: Tooling skeleton

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `wrangler.jsonc`
- Create: `.gitignore`
- Create: `.dev.vars.example`

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "projthread",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22.12.0" },
  "scripts": {
    "dev": "wrangler dev",
    "dev:app": "vite --config src/app/vite.config.ts",
    "dev:admin": "vite --config src/admin/vite.config.ts",
    "build:app": "vite build --config src/app/vite.config.ts",
    "build:admin": "vite build --config src/admin/vite.config.ts",
    "build": "npm run build:app && npm run build:admin",
    "deploy": "npm run build && wrangler deploy",
    "test": "node --test --experimental-strip-types src/lib/*.test.ts src/worker/*.test.ts",
    "types": "wrangler types"
  }
}
```

Install (no Daisy, no PrimeVue yet):

```bash
npm install vue vue-router
npm install -D vite @vitejs/plugin-vue wrangler typescript
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "lib": ["ES2022", "DOM"],
    "types": []
  },
  "include": ["src/**/*"],
  "exclude": ["dist"]
}
```

- [ ] **Step 3: Write `wrangler.jsonc`**

No custom domain. No `POLICY_AUD` until deploy. `database_id` may be `"local"` until `wrangler d1 create`.

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "projthread",
  "compatibility_date": "2026-08-26",
  "main": "src/worker/index.ts",
  "assets": {
    "directory": "./dist",
    "binding": "ASSETS",
    "run_worker_first": ["/api/*", "/admin", "/admin/*"]
  },
  "vars": {
    "APP_ORIGIN": "http://127.0.0.1:8787"
  },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "projthread",
      "database_id": "local",
      "migrations_dir": "migrations"
    }
  ]
}
```

- [ ] **Step 4: `.gitignore` and `.dev.vars.example`**

`.gitignore` already has `node_modules/`, `dist/`, `.wrangler/`, `.dev.vars`. Keep it.

`.dev.vars.example`:

```
ADMIN_DEV_SECRET=local-dev-secret
# POLICY_AUD=
# TEAM_DOMAIN=
```

Copy to `.dev.vars` locally (gitignored).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tsconfig.json wrangler.jsonc .gitignore .dev.vars.example
git commit -m "chore: Vite + Wrangler + D1 skeleton"
```

---

### Task 3: ULID

**Files:**
- Create: `src/lib/id.ts`
- Create: `src/lib/id.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { newId } from "./id.ts";

describe("newId", () => {
  it("returns 26 Crockford characters", () => {
    const id = newId();
    assert.match(id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it("is unique across many calls", () => {
    const set = new Set(Array.from({ length: 200 }, () => newId()));
    assert.equal(set.size, 200);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL** (`newId` not found)

```bash
node --test --experimental-strip-types src/lib/id.test.ts
```

- [ ] **Step 3: Implement `src/lib/id.ts`**

```ts
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
```

- [ ] **Step 4: Run test — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add src/lib/id.ts src/lib/id.test.ts
git commit -m "feat: ULID generator for D1 primary keys"
```

---

### Task 4: Access (copy PalmEngine)

**Files:**
- Create: `src/worker/access.ts`
- Create: `src/worker/access.test.ts`

- [ ] **Step 1: Copy and keep tests green**

```bash
cp ~/Projects/PalmEngine/blog/src/worker/admin/access.ts src/worker/access.ts
cp ~/Projects/PalmEngine/blog/src/worker/admin/access.test.ts src/worker/access.test.ts
```

Fix imports if the test file used `./access.ts` (it already does). Do not change bypass semantics: `X-Admin-Dev` matches `ADMIN_DEV_SECRET`; if `ADMIN_DEV_SECRET` is set and `POLICY_AUD` is unset, wrangler preview is allowed; once `POLICY_AUD` exists, JWT is required.

- [ ] **Step 2: Run**

```bash
node --test --experimental-strip-types src/worker/access.test.ts
```

Expected: PASS (same suite as the blog).

- [ ] **Step 3: Commit**

```bash
git add src/worker/access.ts src/worker/access.test.ts
git commit -m "feat: Cloudflare Access gate for admin plane"
```

---

### Task 5: Cookie helpers

**Files:**
- Create: `src/lib/cookies.ts`
- Create: `src/lib/cookies.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { COOKIE_NAME, parseSessionId, serializeSessionCookie } from "./cookies.ts";

describe("cookies", () => {
  it("parses pt_session from Cookie header", () => {
    assert.equal(
      parseSessionId("foo=1; pt_session=01ABCDEFGHJKMNPQRSTVWXYZ12"),
      "01ABCDEFGHJKMNPQRSTVWXYZ12",
    );
  });

  it("returns null when missing", () => {
    assert.equal(parseSessionId("foo=1"), null);
  });

  it("sets HttpOnly Path=/ SameSite=Lax and omits Secure on http APP_ORIGIN", () => {
    const v = serializeSessionCookie("01ID", "http://127.0.0.1:8787", 30);
    assert.equal(COOKIE_NAME, "pt_session");
    assert.match(v, /pt_session=01ID/);
    assert.match(v, /HttpOnly/i);
    assert.match(v, /Path=\//);
    assert.match(v, /SameSite=Lax/i);
    assert.doesNotMatch(v, /Secure/);
  });

  it("sets Secure on https APP_ORIGIN", () => {
    const v = serializeSessionCookie("01ID", "https://example.com", 30);
    assert.match(v, /Secure/i);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `src/lib/cookies.ts`**

`Max-Age` = days * 86400. `serializeClearSessionCookie(origin)` for revoke (Max-Age=0).

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add src/lib/cookies.ts src/lib/cookies.test.ts
git commit -m "feat: pt_session cookie parse and serialize"
```

---

### Task 6: Auth schema

**Files:**
- Create: `migrations/0001_auth.sql`

- [ ] **Step 1: Write migration**

```sql
CREATE TABLE principal (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('human', 'agent', 'service')),
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE session (
  id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL REFERENCES principal(id),
  minted_by TEXT NOT NULL REFERENCES principal(id),
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_session_principal ON session (principal_id);

CREATE TABLE organization (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

- [ ] **Step 2: Apply locally**

```bash
npx wrangler d1 migrations apply projthread --local
```

Expected: applied `0001_auth.sql`.

- [ ] **Step 3: Commit**

```bash
git add migrations/0001_auth.sql
git commit -m "feat: D1 principal, session, organization"
```

---

### Task 7: Session module (injectable DB)

**Files:**
- Create: `src/worker/session.ts`
- Create: `src/worker/session.test.ts`
- Create: `src/worker/env.ts`

`Env`:

```ts
export type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_ORIGIN: string;
  ADMIN_DEV_SECRET?: string;
  POLICY_AUD?: string;
  TEAM_DOMAIN?: string;
};
```

Session DB port:

```ts
export type Principal = {
  id: string;
  type: "human" | "agent" | "service";
  display_name: string;
};

export type SessionRow = {
  id: string;
  principal_id: string;
  minted_by: string;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
};

export type SessionStore = {
  getPrincipal(id: string): Promise<Principal | null>;
  insertPrincipal(p: Principal & { created_at: string }): Promise<void>;
  listPrincipals(): Promise<Principal[]>;
  insertSession(row: SessionRow): Promise<void>;
  getSession(id: string): Promise<SessionRow | null>;
  revokeSession(id: string, at: string): Promise<void>;
};
```

- [ ] **Step 1: Write failing tests** with an in-memory `SessionStore`

Cases:

- `mintSession` throws if principal missing
- `mintSession` inserts row, `expires_at` = now + 30 days (inject `now`)
- `resolveSession` returns principal for a live row
- `resolveSession` returns null if expired, revoked, or missing
- `revokeSession` sets `revoked_at`; later resolve is null

Use `newId` from `src/lib/id.ts`. Do not touch real D1 in this unit test.

- [ ] **Step 2: Run — expect FAIL**

```bash
node --test --experimental-strip-types src/worker/session.test.ts
```

- [ ] **Step 3: Implement `mintSession`, `resolveSession`, `revokeSession` in `src/worker/session.ts`**

Also `d1SessionStore(db: D1Database): SessionStore` using prepared statements. Keep SQL in this file.

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add src/worker/session.ts src/worker/session.test.ts src/worker/env.ts
git commit -m "feat: session mint, resolve, revoke"
```

---

### Task 8: Worker routes

**Files:**
- Create: `src/worker/admin.ts`
- Create: `src/worker/admin.test.ts`
- Create: `src/worker/me.ts`
- Create: `src/worker/me.test.ts`
- Create: `src/worker/shell.ts`
- Create: `src/worker/index.ts`

JSON errors: `{ error: "unauthorized" | "forbidden" | "not_found" | "bad_request", ... }` with 401/403/404/400.

**Admin (after `authorizeAdmin`):**

| Method | Path | Body | Result |
| --- | --- | --- | --- |
| GET | `/api/admin/principals` | | `{ principals }` |
| POST | `/api/admin/principals` | `{ type, display_name }` | 201 principal |
| POST | `/api/admin/sessions` | `{ principal_id }` | 201 + `Set-Cookie` |
| POST | `/api/admin/sessions/:id/revoke` | | 204 + clear cookie if it matches |

`minted_by`: v1 use the target principal’s id if we have no operator principal yet **or** create a bootstrap: first `POST /api/admin/principals` is fine; `minted_by` = that principal when the operator mints for them. Spec: `minted_by` references `principal`. Use the minted principal as `minted_by` when the operator is Access-only (no principal row for José yet). Add `POST` that can mint for principal A with `minted_by = A` in v1. Do not invent an Access→principal link in this plan.

**App:**

| Method | Path | Gate | Result |
| --- | --- | --- | --- |
| GET | `/api/me` | cookie | `{ principal }` or 401 |

- [ ] **Step 1: Write `admin.test.ts` and `me.test.ts` with fake `SessionStore` + fake `authorizeAdmin` via injecting handlers `handleAdmin(req, env, store)` / `handleMe(req, store, origin)`**

Cover: 403/401 without Access is **not** this unit (Access is tested). Here, assume already authorized:

- POST principal `type: "human"`
- POST session → `set-cookie` contains `pt_session=`
- GET me with that cookie → principal
- GET me without cookie → 401
- revoke → GET me 401

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement handlers + `index.ts` dispatch**

```ts
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const store = d1SessionStore(env.DB);

    if (url.pathname.startsWith("/api/admin")) {
      if (!(await authorizeAdmin(request, env))) return adminForbidden(request);
      return handleAdmin(request, env, store);
    }

    if (url.pathname === "/api/me") {
      return handleMe(request, env, store);
    }

    if (url.pathname.startsWith("/api/")) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }

    if (isAdminPath(url.pathname)) {
      if (!(await authorizeAdmin(request, env))) return adminForbidden(request);
      return handleAdminShell(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};
```

`isAdminPath`: `/admin` or `/admin/...`. Shell: `env.ASSETS.fetch(new URL("/admin/index.html", request.url))` for history routes.

- [ ] **Step 4: Run all worker tests — expect PASS**

```bash
npm test
```

- [ ] **Step 5: Commit**

```bash
git add src/worker
git commit -m "feat: admin session API and GET /api/me"
```

---

### Task 9: Asset shells

**Files:**
- Create: `src/app/index.html`, `src/app/main.ts`, `src/app/App.vue`, `src/app/vite.config.ts`, `src/app/styles.css`
- Create: `src/admin/index.html`, `src/admin/main.ts`, `src/admin/App.vue`, `src/admin/vite.config.ts`

App Vite `base: '/'`, `outDir: ../../dist`.  
Admin Vite `base: '/admin/'`, `outDir: ../../dist/admin`.

- [ ] **Step 1: App `App.vue`**

On mount `GET /api/me` with `credentials: 'include'`.

- 401: heading “No session” (not a marketing page).
- 200: show `principal.display_name` and `principal.type`.

CSS: only semantic variables on `:root` — `--bg`, `--fg`, `--muted`, `--accent`, `--danger`, `--radius`, `--font`. Dark-first. No hex in the Vue file except inside `styles.css` token file (one place). No PrimeVue, no Daisy.

- [ ] **Step 2: Admin `App.vue`**

- List principals (`GET /api/admin/principals`)
- Form: display_name + type select → POST
- Button “Mint session” per row → POST `/api/admin/sessions` `{ principal_id }` then `location.href = '/'` (cookie is set)

Fetch admin with `credentials: 'include'`. For local Access bypass, `wrangler dev` with `.dev.vars` `ADMIN_DEV_SECRET` is enough; do not send `X-Admin-Dev` from the browser unless documented in admin as a query/dev-only header field. Match PalmEngine: wrangler without `POLICY_AUD` allows the shell.

- [ ] **Step 3: `npm run build` then `npx wrangler d1 migrations apply projthread --local && npx wrangler dev`**

Smoke (hand):

1. Open `/` → “No session”
2. Open `/admin` → form
3. Create principal, mint → land on `/` with name

- [ ] **Step 4: Commit**

```bash
git add src/app src/admin
git commit -m "feat: public PWA shell and admin session mint UI"
```

---

### Task 10: STATUS

**Files:**
- Modify: `docs/STATUS.md`

- [ ] **Step 1: Mark foundation shipped** (only after smoke works)

```
**Live:** local wrangler — Access admin, session cookie, GET /api/me
**Now:** next plan = catalog (not written)
```

- [ ] **Step 2: Commit**

```bash
git add docs/STATUS.md
git commit -m "docs: foundation slice live on wrangler dev"
```

---

## Out of scope (this plan)

Kanban, Room DO, Activity, wiki, PrimeVue, membership, projects, deploy domain, `POLICY_AUD` in wrangler.
