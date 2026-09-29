# Implementation Plan — Phase 4: Push technical spike

Branch: `feature/phase-4-push-spike` (off `main`). Design spec:
`DESIGN_SPEC.md` (signed off 2026-09-07).

Three stages. Stage 1 (data + authorization + Edge Function, entirely
verifier-routed) must be fully done and green before Stage 2 (client
subscribe UI) starts. Stage 3 (real-device validation) is the phase's hard
exit criterion and is not delegable.

## Stage 1 — Data, authorization, and the sending Edge Function

### N4.1 — `push_subscriptions` table and RLS

- New table: owning `household_member_id` (FK), `endpoint` (unique,
  not null), `p256dh`, `auth` (the two `PushSubscription` keys), and a
  `timestamptz` `created_at`. No household-id column of its own — household
  is derived via `household_member_id`, matching this project's existing
  household-isolation pattern (join through the member row, not a
  duplicated column).
- RLS: a member may INSERT/SELECT/DELETE only rows where
  `household_member_id` resolves to their own active member row (reuse
  `internal.current_household_member_id` if it fits). No UPDATE policy —
  a changed subscription is a new `PushSubscription` object from the
  browser, so re-subscribing is delete-then-insert or an upsert keyed on
  the unique `endpoint`, not a row edit.
- A duplicate `endpoint` from the same device re-subscribing must update
  the existing row's keys/timestamp, not create a second row — implement
  as `INSERT ... ON CONFLICT (endpoint) DO UPDATE`, scoped so the conflict
  update still only succeeds if the caller owns the conflicting row (the
  RLS policy's `USING`/`WITH CHECK` must cover the UPDATE arm of the
  upsert, not just plain INSERT/UPDATE statements).
- Parent existence/count visibility: a read-only view (e.g.
  `household_member_push_status`) exposing only `household_member_id` and
  a boolean/count of active subscriptions, RLS-scoped so a Parent sees rows
  for their own household's members only, and no view or policy ever
  exposes `p256dh`/`auth` to anything but the row's owning member and
  `service_role`. (Picked over an RPC or column-level grant as the simplest
  correct option per the design spec's open question — a view composes
  naturally with existing RLS and needs no new function surface.)
- No audit_log row for subscribe/unsubscribe — explicit call per the design
  spec's leaning (low-stakes, fully reversible, self-service, unlike
  membership changes). Document this decision in this task's own notes
  rather than leaving it to be inferred from the migration's absence of a
  trigger.
- Load the `supabase` and `supabase-postgres-best-practices` skills before
  starting, per `CLAUDE.md`.

**Acceptance criteria:**
1. A member can INSERT a subscription row owned by their own active member
   record via the normal authenticated client.
2. A member cannot INSERT, SELECT, or DELETE a subscription row owned by
   another household member — including another member of their own
   household — via any client.
3. Re-subscribing the same device (same `endpoint`) updates the existing
   row in place; the table never ends up with two rows for one `endpoint`.
4. A Parent can query `household_member_push_status` (or equivalent) for
   their household's members and see accurate existence/count, but cannot
   read any member's raw `p256dh`/`auth` through that view or any other
   client-reachable path.
5. A Parent of household A cannot see household B's members' subscription
   status through the view.
6. No `audit_log` row is produced by a subscribe/unsubscribe write (matches
   the explicit no-audit-log decision above).
7. `npx supabase db reset` succeeds cleanly; `npm run test:db` green,
   including new mutation-proofed pgTAP coverage for all of the above (per
   this project's standing rule — prove each negative test actually goes
   red against a deliberately broken version of the policy/view first).
8. This task falls under `data_persistence_migrations` and
   `push_credential_or_subscription_handling` — verifier-routed, not
   spot-checked.

### N4.2 — VAPID keypair generation and secret wiring

- Generate one VAPID keypair (P-256 ECDSA, RFC 8292) via a one-time,
  throwaway script or CLI invocation — not an app feature, no UI, no
  code path that generates keys at runtime.
