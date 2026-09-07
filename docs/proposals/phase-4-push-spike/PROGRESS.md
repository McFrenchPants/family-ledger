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
| N4.3 | Edge Function: `push-test` | todo | Verifier-routed (auth floor + credential handling). Depends on N4.1, N4.2. |
| N4.4 | Subscribe UI and persistence | todo | Default tier. Depends on N4.1–N4.3 (Stage 1 complete). |
| N4.5 | Test-send trigger | todo | Default tier. Depends on N4.3, N4.4. |
| N4.6 | Real-device validation (Android + iPhone) | blocked | Not delegable — requires user's own hardware. Depends on N4.1–N4.5. Phase's hard exit criterion. |

## Session log

_Newest entries on top._

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
