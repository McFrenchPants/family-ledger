# Progress: Phase 4 — Push technical spike

Branch: `feature/phase-4-push-spike` (off `main`).

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
| N4.1 | `push_subscriptions` table and RLS | done | Verifier-routed (`data_persistence_migrations`, `push_credential_or_subscription_handling`). Passed, no blocking findings. Commit `d5953c0`. |
| N4.2 | VAPID keypair generation and secret wiring | done | No tracked-file diff produced (real keys live only in gitignored `.env`/`supabase/functions/.env`) — see session log for why this was spot-checked directly rather than sent to the verifier agent. |
| N4.3 | Edge Function: `push-test` | done | Verifier-routed (auth floor + credential handling). Passed, no blocking findings. Commit `76fc6b9`. |
| N4.4 | Subscribe UI and persistence | done | Default tier, spot-checked. Commit `8c3ee75`. |
| N4.5 | Test-send trigger | done | Default tier, spot-checked. Commit `7ceb666`. |
| N4.6 | Real-device validation (Android + iPhone) | blocked | Not delegable. Android AC1 (subscribe + real notification) confirmed 2026-09-29 on a real Pixel 7 Pro, after fixing a real bug this testing surfaced (see session log). iPhone deferred indefinitely — the only iPhone on hand is activation-locked to an unknown old account, not a project blocker. AC3 (dead-subscription status) attempted but inconclusive on Android; not retried before local testing was paused. Phase's hard exit criterion — still not met. Decision: pause further local-environment testing and resume validation after a production deploy (see session log). |

## Session log

_Newest entries on top._

### 2026-09-29 — Real-device testing session: one real bug found and fixed, Android confirmed working, iPhone and the dead-subscription check deferred to a production deploy

**What this session verified, in plain terms:** on a real Android phone (Pixel 7 Pro,
Chrome), a person can turn on notifications for Family Ledger and receive an actual
notification on their phone when the test-send button is used. That's N4.6's first
acceptance criterion (AC1), genuinely confirmed on real hardware — not simulated, not
mocked.

**What it did not verify:** the iPhone half of N4.6 (AC2), and the "sending to a dead
subscription is reported clearly rather than silently" check (AC3). Both are still open.
See "What's next" below for why and what unblocks them.

**A real bug was found and fixed, not just a test-environment problem.** The very first
Android attempt showed the test-send button report success (`201 OK`) but no
notification ever appeared on the phone. The cause: `src/sw.ts` (the service worker —
the small background script a browser runs to receive push messages even when the app
isn't open) never had code to actually display a notification when a push arrived. It
correctly received the message and then did nothing with it. This is a real defect in
what would ship to production, not a quirk of the test setup, and it's now fixed. It
would have caused every real notification, from any future feature built on this
infrastructure, to silently vanish for every user.

**A second real bug was found and fixed: the subscribe button could get stuck forever
with no error.** Enabling notifications calls a browser API that, on some real phones,
can hang indefinitely instead of failing — it doesn't time out on its own. The button
just showed "Enabling…" forever with no way to know if it had failed. Added a
15-second timeout so a stall now surfaces as a normal, retryable error message instead
of leaving someone staring at a button that never finishes. Landed by a separate,
parallel Claude Code session working the same file during this testing window, reviewed
and kept.

**Most of this session was fighting the local test setup, not the app.** Worth recording
plainly since it explains the pivot decision below:
- The app previously couldn't be tested from a phone at all over the home network,
  because the phone couldn't reach the local test database (a mismatch between "the page
  loads over a secure connection" and "the database it talks to doesn't" that phone
  browsers correctly refuse to allow). Fixed with a small, permanent, dev-only addition
  (`vite.config.ts` + `src/lib/supabase.ts`) that routes local API calls through the same
  address the page itself loads from — this fix is harmless to keep and makes any future
  phone-based local testing easier.
- The "accept the security warning" step for the home-network address turned out not to
  be enough on either phone — Android flatly refused to let notifications work at all
  behind it (a security check stricter than a normal page load), and the iPhone showed a
  blank page. Switched to a temporary, real, trusted web address (a Cloudflare quick
  tunnel) instead of trying to install a custom security certificate on each phone by
  hand, which is genuinely fiddly to do correctly.
