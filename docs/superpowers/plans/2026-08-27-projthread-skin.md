# ProjThread Skin + PWA Implementation Plan

> For Grok Build: one session, compact. Scout only if a file is not where this plan says. Do not add tests this plan did not ask for. Do not dispatch reviewer or superpowers:subagent-driven-development sub-agents. Stop when STATUS is updated.

**Goal:** Make the live PWA look like the spec's Grok/X-sharp skin (tokenized, dark-first, no hex in components) and installable. Extract the tiny native modal Config already uses inline, so dialogs are overlay plus tokens, not a kit.

**Architecture:** No Worker, D1, DO, or HTTP changes. CSS variables move to a shared token file both Vite apps import. One Modal.vue in src/app. Manifest plus tiny service worker on the app origin. Config UX stays list + dialog; only the chrome of the dialog changes.

**Tech Stack:** Existing Vue 3 + Pinia + Vite. Hand-rolled CSS variables. Hand-rolled sw.js (no vite-plugin-pwa). No Tailwind, Daisy, Nord, PrimeVue. No new npm deps. node --test --experimental-strip-types unchanged.

This slice is smaller than Config: no catalog, no stores, no new routes.

## Locked calls (do not re-litigate)

- Kit: Our Vue + CSS variables only. No Tailwind, Daisy, Nord, Prime, no new CSS framework, no component library.
- Hex: Only in src/styles/tokens.css. Components, scoped Vue CSS, and admin use var(--*).
- Tokens (required names): Keep --bg --fg --muted --accent --danger --radius --font. Add --surface --border --accent-hover --shadow --font-mono --measure. --measure is 65ch (wiki already uses 65ch; switch that rule to the token).
- Dark / light: Dark-first Grok/X-sharp (near-black, high contrast, dense). Light is a second token block. Default: prefers-color-scheme when no override. Override: html[data-theme=dark|light].
- Theme control: Tiny header control on App.vue: system / dark / light. Persist localStorage key pt-theme. Early inline script in src/app/index.html so first paint does not flash.
- Palette (dark starting point; refine, do not invent a third kit): --bg #0b0d10, --surface #14171c, --fg #e8eaed, --muted #8b919a, --border #2a3038, --accent #7aa2f7, --accent-hover #9cb6f7, --danger #f7768e, --shadow a dark 0.2 opacity. Light block: light paper bg, dark fg, same accent/danger.
- Modal: New src/app/Modal.vue. Teleport to body, backdrop, panel, role=dialog aria-modal=true, Esc + backdrop click emit close. No focus-trap library. Config's three dialogs use it. Do not change Config forms or Pinia.
- Config today: ConfigView.vue .modal is an inline bordered box, not an overlay. Replace that chrome with Modal. Keep the same fields/buttons.
- Product screens: Do not redesign Kanban / Room / Wiki layout. Token rename + wiki --measure only.
- Admin: Import the same tokens.css. Do not Prime-ify /admin. Do not rebuild admin UX.
- PWA: display standalone. start_url /. theme_color and background_color from --bg. Manifest + 192 and 512 PNG icons + SVG favicon. apple-mobile-web-app-capable.
- Service worker: src/app/public/sw.js, register from src/app/main.ts when location.protocol is https or localhost. Must have a fetch handler (Chromium installability). Do not intercept /api/* or WebSocket. Network-first for navigations; cache-first for /assets/* is enough. skipWaiting + clients.claim.
- vite-plugin-pwa: Do not add.
- Worker: wrangler.jsonc, D1, Room DO, catalog HTTP, wiki HTTP: untouched.
- Tests: No new Vue tests, no SW tests. Existing node --test must still PASS.
- Leave alone: src/room/*, src/worker/*, named absences (MCP, R2, Channels, child rooms, draggable windows, Chores).

## File map

Copy this plan into the working tree at docs/superpowers/plans/2026-08-27-projthread-skin.md in Task 1. Jose is fine committing this product plan to the public repo (no secrets).

- docs/superpowers/plans/2026-08-27-projthread-skin.md — this plan
- src/styles/tokens.css — :root + light block + html[data-theme]
- src/app/styles.css — reset / body only (no hex)
- src/app/main.ts — import tokens; register SW
- src/admin/main.ts — import tokens
- src/app/Modal.vue — tiny overlay dialog
- src/app/ConfigView.vue — use Modal for the three dialogs
- src/app/App.vue — theme control; nav buttons stay
- src/app/WikiView.vue — max-width var(--measure)
- src/app/index.html — manifest, theme-color, apple, early theme script
- src/app/public/manifest.webmanifest — name ProjThread, standalone
- src/app/public/icons/favicon.svg — geometric mark
- src/app/public/icons/icon-192.png and icon-512.png — install icons
- src/app/public/sw.js — fetch handler; skip /api
- docs/STATUS.md, AGENTS.md, v1 index — after smoke

Do not add a migration. Do not bind R2. Do not touch Room DO.

## Out of this slice

- Redesign kanban / room / wiki chrome: tokens + modal are the skin; layout already works.
- Tailwind / Daisy / Nord / Prime: locked out. Prime v5 is not OSS.
- Theme picker as a Config page: header cycle is enough.
- Full focus trap / drawer / toasts: tiny modal only.
- vite-plugin-pwa, Workbox, offline-first wiki: installability, not an offline product.
- Push notifications: not v1.
- Custom domain / APP_ORIGIN polish: Plan 8 (Deploy). workers.dev already live.
- /admin UX rebuild: tokens only.
- Owner picker, promote, MCP, Vectorize, R2, Channels, child rooms, Chores: named absences / other plans.

## STATUS.md after this slice (when Task 5 lands, not when this file is only written)

Live: local wrangler + workers.dev — Farm seed, membership, kanban, room + Activity, wiki (no promote), Config (our Vue), tokenized Grok/X-sharp skin, light/dark, installable PWA (manifest + SW; SW does not intercept /api/*).
Now: write the Deploy plan (custom domain; Access/D1 already on workers.dev). Do not implement Deploy until that plan exists.
Next after the plan: implement only what the Deploy plan names.
Landed plans: catalog, room, activity, wiki, config, skin (this file).
Index: docs/superpowers/plans/2026-08-26-projthread-v1.md
Spec: docs/superpowers/specs/2026-08-26-projthread-v1-design.md

## Task 1: Maps

Files: this plan at docs/superpowers/plans/2026-08-27-projthread-skin.md, docs/STATUS.md, AGENTS.md, docs/superpowers/plans/2026-08-26-projthread-v1.md

If STATUS Now is already execute the Skin plan and Plan is this path, skip this task.

1. Ensure the plan file is at docs/superpowers/plans/2026-08-27-projthread-skin.md.
2. docs/STATUS.md Now: execute the Skin plan. Do not start Deploy. Plan: this dest path. Live unchanged (Config still the live product).
3. AGENTS.md Now: Skin plan (see STATUS). Keep PrimeVue out. Do not claim Skin is live.
4. Index Skin row file 2026-08-27-projthread-skin.md. Ships: tokens (dark+light), tiny Modal, PWA manifest+SW. Now: execute plan 7 only. Leave Deploy as (write after 7).
5. Commit (docs only) message: docs: skin + PWA plan (tokens, tiny modal, installability)

## Task 2: Tokens

Files: create src/styles/tokens.css. Modify src/app/styles.css, src/app/main.ts, src/admin/main.ts, src/app/index.html, src/app/WikiView.vue.

1. Move hex into src/styles/tokens.css. :root = dark set (required names above). @media (prefers-color-scheme: light) light set. html[data-theme=dark] / html[data-theme=light] override the media query. Also set color-scheme.
2. src/app/styles.css keeps html/body/#app reset only, using tokens. No hex.
3. src/app/main.ts imports ../styles/tokens.css (path from src/app). Same import from src/admin/main.ts (../styles/tokens.css).
4. Early script in src/app/index.html (before CSS): read pt-theme; if dark or light, set document.documentElement.dataset.theme. Leave unset for system.
5. Wiki read container max-width: var(--measure).
6. npm test PASS. npm run build:app PASS.

## Task 3: Tiny Modal + Config

Files: create src/app/Modal.vue. Modify src/app/ConfigView.vue.

1. Modal.vue props: open boolean, title string, optional labelledBy id. Slot = body. Emit close. Teleport to body. Backdrop click + Esc close. Panel uses --surface --border --radius --shadow. No new dependency.
2. ConfigView: three v-if modal boxes become Modal :open title @close wrapping the existing forms. Delete .modal scoped chrome that the overlay replaces. Do not change store calls.
3. npm test PASS. npm run build:app PASS.

## Task 4: Theme control + PWA installability

Files: src/app/App.vue, src/app/index.html, src/app/main.ts, create src/app/public/manifest.webmanifest, src/app/public/sw.js, src/app/public/icons/favicon.svg, src/app/public/icons/icon-192.png, src/app/public/icons/icon-512.png.

1. Header control cycles system → dark → light (label the current mode). Writes pt-theme (system = removeItem). Sets/removes data-theme on documentElement.
2. Manifest: name / short_name ProjThread, start_url /, scope /, display standalone, theme_color and background_color #0b0d10, icons 192 + 512 any. Link it from index.html. Also meta name=theme-color, apple-mobile-web-app-capable, SVG favicon.
3. Icons: geometric mark (square, --bg fill, --accent glyph). SVG required. PNG 192 and 512 required for Chromium install — a filled square with the same mark is fine. Generate however is at hand (sips, ImageMagick, or equivalent). Do not add a PNG npm library.
4. sw.js: install/activate skipWaiting + clients.claim. fetch: if URL path starts /api or request is WebSocket, return fetch(event.request). Else: navigations network-first; /assets/ cache-first with network fallback. Cache name pt-shell-v1.
5. main.ts register /sw.js only on https or localhost.
6. npm test PASS. npm run build PASS (app then admin). Confirm dist/manifest.webmanifest and dist/sw.js exist. Confirm no primevue in package.json.

## Task 5: Smoke + STATUS

Files: docs/STATUS.md, AGENTS.md, docs/superpowers/plans/2026-08-26-projthread-v1.md. Optional one-line in the spec client-runtime table: Prime is out; product + admin are tokens.

1. wrangler dev. Farm session: board / room / wiki still work. Config dialogs are overlay modals (Esc closes). Theme cycle changes tokens without reload. prefers-color-scheme works when mode is system.
2. Built assets: Config chunk stays tiny (no Prime). SW does not break /api/me or room WS.
3. Installability: HTTPS origin (local tunnel or workers.dev after Jose deploys). Manifest valid; SW registered. Do not require a screenshot of the browser install prompt.
4. Write STATUS Live / Now as specified above. AGENTS Now: write the Deploy plan. Index: Skin file + landed; Deploy still (write after 7).
5. Commit message: feat: Grok/X-sharp tokens, tiny modal, PWA installability

Do not start Deploy in this session.
