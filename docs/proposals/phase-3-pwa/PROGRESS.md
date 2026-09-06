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
| S4.4 | Mobile install onboarding | done | All 5 criteria verified (synthetic-event + spoofed-UA testing, since no real device is available here). |
| S4.5 | Real-device confirmation | done | User confirmed install + correct icon + standalone launch on both a real Android phone and a real iPhone. |

## Session log

_Newest entries on top._

### 2026-09-06 — S4.5 done: real-device confirmation. **Phase 3 complete.**

The user ran `npm run dev` on their own machine, hit two environment
issues neither this session nor S4.1's implementer could have exercised
without a real device/network, and both were resolved:

1. **Windows Firewall silently blocked the phone from reaching the dev
   server.** The existing Node.js inbound-allow rules were scoped to the
   `Public` firewall profile only, but the Wi-Fi adapter is `Private` — so
   there was no matching allow rule at all. Diagnosed via
   `Get-NetConnectionProfile`/`Get-NetFirewallRule`; fixed by the user
   (firewall changes are a system-security setting, not something this
   session modifies on someone's behalf) with a single scoped
   `New-NetFirewallRule` for TCP 5173 on the `Private` profile.
2. **No seed data includes a real `auth.users` row** (`supabase/seed.sql`
   deliberately keeps every member `'invited'`/`user_id null` — linking to
   real auth is explicitly out of scope for a seed fixture). Created one
   persistent local-only Parent login (`parent@familyledger.local`) via the
   local GoTrue admin API and linked it to the seeded "Parent One" member
   (`status='active'`) so the user has a durable way to sign in for manual
   testing going forward — unlike every other Parent/Child test account
   created during this phase's automated verification, this one is
   intentionally NOT cleanup-deleted.

**A real bug surfaced on first live test, found and fixed.** The user's
first install attempt showed no real app icon, no install banner, and (in
hindsight) no active service worker at all — traced to `vite-plugin-pwa`
requiring `devOptions.enabled` to serve the manifest/service worker under
`npm run dev` at all; without it, `vite dev` silently serves neither, so a
phone testing against the dev server sees only the browser's generic
"bookmark this page" fallback with no error to explain why. **Fixed
directly by the orchestrator** (small, precise config addition — one
`devOptions: { enabled: true, type: "module" }` block in `vite.config.ts`),
confirmed via direct `curl` against the user's own already-running dev
server that it picked up the fix on Vite's automatic config-reload without
needing a manual restart. This is exactly the class of gap S4.1's own
automated verification could not have caught — its only sandbox blocker was
the interactive mkcert cert-trust dialog, and nothing in that session ever
reached an actual phone to notice the dev-mode manifest was never being
served at all.

After removing the stale (wrong-icon) shortcuts and reinstalling with the
fix live, the user confirmed: real "FL" monogram icon on both home screens,
the install banner visible and correctly platform-differentiated, and both
installs launch standalone. **All five tasks (S4.1–S4.5) are done.** Phase
3 (PWA) is complete.

### 2026-09-05 — S4.4 done: mobile install onboarding. Only S4.5 (user-performed) remains.

Default verification tier. Spot-checked the diff against all 5 acceptance
criteria, independently re-ran `npm run typecheck`/`lint`/`test` (clean;
226/226, up from 222 — 4 new tests for the decision function).

**What landed.** `src/features/pwa/install-prompt.ts`: pure types +
`isStandalone()` (checks both `matchMedia("(display-mode: standalone)")`
and iOS's non-standard `navigator.standalone`), `isIOS()` (UA sniff plus
the iPadOS-13+ "Mac-that-supports-touch" quirk, documented as the one
justified use of UA sniffing in this app), and `decideInstallBannerState()`
— a pure function so the branching logic (standalone always wins; iOS
always gets manual instructions regardless of any captured event; the
Chromium install button only when an event is actually captured; otherwise
hidden, never a dead button) has a real unit test independent of DOM
wiring. `InstallBanner.tsx` wires this to a `beforeinstallprompt` listener
and a try/catch-wrapped `localStorage` dismissal flag (fails safe to "not
dismissed" if storage is unavailable). Rendered once from
`RootLayout.tsx`, covering every route including sign-in, rather than
duplicated per dashboard.

**Live-verified via synthetic events / spoofed UA** (no real device
available in this environment, same limitation noted for S4.1/S4.3):
dispatched a synthetic `beforeinstallprompt`-shaped event → Install button
appeared and correctly invoked the handler, clearing the event after use;
spoofed an iPhone UA before mount → manual "Add to Home Screen"
instructions rendered, no button; confirmed dismiss-then-reload
persistence; confirmed a captured install event is still suppressed when
`matchMedia("(display-mode: standalone)")` reports true, proving standalone
wins over everything per `decideInstallBannerState`.

**Only S4.5 (real-device confirmation) remains in Phase 3** — explicitly
not delegable, requires the user's own Android phone and iPhone per the
implementation plan. S4.1–S4.4 are all done; this run used 4 delegable
tasks, matching the plan's full non-S4.5 scope.

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