- Mid-session, sign-in itself started failing with no clear reason. Root cause: the
  local test database (which runs in Docker) had been sitting idle for a few weeks and
  needed Docker Desktop restarted to recover — not a code problem.
- After all that, two different test phone entries had piled up under the same test
  account from earlier sessions, and the debug "send test push" list doesn't label which
  entry belongs to which device — so a tap sent a test notification to a leftover desktop
  entry instead of the phone. Cleaned up (deleted the stale entry directly in the test
  database); a real rough edge in this throwaway debug tool, not fixed in code since the
  tool is explicitly not meant to ship.
- The dead-subscription check (AC3) was attempted by turning off notification
  permission on the Android phone and testing again — that alone didn't actually
  invalidate anything server-side (the phone's own push service still had the
  subscription live, so the send reported success with no notification shown, not the
  "this doesn't exist anymore" response the check is looking for). A more decisive way
  to test it (clearing all of the site's stored data, not just the notification
  permission) was suggested but not completed before the tunnel address stopped
  working.

**What's next, and why:** rather than keep fighting the local test setup, the decision
was to pause here and resume N4.6's remaining checks after a real production deploy —
a real hosted address has a real, already-trusted security certificate, so most of the
friction above (certificates, local-network reachability, the local database going
stale) simply doesn't exist there. The iPhone gap is separate and unrelated to any of
this: the only iPhone available is locked to an old, unknown account from one of the
kids' first phones, with no way to sign into or factory-reset it right now — a hardware
problem, not a code or infrastructure one. Getting a usable iPhone (a different device,
or recovering that one) is needed before AC2 can be attempted at all.

Housekeeping: the temporary Cloudflare tunnel and local Edge Functions test server used
during this session were both stopped; nothing from this session is left running.

Four files changed, all worth keeping: `src/sw.ts` (the notification-display fix —
important), `src/features/push/PushSubscribeButton.tsx` (the stuck-button timeout fix,
landed by a parallel session and reviewed here), `vite.config.ts` and
`src/lib/supabase.ts` (the dev-only local-network proxy fix). Typecheck, lint, and the
full unit test suite (282/282) all pass. Not yet committed — see this proposal folder's
next step.

### 2026-09-07 — N4.5 done: Test-send trigger. **All delegable work complete —**
**only N4.6 (real-device validation) remains.**

Default verification tier (UI-only, calls an already-verified Edge
Function, no new authorization logic — RLS scopes the self-read, and
`push-test` itself re-derives all authorization server-side) —
spot-checked directly. Independently re-ran `npm run typecheck`/`lint`/`test`
(clean; 282/282, up from 275) and read the full diff.

New: `src/features/push/PushTestSendButton.tsx`, rendered from
`RootLayout.tsx` right under `PushSubscribeButton`. Fetches the caller's
own `push_subscriptions` rows (RLS-scoped self-read) and renders a "Send
test push" button per row, invoking `supabase.functions.invoke("push-test", { body: { subscription_id } })`
and showing the raw returned status verbatim ("201 OK", "410 not ok",
etc.) rather than a generic success message. Deliberately styled as a
debug tool (dashed border, muted background, uppercase "Debug" label,
explicit "not a real notification feature" copy) so it can't be mistaken
for production UI.

**Scope call, explicitly made rather than silently expanded:** only the
self-test affordance (any member testing their own subscription) was
built. A Parent-testing-a-child's-subscription variant on
`ManageMembersPage.tsx` was judged a second, independently-scoped feature
surface (would need a new query joining member rosters to subscription
ids, plus per-member row UI) rather than a minimal addition, and was
deferred — noted here as a real, deliberate gap, not an oversight, in
case a future session wants to pick it up.

**Stage 2 (client subscribe UI) is now fully done.** All of this
proposal's delegable, non-hardware work (N4.1–N4.5) is complete. Only
N4.6 remains: real-device validation on Android Chrome and an installed
iPhone PWA, which requires the user's own hardware and cannot be
delegated. Commit `7ceb666`.

### 2026-09-07 — N4.4 done: Subscribe UI and persistence

Default verification tier (calls only N4.1's already-verified RLS-scoped
upsert; introduces no new authorization logic — the RLS enforces row
ownership regardless of what the client sends) — spot-checked directly,
not verifier-routed. Independently re-ran `npm run typecheck`/`lint`/`test`
(clean; 275/275, up from 263 — 12 new tests) and read the full diff.

