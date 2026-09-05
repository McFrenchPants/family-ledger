# Analysis: Phase 3 — PWA

Status: finalized 2026-09-05, after user check-in. Required by `BACKLOG.md`
before Phase 3 moves to a design spec / implementation plan — this
scrutinizes the phase as scoped rather than transcribing
`docs/ARCHITECTURE.md` §14/§29 and `docs/PROJECT_REQUIREMENTS.md` §12.

## Is Phase 3 worth doing as scoped?

Yes. Installability and a real app-shell experience matter for a
phone-first household utility that Parents and Children are meant to use
daily, and none of it is optional groundwork for a later phase the way,
say, a caching layer would be premature now — §12's requirements
(manifest, standalone display, icons, service worker, install onboarding)
are asked for directly, not inferred. Scope stays exactly what
`ARCHITECTURE.md` §29 lists for Phase 3: manifest, icons, standalone
installation, service worker, mobile onboarding. Push subscription
management, VAPID keys, and reminders are explicitly Phase 4/5, not this
phase — confirmed against the finer-grained phase split in `ARCHITECTURE.md`
§29 (the coarser "Phase 3 — PWA and reminders" grouping in
`PROJECT_REQUIREMENTS.md` §19 is the older, less granular numbering;
`BACKLOG.md` already follows the §29 split, which this analysis does not
revisit).

Nothing in the app blocks starting now: enough real routes exist (Parent/
Child dashboards, Add Expense, Record Payment, History, Sign In) for a
service worker's app-shell caching to mean something, and Phase 2 (payment
plans) — the last thing this phase's `BACKLOG.md` entry noted as
"independent of, could run in parallel with" — is already done and merged.

## Findings

### 1. Service worker generation strategy is already decided — not re-litigated here

Phase 0's own analysis (`analysis/00-phase-0-foundations.md`, finding 3)
already settled this: `vite-plugin-pwa` in `injectManifest` mode (a
hand-written service worker source file, precache manifest injected by the
plugin), not the default `generateSW` mode, because Phase 4/5 need a custom
`push` event handler and a notification-click deep-link that `generateSW`
cannot host. Recorded in `ARCHITECTURE.md` §14. This phase is the first one
that actually writes the service worker file, so it must use
`injectManifest` from the start — reconfirmed here, not reopened.

### 2. Real-device installability testing has a real blocker — resolved with the user

Testing "does this actually install on my phone" needs a secure context.
Chrome/Android and Safari/iOS both treat plain `http://` as insecure except
for the literal hostname `localhost` — which a phone on the same Wi-Fi
cannot reach (it has no route to another machine's `localhost`). This repo
has never been deployed to `production` (Cloudflare Pages preview URLs are
deliberately disabled per ADR-009, and `production` is still sitting at the
framework-init commit), so there was no existing HTTPS-reachable place to
test from a real device without either (a) doing the project's first real
deploy just to test this phase, or (b) skipping real-device confirmation
until Phase 4 anyway requires physical Android + iPhone testing for the
push spike.

**Decision (user-confirmed):** neither of those. Add `vite-plugin-mkcert`
(dev-only devDependency, no production footprint) so the Vite dev server
serves over HTTPS with a locally-trusted certificate, reachable from a
phone on the same Wi-Fi at `https://<lan-ip>:<port>`. This gets genuine
physical-device install/manifest verification now, without bundling "ship
Phase 3" and "do the project's first production deploy" into one decision
— the first real deploy stays its own, later, explicitly-approved step.

### 3. No app icon exists yet — resolved with the user

`public/` doesn't exist in this repo; there is no logo or icon artwork.
§12 requires "appropriate application icons" (192×192, 512×512, a maskable
variant, and an Apple touch icon at minimum).

**Decision (user-confirmed):** a generated placeholder — a simple monogram/
letter mark on the existing `accent` token color (`#2f5d8a`, from
`tailwind.config.js`), produced programmatically (e.g. rendered from an SVG
at build time or checked in as a small set of pre-rendered PNGs), not real
graphic design work. Swapping in real artwork later is a asset-only change,
not a re-architecture — the manifest/service-worker plumbing doesn't care
where the PNGs came from.

### 4. Manifest color tokens — reuse existing design tokens, not a new decision

`theme_color` and `background_color` are cosmetic manifest fields with an
obvious default: reuse `tailwind.config.js`'s existing `accent.DEFAULT`
(`#2f5d8a`) and `surface.DEFAULT` (`#ffffff`) rather than inventing new
brand colors for an app that deliberately has "one neutral ramp, one
accent, one positive, one negative" (see that file's own comment). Not
significant enough to need a separate user check-in; flagged here so the
implementation plan doesn't have to re-derive it.

### 5. Manifest `id`/`scope`/`start_url` — a single-origin app, no real ambiguity

This is one app at one origin with no sub-app routing concerns, so
`scope: "/"`, `start_url: "/"`, and a stable `id` (e.g. `"/"` itself, which
the manifest `id` spec explicitly allows as a valid relative value) is the
whole decision — no alternative worth presenting to the user. Getting `id`
stable from the first release matters because changing it later would
cause installed instances to be treated as a different app rather than
updating in place; recorded here so the implementation plan sets it once,
correctly, rather than as an afterthought.

### 6. Caching strategy: precache the shell, never the ledger API — already the standing rule, not reopened

`ARCHITECTURE.md` §14's "Caching" subsection and this project's standing
"no offline write queue" rule (ADR-007) already fully specify this:
versioned static assets and the app shell get precached; `ledger_transactions`/
`payment_plans`/`payment_periods`/balance RPC responses are never cached as
offline-authoritative data, and a network failure on a financial write
shows a retry/error state, never a silent queue. Nothing here changes that
— this phase's service worker file is where that rule gets implemented,
not where it gets decided.

### 7. Mobile install onboarding — the two platforms genuinely differ, and that's fine

Android Chrome fires a `beforeinstallprompt` event the app can listen for
and use to show a custom "Install" affordance; iOS Safari has no such
event and no programmatic install trigger at all — the only path is the
user manually tapping Share → "Add to Home Screen", so the app's onboarding
UI has to *detect* the platform (or simply detect the *absence* of
`beforeinstallprompt` support after a reasonable wait) and show
platform-appropriate instructions rather than a single generic "Install"
button that would silently do nothing on iOS. This is exactly what §12
asks for ("detect when notification/PWA installation steps require user
action and provide clear onboarding instructions") — not a new requirement,
but worth stating explicitly here since it's the one place this phase's UI
work has real platform-conditional logic, which the implementation plan
should call out as its own task rather than assume falls out of the
manifest/service-worker work for free.

## Not reconsidered

Whether to build a PWA at all instead of a native app is ADR-001, already
decided and out of scope for this analysis. Whether the household's data
volume warrants any service-worker runtime caching *beyond* the static
shell (e.g. opportunistically caching a GET for faster repeat loads) was
considered and rejected as unnecessary complexity for a tiny per-household
data volume that already loads fast — nothing here changes the "network
only for anything ledger-shaped" posture from finding 6.

## Outcome

Phase 3 is ready to move to an implementation plan. Given it's a single
cohesive unit of Vite tooling + a handful of small, well-understood UI/asset
tasks with no significant architectural ambiguity left after the two
check-in decisions above, this does not need a separate design-spec
document — the implementation plan can be scaffolded directly, matching
this project's "undersize the ceremony for well-scoped work" guidance.
