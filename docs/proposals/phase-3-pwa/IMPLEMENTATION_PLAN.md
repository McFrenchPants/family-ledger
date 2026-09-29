# Implementation Plan — Phase 3: PWA

Branch: `feature/phase-3-pwa` (off `main`). Analysis: `analysis/03-phase-3-pwa.md`
(finalized 2026-09-05, after user check-in on real-device testing strategy
and the icon approach). No separate design spec — the analysis's own
"Outcome" section judged this phase small/well-understood enough to go
straight to an implementation plan, per this project's "undersize the
ceremony" guidance.

Scope, per `ARCHITECTURE.md` §29's Phase 3 entry: manifest, icons,
standalone installation, service worker, mobile onboarding. Explicitly not
in scope: push subscriptions, VAPID keys, reminders (Phase 4/5).

One flat task list, no data/authorization stage — Phase 3 has no database
component (unlike Phase 1/2, which needed a Stage 1/Stage 2 split), so
tasks continue the project's `S` (UI/screen-level) numbering as `S4.x`
rather than inventing a new prefix. All five tasks are default verification
tier (no RLS, security-definer function, or audit_log changes anywhere in
this phase).

### S4.1 — Vite PWA tooling and manifest

Add `vite-plugin-pwa` (in `injectManifest` mode, per the Phase 0/`ARCHITECTURE.md`
§14 decision — reconfirmed in the analysis, not reopened) and
`vite-plugin-mkcert` (dev-only) as devDependencies. Configure `vite.config.ts`:

- `vite-plugin-pwa` with `strategies: "injectManifest"`, pointing at a new
  service worker source file (see S4.3 — this task can create a placeholder
  file S4.3 fills in, or land both together; either ordering is fine as long
  as `npm run build` succeeds), `registerType: "autoUpdate"` (silent
  background updates, no custom "new version available" prompt UI — keeping
  this phase small, per the analysis's "not reconsidered" section ruling out
  extra complexity beyond the standing caching rule).