New: `src/features/push/push-subscribe.ts` (pure: `isPushSupported()`,
`decideInitialPushState()` — unsupported / iOS-not-standalone / idle —
and a `base64UrlToUint8Array()` helper for the VAPID public key, no new
dependency), `src/features/push/PushSubscribeButton.tsx` (rendered once
from `RootLayout.tsx`, next to `InstallBanner`, so any active member gets
it from whichever dashboard they're on — reuses `isIOS()`/`isStandalone()`
from Phase 3's `install-prompt.ts` rather than re-deriving detection).
`RootLayout.tsx` got a two-line addition (import + render). Subscribe flow:
`Notification.requestPermission()` → `navigator.serviceWorker.ready` →
`pushManager.subscribe(...)` → `supabase.from("push_subscriptions").upsert({...}, { onConflict: "endpoint" })`,
with distinct unsupported/iOS/denied/subscribing/subscribed/error states
(no offline queue — a failed upsert shows a retryable alert, matching
ADR-007).

**One correction to the implementer's own report:** it flagged that a
push_subscriptions DELETE RLS policy "may not yet exist" as something a
future unsubscribe follow-up would need to confirm — checked directly,
N4.1 already added `push_subscriptions_delete_own` (all four
SELECT/INSERT/UPDATE/DELETE policies exist). Noted here so a future
session doesn't waste time re-verifying a settled fact.

**What remains unverified pending real hardware (N4.6):** actual
`PushManager.subscribe()` behavior against a real push service, real
service-worker timing, and real iOS Safari/standalone detection on a
device — all exercised here only via mocked browser APIs in component
tests, per this project's standing "don't overstate confidence" norm.

Commit `8c3ee75`. Starting N4.5 (test-send trigger) next.

### 2026-09-07 — N4.3 done: Edge Function `push-test`. **Stage 1 complete.**

Verifier-routed (`authentication_authorization` floor +
`push_credential_or_subscription_handling` widen). New:
`supabase/functions/push-test/index.ts`. Request shape `POST
{ subscription_id }`. Authorization sequence: (1) try reading the target
row through the caller's own RLS-scoped client — success alone proves
ownership (N4.1's `push_subscriptions_select_own` policy does the work,
no app logic needed); (2) only if empty, resolve the owning household via
two narrow `service_role` reads that select only foreign keys, never
`p256dh`/`auth`; (3) re-derive the caller's own Parent-ness of that
household through their own RLS-scoped client (mirrors
`add-household-member`'s pattern exactly); (4) only once that passes, a
second `service_role` read fetches the real key material — the only line
in the file that does. Builds the payload via
`@block65/webcrypto-web-push@2`'s `buildPushPayload`, `fetch`s it to the
endpoint, returns the raw status.

**Gap found and correctly escalated, not silently patched:** the push
library requires an explicit VAPID public key input (does not derive it
from the private key), which N4.2 hadn't provisioned into
`supabase/functions/.env` (only `VITE_VAPID_PUBLIC_KEY` existed, a
Vite-only var not reachable from Edge Function runtime). The implementer
flagged this rather than editing a file outside its declared scope; the
orchestrator added the one-line `VAPID_PUBLIC_KEY` entry (same public
value) directly to that gitignored local secrets file as a small
out-of-band fix.

Verified by both the implementer (real local run: unrelated-caller and
different-household-Parent → identical 403, owner and same-household
Parent → successful payload build against a fake and a real
404-returning endpoint, both surfaced cleanly) and the `verifier` agent
(independent code trace confirming p256dh/auth is never read before
authorization passes, no key material in any log/response, and the two
rejection paths share the exact same message/status so existence is
never disclosed). Verifier could not execute the function itself
(no Docker in its sandbox) — noted as a limitation, not a blocker, since
its own static trace was unambiguous and corroborated the implementer's
live-run transcript.

**Stage 1 (data, authorization, Edge Function) is now fully done and
verified.** Commit `76fc6b9`. Starting Stage 2: N4.4 (subscribe UI and
persistence) next.

### 2026-09-07 — N4.2 done: VAPID keypair generation and secret wiring

Generated a real VAPID keypair via `npx web-push generate-vapid-keys`
(one-off, not added as a project dependency). Public key written to the
developer's own untracked `.env` (`VITE_VAPID_PUBLIC_KEY`); private key +
`VAPID_SUBJECT` (`mailto:mcfrench@gmail.com`) written to
`supabase/functions/.env`, confirmed as the file `npx supabase functions
serve` auto-loads for local Edge Function secrets (empirically verified
with a throwaway scratch function that echoed only booleans for whether
the two env vars were present, never their values — scratch function and
its serve process fully cleaned up afterward).

**No tracked-file diff at all** — `.env.example` stays untouched
(placeholders only), both real-secret files already matched the repo's
existing `.env`/`.env.*` gitignore pattern (confirmed via `git
check-ignore -v`), so nothing needed a new ignore rule either. This task
therefore falls under this project's `push_credential_or_subscription_handling`
widen category but was **spot-checked directly by the orchestrator
instead of routed to the verifier agent**: the verifier's job is to review
a diff and test output, and there was no diff to review — the
security-relevant property (no secret reachable a tracked path) was
confirmed directly via `git status --porcelain` (clean) and `git
check-ignore -v` on both secret files (both matched), which is the same
check a verifier would have had to perform itself. Judged sufficient
given there was no code logic to independently audit.

No commit for this task — nothing it touched is meant to be tracked.
Starting N4.3 (Edge Function: `push-test`) next.

### 2026-09-07 — N4.1 done: `push_subscriptions` table and RLS

Verifier-routed (`data_persistence_migrations`, `push_credential_or_subscription_handling`).
New: `supabase/migrations/20260907090000_push_subscriptions.sql`
(table + four owner-scoped RLS policies + a new `internal.is_own_household_member`
helper + the `household_member_push_status` read-only view for Parent
existence/count visibility) and `supabase/tests/009_push_subscriptions_privilege_escalation.sql`
(18 pgTAP assertions). No `household_id` column on the table (deliberate —
documented in the migration's own header comment; authorization is always
"this one member's own row," never "any member of household X," unlike
`payment_plans`/`expense_presets`). No `audit_log` row for subscribe/
unsubscribe (deliberate, per the design spec's leaning).

One notable design point: `household_member_push_status` is a plain
(non-`security_invoker`) view — a deliberate, documented exception to this
project's usual view posture, needed because a Parent's existence-check
must read across a child's own RLS-protected rows. The verifier
independently checked this against the actual `internal.is_household_parent`/
`internal.current_household_member_id` definitions (not just the
migration's comment) and confirmed the reasoning holds — no cross-household
leak path, and the view never selects `p256dh`/`auth` regardless.

Verified via: independent re-run of `npx supabase db reset` +
`npm run test:db` (187/187, up from 169) by both the orchestrator and the
`verifier` subagent's static read; full acceptance-criteria + forbidden-path
audit by the verifier (pass, no blocking findings); the verifier could not
execute the mutation-proofing check itself (no DB access in its sandbox),
so the orchestrator independently reproduced it live — temporarily disabled
RLS on `push_subscriptions`, confirmed 8/18 assertions failed exactly as
the implementer's own report claimed, then restored. (One process note,
not a code issue: restoring the migration file via `git checkout --`
after that spot-check clobbered it back to an empty blob, because an
earlier `git add -N` had staged an empty intent-to-add entry for the
not-yet-committed new file — caught immediately by the next test run
failing with "relation does not exist," fixed by rewriting the file from
its known-good content and reconfirming green. Lesson for future
scratch-edits on brand-new untracked files in this loop: verify a
`git checkout --` restore actually produced non-empty content before
trusting it, or avoid `git add -N` on files that might still need a real
revert.)

Commit `d5953c0`. Starting N4.2 (VAPID keypair generation and secret
wiring) next.

### 2026-09-07 — Plan created; Stage 1 starting next

Design spec signed off by the user (approved as-is, including the three
open questions resolved per the spec's own suggested defaults: a read-only
view for the Parent-visible existence/count check, no audit-log row for
subscribe/unsubscribe, and the test-send trigger placed next to the
subscribe control rather than a separate page). Six tasks planned
(N4.1–N4.6) across three stages: data/authorization/Edge Function (Stage 1,
entirely verifier-routed), client subscribe UI (Stage 2, default tier), and
real-device validation (Stage 3, not delegable — blocked pending Stage 1–2
completion and the user's own Android + iPhone hardware). Starting N4.1
next.
