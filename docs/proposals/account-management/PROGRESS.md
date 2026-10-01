# Progress: Account management

Branch: `feature/account-management` (off `main`).

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
| AM1 | Spike: link generation, ban, admin email change | done | Design works with small changes; see SPIKE_FINDINGS.md and the spec's refinements section. |
| AM2 | Database: controlled role/status paths, invariants, pgTAP | done | Verifier pass, no blocking findings. 87 new pgTAP assertions, mutation-proofed. |
| AM3 | Edge Function(s): link, email change, archive/restore + ban | done | Verifier pass. One function `manage-household-member` (create_link, change_email, archive, restore, get_login_emails). |
| AM4 | Add-member returns a set-password link | done | Verifier pass. `add-household-member` no longer returns a password. |
| AM5 | Frontend: set-password page, change password, manage-members additions | todo | |
| AM6 | Config + docs | todo | |
| AM7 | End-to-end verification and merge | todo | Production promotion is the owner's call. |

## Session log

_Newest entries on top._

### 2026-10-01 — AM3 + AM4 done: server functions

New `manage-household-member` function (actions: `create_link`, `change_email`,
`archive`, `restore`, `get_login_emails`) and shared helpers in
`supabase/functions/_shared/member-admin.ts`; `add-household-member` now
returns `set_password_url` instead of an initial password (and keeps the
member, with `set_password_url: null` and `set_password_link_failed: true`,
if minting fails). Needs a new function secret `APP_BASE_URL` on the hosted
project (the live app's address, https) - recorded for AM6/the runbook.
Reproducible live test: `scripts/smoke-manage-member.mjs` (94 checks over real
HTTP, all pass; cleans up after itself). Verifier: pass, no blocking findings.

Non-blocking notes carried forward: compensation after a failed archive
restores an originally-invited member as `active`; the same login linked to
two households (only possible by manual data) would let one household's
Parent affect the other (the app never creates this); issued access tokens
survive a ban until expiry but data access is cut by database rules; link
creation rate limit is count-then-insert (slight overshoot possible);
`APP_BASE_URL` should be https in production; `get_login_emails` caps at 100
members; the smoke script's cleanup deletes any `smoke-%` household / `smoke-*@example.test`
user (localhost only). Local `otp_expiry` is still 3600 (AM6 sets 86400 with the
hosted dashboard setting; until then the functions' "24 hours" is only true
if both are changed).

### 2026-10-01 — AM2 done: database rules for role and status changes

New migration `20260908090000_account_management_member_changes.sql`: direct
client UPDATE of role/status/archived_at/ids is now impossible (only `name`
stays writable); `change_household_member_role` and `set_household_member_status`
are the only paths, Parent-only, household-scoped, one audit row each, never
leave a household without an active Parent (trigger, with row locking). Role
rule in the trigger is relaxed only via a row-bound transaction-local setting
set by the function. New suite 010 (87 assertions, each protection
mutation-proved); suite 006 had 4 direct status UPDATEs switched to the new
function (intent preserved, verifier agreed). Verifier: pass, no blocking
findings; independently confirmed every data-access rule requires an ACTIVE
membership, so an archived member's still-valid access token reads nothing.

Known and accepted: the app's Manage Members page still archives/restores by
direct UPDATE, which now fails against a real database; fixed in AM5. The
existing Edge Function is unaffected.

Follow-ups queued for AM7 (non-blocking, from the verifier): (1) add
postgres-level tests for the trigger's household_id/user_id immutability now
that the privilege layer fires first; (2) add an archived-member check on one
more table; (3) suite 003 compares global row counts and fails on a local
database holding leftover development data (4 of 35, pre-existing weakness,
not caused by this work) - make it count only its own fixture rows; (4) the
FOR UPDATE lock on the last-Parent count has no two-session test.

### 2026-10-01 — AM1 done: spike confirms the design

Verdict: works. Folded into the spec: hand out our own `/set-password#token_hash=`
URL (the provider's action_link is consumed by a plain GET); a new link
cancels older ones; a password change signs out other devices; a banned
user's existing access token keeps working against the data API for up to an
hour, so archived-member data denial must come from database rules too;
duplicate-email admin updates return a bare 500 and need a pre-check. All
scratch users deleted; no existing data touched. Starting AM2.

### 2026-10-01 — Design signed off; plan written

Owner approved the design and answered the three open questions (Parents may
mint links for other Parents; 24-hour links; 8+ character passwords).
Starting AM1.
