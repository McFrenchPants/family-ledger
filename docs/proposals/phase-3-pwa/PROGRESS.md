# Progress: Phase 3 — PWA

Branch: `feature/phase-3-pwa` (off `main`).

## Legend

| Status | Meaning |
| --- | --- |
| `todo` | Not started. |
| `in-progress` | Actively being worked. |
| `blocked` | Waiting on a decision, credential, device, or upstream task. |
| `done` | Complete and verified. |

## Tasks

| ID | Task | Status | Notes |
| --- | --- | --- | --- |
| S4.1 | Vite PWA tooling and manifest | done | AC1/2/4 fully verified; AC3 (HTTPS/LAN dev server) blocked on a one-time interactive Windows cert-trust dialog this sandbox can't click through — see session log. |
| S4.2 | Placeholder app icon set | done | All 4 files + safe-zone check verified. |
| S4.3 | Service worker: app-shell precaching, no ledger-API caching | done | AC1/2/3 verified by static analysis + build inspection; live registration blocked by a sandbox limitation, independently reproduced. AC4 fully verified. |
| S4.4 | Mobile install onboarding | todo | Depends on S4.1 (manifest must exist for `beforeinstallprompt` to fire in a real browser), but its platform-detection logic can be built/unit-tested independently. |
| S4.5 | Real-device confirmation | blocked | User-performed, not delegated — requires a physical Android phone and iPhone. Blocked until S4.1–S4.4 are done. |

## Session log

_Newest entries on top._

### 2026-09-05 — S4.3 done: service worker precaching and registration

Default verification tier. Spot-checked the diff, independently re-ran
`npm run typecheck`/`lint`/`test`/`build` (all clean; 222/222; `dist/index.html`
confirmed to have no injected registration script, proving the
import-based `virtual:pwa-register` path took effect rather than the
plugin's auto-inject fallback).

**What landed.** `src/sw.ts` keeps `precacheAndRoute(self.__WB_MANIFEST)` as
its entire caching surface, with an explicit comment that the absence of
any Supabase-matching route is deliberate (ADR-007), not an oversight.
`src/registerServiceWorker.ts` (new) imports `registerSW` from
`virtual:pwa-register` and calls it from `src/main.tsx`; `autoUpdate` means
no custom update-prompt UI was needed. `src/vite-env.d.ts` gained a
`vite-plugin-pwa/client` type reference.

**Live verification of actual SW activation was blocked by a sandbox
limitation, independently reproduced.** Both the implementer and I
(separately: `npm run build`, served `dist/` with `http-server`, then
`navigator.serviceWorker.register('/sw.js')` via this session's own Browser
pane) got the identical `TypeError: ... An unknown error occurred when
fetching the script.` A trivial one-line placeholder service worker failed
registration the same way, confirming this is an environment restriction
on registering *any* service worker in this sandboxed browser, not
something wrong with this task's code. Criteria 1–3 (SW activates,
precached assets served from cache, Supabase requests pass through
unintercepted) are satisfied by static analysis instead: `precacheAndRoute`
only registers routes for the build's own manifest entries (confirmed by
reading `workbox-precaching`'s behavior and the generated `dist/sw.js`),
and `src/sw.ts` has no other route or fetch listener that could intercept
anything else. A real desktop-Chrome devtools session (outside this
sandbox) would be needed to confirm actual runtime activation, but nothing
here suggests the implementation itself is wrong.

Starting S4.4 (mobile install onboarding) next.

### 2026-09-05 — S4.1 + S4.2 done: Vite PWA tooling, manifest, and icon set

Default verification tier (no RLS/security-definer/audit_log changes).
Ran both tasks concurrently (independent files: `vite.config.ts`/`index.html`/
`src/sw.ts` vs. `public/icons/**`) since S4.2's implementer avoided touching
`package.json` (found `sharp` already available transitively via `wrangler`,
rather than adding a new devDependency), which removed the lockfile-race
risk of two concurrent `npm install`s. Spot-checked the combined diff,
independently re-ran `npm run typecheck`/`lint`/`test`/`build` (all clean;
222/222 tests; `dist/manifest.webmanifest` fields verified byte-for-byte
against the plan's spec) and independently confirmed all four icon files'
pixel dimensions via `sharp`.

**What landed.** `vite.config.ts` gained `mkcert()`, `VitePWA({ strategies:
"injectManifest", srcDir: "src", filename: "sw.ts", registerType:
"autoUpdate", manifest: {...} })`, and `server: { host: true }`. `index.html`
gained the `apple-touch-icon` link. `src/sw.ts` is a minimal placeholder
(`precacheAndRoute(self.__WB_MANIFEST)`) for S4.3 to complete. `public/icons/`
gained `icon-192.png`/`icon-512.png`/`icon-512-maskable.png` (plus editable
`source.svg`/`source-maskable.svg`) and `public/apple-touch-icon.png` — a
white "FL" monogram on the existing `accent.DEFAULT` (`#2f5d8a`) background;
the maskable variant's safe-zone compliance was verified with an actual
pixel-distance-from-center check (0 violations), not just eyeballed.

**Known gap, not a bug: AC3 (HTTPS/LAN dev server) unverified in this
sandbox.** `server: { host: true }` and the `mkcert()` plugin are correctly
configured (confirmed by reading the resulting Vite command), but
`vite-plugin-mkcert` requires a one-time interactive Windows "trust this
certificate" dialog on first run to add its local CA to the Trusted Root
store — both the implementer and I (independently, reproducing the exact
same `mkcert.exe -install` failure) confirmed this sandbox cannot click
through a native OS dialog, and there is no non-interactive bypass in the
plugin's API. This is a normal, expected one-time step for whoever runs
`npm run dev` interactively for the first time on their own machine — not a
config defect. Whoever does S4.5's real-device testing should expect to
see (and accept) that one dialog before `npm run dev` first succeeds
locally.

Starting S4.3 (service worker) next.

### 2026-09-05 — Plan created; Stage scaffolded

Branched `feature/phase-3-pwa` from `main` (`main` was at `dcef13d` —
includes Phase 2's merge and this phase's finalized analysis). Analysis
(`analysis/03-phase-3-pwa.md`) went through an explicit user check-in on two
points: real-device install testing via `vite-plugin-mkcert` over LAN HTTPS
rather than the project's first production deploy, and a generated
placeholder icon set rather than commissioned artwork. No separate design
spec — judged small/well-understood enough to go straight to an
implementation plan.

Five tasks planned (S4.1–S4.5), no data/authorization stage (Phase 3 has no
database component). All of S4.1–S4.4 are default verification tier (no
RLS/security-definer/audit_log changes). S4.5 is explicitly not delegable —
flagged `blocked`, pending the user's own physical-device testing once
S4.1–S4.4 land. Starting S4.1 next.
