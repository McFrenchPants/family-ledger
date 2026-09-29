# Design Spec — Phase 4: Push technical spike

Status: **signed off 2026-09-07** (approved as-is, including the three open
questions resolved per this spec's own suggested defaults — see
`IMPLEMENTATION_PLAN.md`). Backing analysis:
`analysis/05-phase-4-push-spike.md`, plus two check-ins resolved with the
user on 2026-09-07 (library choice; staying on local Docker instead of
triggering the first production deploy), recorded below. Branch:
`feature/phase-4-push-spike`.

This is a goals/requirements/constraints document. It intentionally does
not name files, exact column lists beyond what's needed to state a
constraint, function signatures, or component names — that belongs in the
implementation plan, written after this is signed off.

## Why this is its own phase, not folded into Phase 5

`ARCHITECTURE.md` §12.4 requires proving Web Push delivery works — VAPID
auth, encrypted payloads, both target phone platforms, expired-subscription
handling — **before** any reminder rules, scheduling, or notification UI
gets built on top of it. This is a spike whose job is to retire that risk
cheaply. It deliberately does not include the scheduled reminder processor,
reminder rules, `notification_events` dedup, or any preferences UI — all
of that is Phase 5 (`BACKLOG.md` item 6), which `ARCHITECTURE.md` §13
itself says not to scaffold until this phase's result is in.

## Decisions carried in from the check-ins

Resolved with the user on 2026-09-07 and binding for the implementation
plan:

1. **Library: `@block65/webcrypto-web-push`** (via `npm:@block65/webcrypto-web-push@2`
   in the Edge Function, matching this project's existing `npm:` specifier
   convention from `add-household-member`). Chosen over three alternatives
   — see `analysis/05-phase-4-push-spike.md` finding 1 for the comparison
   (a Node-only library that can't run in Deno, a JSR library stale since
   2024, and a pre-1.0 fork). Encrypts with `aes128gcm` (RFC 8291),
   authenticates with `vapid` (RFC 8292), and its README states both are
   accepted by every current push service including Apple's.
2. **No production deploy triggered by this phase.** Real-device
   validation (Android + iPhone) runs against the local Docker Supabase
   stack plus the existing `vite-plugin-mkcert` LAN HTTPS setup from Phase
   3 — `PushManager.subscribe()` only needs a secure context, not a public
   origin, so this doesn't force linking the CLI to the real hosted
   Supabase project. That linkage stays a separate, later, explicitly
   approved decision, unchanged by this phase landing a migration.

## Goals

- Generate a VAPID keypair (one-time, out of band — not an app feature)
  and get the public key safely into the client bundle and the private key
  safely into a server-side secret, never the reverse.
- Store push subscriptions (`endpoint`, `p256dh`, `auth`, owning household
  member, timestamp) so a later phase has something to deliver to.
- Let the installed PWA (on a real device, in a real secure context)
  subscribe to push and have that subscription persisted.
- Prove, with real hardware, that a server-side Edge Function can send an
  encrypted, VAPID-authenticated push to that subscription and have it
  arrive as an OS notification, on both Android Chrome and an installed
  iOS Safari PWA.
- Prove that an expired/invalid subscription is observably distinguishable
  (a 404/410-shaped response) from a successful delivery, so Phase 5's
  cleanup step has something real to build against.

## Non-goals (explicitly deferred)

- Any reminder rule, schedule, or the `pg_cron` → `process-reminders`
  pipeline (`ARCHITECTURE.md` §13) — Phase 5.
- `notification_events` idempotency/dedup — Phase 5.
- Any notification-preferences UI — the blocked Phase 6 sub-piece, still
  blocked until Phase 5 exists on top of this phase.
- Automatic dead-subscription cleanup as an ongoing process — this phase
  only needs to prove an expired subscription is *detectable*; a real
  cleanup job is Phase 5's `ARCHITECTURE.md` §13 step 8.
- Linking the CLI to the real hosted Supabase project or any production
  deploy — explicitly deferred per the check-in above.
- A generated-keys management UI (rotating VAPID keys, etc.) — one keypair,
  generated once, stored as secrets; no UI surface for this.

## Users and roles in scope

Any active household member (Parent or Child) may subscribe their own
device to push — this is a per-device, per-person opt-in
(`PROJECT_REQUIREMENTS.md` §9.2: "opt-in at the device/browser level"), not
a Parent-gated action. A Parent may see whether a given member has at
least one active subscription (existence/count), but not another member's
raw subscription key material — that's server-side-only, used by the Edge
Function, never rendered to any browser. This table holds credential-like
material (a subscription's keys are effectively a bearer credential for
sending that device a push), so it is treated with the same server-side
rigor as any other security-sensitive table even though it never touches
money.

## Requirements

### Data and integrity

- Each subscription row belongs to exactly one household member and one
  household, matching this project's household-isolation pattern.
- `endpoint` is unique — a browser's `PushSubscription.subscribe()` call is
  idempotent per-device, and a duplicate subscribe from the same device
  should update, not duplicate, the stored row.
- A member may have more than one subscription (multiple devices), per
  `PROJECT_REQUIREMENTS.md` §9.2.