- The web app manifest (either via the plugin's `manifest` option or a
  static `public/manifest.webmanifest` — plugin-generated is preferred so
  the precache/manifest stay in sync): `name`/`short_name` ("Family
  Ledger"), `id: "/"`, `start_url: "/"`, `scope: "/"`, `display: "standalone"`,
  `theme_color: "#2f5d8a"` (this project's `accent.DEFAULT` token),
  `background_color: "#ffffff"` (`surface.DEFAULT`), and an `icons` array
  referencing S4.2's generated icon files (192×192, 512×512, and a maskable
  512×512 with `purpose: "maskable"`).
- `vite-plugin-mkcert` wired into the dev server only (never `build`), so
  `npm run dev` serves over HTTPS with a locally-trusted cert reachable from
  a phone on the same Wi-Fi at `https://<lan-ip>:<port>` — the
  user-confirmed approach for real-device testing without a production
  deploy. Confirm the dev server's `host` config actually binds to the LAN
  interface (`server: { host: true }` or equivalent), not just `localhost`.

**Acceptance criteria:**
1. `npm run build` produces a valid `dist/manifest.webmanifest` (or
   equivalent) referencing all three icon variants, and a generated service
   worker file that precaches the built assets.
2. The manifest has `id`, `start_url`, `scope` all `"/"`, `display: "standalone"`,
   and the theme/background colors specified above.
3. `npm run dev` serves over `https://` with a certificate trusted by the
   local machine (no browser security warning), and the server accepts
   connections on the machine's LAN address, not only `localhost`.
4. `npm run typecheck`/`lint`/`test` clean.

### S4.2 — Placeholder app icon set

Generate a small, simple monogram icon (e.g. "FL" or a single glyph) on the
`accent.DEFAULT` (`#2f5d8a`) background — user-confirmed as an acceptable
placeholder, swappable for real artwork later with no plumbing changes.
Produce, checked into `public/icons/` (or wherever S4.1's manifest config
expects them):

- `icon-192.png` (192×192, standard).
- `icon-512.png` (512×512, standard).
- `icon-512-maskable.png` (512×512, `purpose: "maskable"` — the monogram
  must sit within the ~80% "safe zone" maskable icons require, since OS
  launchers crop/mask these to varying shapes).
- `apple-touch-icon.png` (180×180, iOS home-screen icon — no maskable
  variant needed; iOS doesn't use the `maskable` purpose).

A simple, reliable way to produce these without real design tooling: author
one SVG (or a couple, if the maskable safe-zone framing genuinely needs a
different composition) and rasterize it to each required size — several
lightweight, dependency-free approaches exist (a small Node script using an
SVG-to-PNG library at build time, or pre-rendering once and checking in the
PNGs directly since these never change unless the icon itself changes).
Either approach is fine; prefer whichever keeps the fewest new
devDependencies for something this simple.

**Acceptance criteria:**
1. All four icon files exist at the sizes above and are referenced correctly
   from the manifest (192/512/maskable) and `index.html`'s `<link rel="apple-touch-icon">`.
2. The maskable icon's monogram is visibly within a safe zone when previewed
   through a maskable-icon safe-zone check (e.g. Chrome DevTools' manifest
   panel maskable preview, or an equivalent visual check) — not clipped by a
   circular or squircle mask.
3. `npm run build`/`typecheck`/`lint` clean.

### S4.3 — Service worker: app-shell precaching, no ledger-API caching

The hand-written service worker source file `vite-plugin-pwa` injects its
precache manifest into (`injectManifest` mode). Use Workbox's
`precacheAndRoute(self.__WB_MANIFEST)` for the built static assets/app
shell — this is the entire caching surface. Do **not** register any runtime
caching route, fetch handler, or fallback for anything under the Supabase
API/RPC/PostgREST paths: the standing rule (ADR-007, `ARCHITECTURE.md` §14)
is that ledger data is never offline-authoritative and a failed financial
write must show a retry/error state, never a silent queue. The correct
implementation of that rule here is the *absence* of a matching fetch
handler for those requests — an unhandled fetch simply passes through to
the network exactly as if there were no service worker, which is the
desired behavior. Document this "deliberately does nothing for these" point
inline in the service worker file itself, since an empty routing table for
a whole class of requests looks like an oversight to a future reader unless
it says otherwise.

Register the service worker from the client (e.g. `src/main.tsx` or a small
dedicated module) using `vite-plugin-pwa`'s generated virtual module
(`virtual:pwa-register`) with the `autoUpdate` registration type from S4.1.

**Acceptance criteria:**
1. The service worker registers successfully on page load (confirm via the
   browser's Application/Service Workers panel or equivalent devtools
   inspection — a real "activated and running" state, not just "no console
   error").
2. Static app-shell assets are served from the cache on a repeat load with
   the network disabled (devtools offline mode), confirming precaching
   actually works.
3. A request to any Supabase-backed endpoint (REST/RPC) is unaffected by
   the service worker — confirm by checking the network panel shows the
   request going to the network normally (not intercepted/served from
   cache) both online and, explicitly, that going offline produces a normal
   network-error/retry state in the UI (per ADR-007), not a stale cached
   response and not a silent failure.
4. `npm run build`/`typecheck`/`lint`/`test` clean.

### S4.4 — Mobile install onboarding

A small, dismissible UI element (e.g. a banner on the Parent/Child
dashboard) that:

- On Android Chrome (or any browser that fires `beforeinstallprompt`):
  listens for that event, stores it, and shows an "Install Family Ledger"
  button that calls `event.prompt()` when clicked. Hide the banner
  entirely once the app is already running in standalone mode (check
  `window.matchMedia("(display-mode: standalone)").matches` or
  `navigator.standalone` for iOS) — never show install UI to someone who
  already installed it.
- On iOS Safari (which never fires `beforeinstallprompt` and has no
  programmatic install trigger): after a brief detection window with no
  `beforeinstallprompt` event, on an iOS user agent, show plain-text
  instructions ("Tap the Share icon, then 'Add to Home Screen'") instead of
  a button that would silently do nothing.
- Dismissible, with the dismissal remembered (e.g. `localStorage`) so it
  doesn't reappear every visit — this is a low-stakes per-viewer UI
  convenience, not security- or correctness-sensitive data, so `localStorage`
  is an appropriate and sufficient mechanism (no server-side "dismissed"
  state needed).
- Keyboard-accessible, proper labeling, sufficient contrast, respects
  reduced-motion — same standing accessibility rules as every other control
  in this app (`PROJECT_REQUIREMENTS.md` §17).

**Acceptance criteria:**
1. On a UA/environment that fires `beforeinstallprompt`, the banner shows an
   "Install" button that successfully triggers the native install prompt
   when clicked.
2. On an iOS Safari UA, the banner shows the manual "Add to Home Screen"
   instructions, never a non-functional "Install" button.
3. The banner does not render at all when the app is already running in
   standalone/installed mode.
4. Dismissing the banner persists across a reload (same browser/device) and
   does not reappear.
5. `npm run typecheck`/`lint`/`test` clean — include unit tests for the
   platform-detection logic (`beforeinstallprompt` present vs. absent vs.
   already-standalone), which is pure-enough logic to test without a real
   device.

### S4.5 — Real-device confirmation (user-performed, not delegated)

**This task cannot be completed by an implementer subagent or the
orchestrator** — it requires physically holding an Android phone and an
iPhone, which per `.sdlc/project.yaml`'s `live_systems` list
(`physical_ios_and_android_devices`) is exactly the kind of real-hardware
dependency this project's standing rules flag as something only the user
can do. S4.1–S4.4 can be built, and verified as far as automation goes
(devtools inspection, unit tests, UA-spoofed checks), entirely without a
physical device; this task is the final human confirmation that the whole
chain actually works on real hardware, using the LAN-HTTPS approach from
S4.1 rather than a production deploy.

**What the user needs to do**, once S4.1–S4.4 are implemented and merged
to this branch:
1. Run `npm run dev` (with `vite-plugin-mkcert` active) and note the LAN
   URL it prints.
2. On an Android phone on the same Wi-Fi: open that `https://` URL in
   Chrome, confirm the install banner/button appears and works, confirm
   the installed app opens standalone with the correct icon.
3. On an iPhone on the same Wi-Fi: open the same URL in Safari, confirm the
   manual "Add to Home Screen" instructions show, follow them, confirm the
   home-screen icon and standalone launch look correct.
4. Report back what worked and what didn't — anything broken here becomes a
   bug-fix task, not a reason to consider the phase silently "close enough."

**Acceptance criteria:** the user reports successful install + correct icon
+ standalone launch on both a real Android device and a real iPhone. Until
that report lands, Phase 3 is not done, regardless of how clean S4.1–S4.4's
automated verification looked.