- Public key: added as a `VITE_`-prefixed env var (e.g.
  `VITE_VAPID_PUBLIC_KEY`) in `.env.example` with a placeholder value and
  documented as safe to expose (it's the whole point of VAPID's asymmetric
  scheme). The real value goes in the developer's own untracked `.env`.
- Private key: stored only as a local Supabase Edge Function secret (the
  local-stack equivalent — e.g. the functions' own untracked env file used
  by `supabase functions serve`), never in `.env.example`, never in any
  file that reaches git. Confirm `.gitignore` already covers whatever file
  ends up holding it; if not, add the entry as part of this task.
- Document, in this task's own notes, exactly where each half of the
  keypair lives and how a fresh clone regenerates or is handed a keypair —
  this project has no existing "first-time secrets setup" doc, so a short
  paragraph in this task's PROGRESS.md notes is sufficient; no new
  standalone doc file needed for a two-value secret.

**Acceptance criteria:**
1. A real VAPID keypair exists; the public half is readable from the
   client bundle via `import.meta.env.VITE_VAPID_PUBLIC_KEY`.
2. The private half is not present in any tracked file, `.env.example`, or
   git history introduced by this task.
3. `git grep` for the literal private key value (before it's rotated out of
   the implementer's working memory) returns nothing tracked.
4. This task falls under `push_credential_or_subscription_handling` —
   verifier-routed, not spot-checked, specifically to double-check the
   secret never leaked into a tracked file.

### N4.3 — Edge Function: `push-test`

Following `ARCHITECTURE.md` §11's model and `add-household-member`'s
existing Edge Function precedent (`npm:` specifier convention,
`service_role` used deliberately and only server-side):

- Receives the caller's JWT and a target `push_subscriptions` row id (or
  household-member id, whichever is simpler given N4.1's schema) to send a
  test push to.
- Independently verifies the caller is authorized before reading any
  subscription's key material — either the caller owns the target
  subscription themselves, or the caller is an active Parent of the
  household the target subscription's member belongs to. Must not become
  an unauthenticated or under-authenticated way to enumerate or spam
  arbitrary subscriptions — reject before any key material is read, not
  after.
- Builds an encrypted, VAPID-authenticated payload via
  `npm:@block65/webcrypto-web-push@2`'s `buildPushPayload`, `fetch`s it to
  the subscription's `endpoint`, and returns the push service's raw
  response status to the caller (200s a success, 404/410 an
  expired/invalid subscription, anything else surfaced as-is) — this
  function's whole job is to make that status observable, not to interpret
  or act on it.
- Reads the VAPID private key only from the Edge Function's own
  server-side secret (N4.2), never from a client-supplied value.

**Acceptance criteria:**
1. A caller with no relationship to the target subscription (not its
   owner, not a Parent of its household) is rejected before any key
   material is read or any push is sent.
2. The subscription's own owner can trigger a test send to their own
   subscription.
3. A Parent of the subscription owner's household can trigger a test send
   to that subscription.
4. A successful send to a real subscription returns the push service's
   success status to the caller.
5. A send to a deliberately invalidated/expired subscription returns a
   distinguishable 404/410-shaped status, not a silent success or an
   opaque generic error.
6. The VAPID private key is read only from the function's own server-side
   secret; never logged, never echoed back in any response.
7. This task falls in the verification floor
   (`authentication_authorization`) and widen list
   (`push_credential_or_subscription_handling`) — verifier-routed.

## Stage 2 — Client subscribe flow

Only starts once Stage 1 is fully done and verified.

### N4.4 — Subscribe UI and persistence

- Minimal UI (a button/section reachable by any active household member,
  Parent or Child — this is a per-device opt-in, not Parent-gated) that
  calls `Notification.requestPermission()` then
  `registration.pushManager.subscribe({ userVisibleOnly: true,
  applicationServerKey: <VITE_VAPID_PUBLIC_KEY, base64url-decoded> })`, and
  persists the resulting `PushSubscription` (`endpoint`, `keys.p256dh`,
  `keys.auth`) via an upsert into `push_subscriptions` under the signed-in
  member's own row (RLS from N4.1 enforces this server-side regardless).
- On iOS, reuse Phase 3's existing platform-detection groundwork
  (`isIOS()`/`isStandalone()` from `src/features/pwa/install-prompt.ts`) to
  show copy explaining that push permission can't even be requested until
  the app is installed to the Home Screen, per `ARCHITECTURE.md` §12.3 —
  don't re-derive iOS detection from scratch.
- No preferences UI, no per-notification-type toggles — this is "subscribe
  this device" only, matching the design spec's non-goals.

**Acceptance criteria:**
1. On a browser with push support and permission granted, subscribing
   persists exactly one `push_subscriptions` row for the signed-in member.
2. Re-subscribing the same device/browser updates the existing row (per
   N4.1 AC3), not a duplicate.
3. On iOS Safari not running as an installed PWA, the UI explains the
   install requirement instead of presenting a subscribe control that can
   only fail.
4. Denying the permission prompt shows a clear state, not a silent no-op
   or an unhandled promise rejection.
5. Default verification tier (calls only N4.1's already-verified RLS path,
   introduces no new authorization logic) — spot-checked, unless review
   finds it added authorization logic of its own.
6. `npm run typecheck`/`lint`/`test` green; live browser verification of
   the golden path against a local Supabase stack, per this project's own
   verification workflow for UI changes — note in this task's own report
   that full push-subscribe behavior needs a real secure-context browser
   (LAN HTTPS or a real device) and say plainly which parts were verified
   in-sandbox vs. deferred to Stage 3.

### N4.5 — Test-send trigger

- A dev-only debug affordance (not a production notification feature — the
  design spec is explicit this must not be mistaken for or left behind as
  one) that invokes N4.3's `push-test` Edge Function against a chosen
  subscription. Simplest placement: a button next to the subscribe control
  from N4.4, visible to whoever is authorized to trigger a send for that
  subscription (self, or a Parent viewing their household's members),
  rather than a separate page.
- Surfaces the returned push-service status directly (e.g. "200 OK",
  "410 Gone") so Stage 3's manual validation has something concrete to
  read off, matching this project's no-offline-write-queue /
  don't-overstate-success norm.

**Acceptance criteria:**
1. Triggering a test send calls `push-test` and displays its returned
   status verbatim.
2. The affordance is visibly/structurally marked as a debug/test tool (not
   styled or labeled as a real notification feature).
3. Default verification tier (UI-only, calls an already-verified Edge
   Function) — spot-checked.
4. `npm run typecheck`/`lint`/`test` green.

## Stage 3 — Real-device validation (hard exit criterion)

### N4.6 — Real-device validation on Android Chrome and installed iPhone PWA

Not delegable — requires the user's own Android phone and iPhone, per the
design spec and `ARCHITECTURE.md` §12.4. Blocked until N4.1–N4.5 are done.

Reuses Phase 3's existing `vite-plugin-mkcert` LAN HTTPS setup — no
production deploy needed (confirmed in the design spec's carried-in
decision).

**Acceptance criteria (the phase cannot be marked done without all of
these, recorded with device models/OS versions/notes in PROGRESS.md, not
asserted without evidence):**
1. On Android Chrome, subscribing succeeds and a test send (N4.5) produces
   a real OS notification.
2. On an iPhone with the PWA added to the Home Screen, subscribing succeeds
   and a test send produces a real OS notification.
3. Sending to a deliberately invalidated subscription (e.g. one where the
   OS-level notification permission was revoked, or the PWA uninstalled)
   shows the distinguishable 404/410-shaped status from N4.3, observed on
   at least one of the two platforms.
4. Phase 4 is marked done only after all three of the above are recorded.