- VAPID private key lives only as a Supabase Edge Function secret. VAPID
  public key ships to the browser via a `VITE_`-prefixed env var — the
  established pattern for values intentionally safe to expose.
- This phase does not need a `notification_events` table — that's Phase
  5's dedup mechanism, out of scope here.

### Authorization

- A member may create/delete only their own subscriptions, enforced
  server-side (RLS and/or a security-definer function) — not just hidden
  in the UI.
- A Parent may read whether a household member has an active subscription
  (existence/count) but the implementation must not expose another
  member's raw `p256dh`/`auth` values through any client-reachable path —
  those are read only by the server-side sending logic.
- The test-sending Edge Function must independently verify the caller's
  authorization to trigger a test push (e.g. a Parent testing their own
  household, or an individual testing their own subscription) before
  reading any subscription's key material — it must not become an
  unauthenticated or under-authenticated way to enumerate or spam
  arbitrary subscriptions.
- This table and its access path fall under this project's
  `push_credential_or_subscription_handling` verification-widen category
  (`.sdlc/project.yaml`) — expect RLS/schema work here to be
  verifier-routed, matching Phase 1/Phase 6-member-management precedent
  for security-sensitive tasks.
- Every subscription create/delete is not necessarily audit-log-worthy on
  its own (it's a low-stakes, fully reversible, self-service action, unlike
  household-membership changes) — the implementation plan should make an
  explicit, stated call on this rather than defaulting silently either way.

### Delivery (the spike itself)

- A test-sending mechanism (implementation plan decides exact shape —
  Edge Function, invoked manually or from a dev-only UI affordance) that:
  builds an encrypted, VAPID-authenticated payload via
  `@block65/webcrypto-web-push`, sends it to a stored subscription's
  endpoint, and surfaces the push service's response status.
- Must be exercised against a real subscription created by a real
  installed PWA on: (a) Android Chrome, and (b) an iPhone with the PWA
  added to the Home Screen (per `ARCHITECTURE.md` §12.3 — iOS Web Push only
  works for installed PWAs, not Safari tabs). Both must show a real OS
  notification before this phase can be marked done.
- Must demonstrate that sending to a deliberately invalidated/expired
  subscription yields a distinguishable failure response (404/410-shaped),
  not a silent success or an opaque error — this is the "prove expired
  subscriptions are handled" requirement from §12.4, scoped to
  *detection*, not automated cleanup (that's Phase 5).

### User experience

- Minimal: enough UI to trigger `Notification.requestPermission()` and
  `PushManager.subscribe()` from within the installed PWA, and to persist
  the resulting subscription. A full notification-preferences UI is
  explicitly out of scope (Phase 6, blocked); this only needs whatever's
  necessary to prove the pipe works.
- Must respect `ARCHITECTURE.md` §12.3: onboarding copy should make clear
  that iOS requires the app to be installed (Added to Home Screen) before
  push permission can even be requested — reusing Phase 3's existing
  platform-detection groundwork for install onboarding where useful, not
  re-deriving it.

### Verification

- RLS/schema work on `push_subscriptions` and the VAPID-secret-handling
  Edge Function logic are verifier-routed
  (`data_persistence_migrations`, `push_credential_or_subscription_handling`).
- The real-device delivery proof is inherently a manual/physical
  verification step, not something pgTAP or a unit test can cover — record
  it explicitly (device models, OS versions, screenshots/notes of the
  received notification) in the proposal's `PROGRESS.md` rather than
  asserting it passed without evidence, matching this project's standing
  "don't overstate confidence" testing norm.
- A mutation-proofed pgTAP suite covering: a member cannot read/delete
  another member's subscription; a member can create/delete their own; a
  Parent can see existence/count but not another member's key material (if
  that visibility is implemented via a queryable path rather than omitted
  entirely).

## Constraints

- Everything from `CLAUDE.md`'s standing rules applies unchanged: the
  browser is untrusted, every schema change is a versioned migration, the
  VAPID private key never reaches the browser or source control, dates use
  `timestamptz` for moments (subscription `created_at`) since nothing here
  is a calendar-date concept.
- New runtime dependency: `npm:@block65/webcrypto-web-push@2` in the Edge
  Function only — not added to the Vite/browser bundle, which has no need
  for a push-sending library.
- No new paid service, queue, or email provider — matching "keep it
  small." No production deploy — matching the check-in decision above.
- Load the `supabase` and `supabase-postgres-best-practices` skills before
  touching RLS or migrations, per `CLAUDE.md`.

## Open questions for the implementation plan

- Exact shape of the Parent-visible "has an active subscription"
  existence/count check: a dedicated read-only view, an RPC, or a
  column-level grant with the app querying `count(*)` client-side (still
  RLS-scoped so raw keys never leave the server either way). Any of these
  satisfy the requirement above; pick whichever is simplest to implement
  correctly.
- Whether subscription create/delete gets an audit-log row — leaning
  toward "no, this is low-stakes and self-service unlike membership
  changes," but the plan should say so explicitly rather than let it fall
  out by omission.
- Exact UI location/trigger for the test-send mechanism (a dev-only debug
  affordance vs. reusing whatever minimal subscribe UI this phase builds)
  — either is fine as long as it isn't mistaken for or left behind as a
  production notification feature.
