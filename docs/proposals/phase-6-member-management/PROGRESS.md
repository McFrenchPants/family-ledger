# Progress: Phase 6 — Member management

Branch: `feature/phase-6-member-management` (off `main`).

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
| M6.1 | RLS write policies + last-active-Parent invariant | done | Verifier-routed (auth floor). Passed, no blocking findings. Commit `9f4420a`. |
| M6.2 | `add_household_member` groundwork (non-Auth half) | done | Verifier-routed (auth floor). Passed, no blocking findings. Commit `d8b95ea`. |
| M6.3 | Edge Function: `add-household-member` | todo | Verifier-routed (auth floor). Depends on M6.2. Project's first Edge Function. |
| M6.4 | "Manage members" page | todo | Default tier unless it adds new authz logic. Depends on Stage 1 fully done. |

## Session log

_Newest entries on top._

### 2026-09-06 — M6.2 done: `add_household_member` SQL function

Verifier-routed (auth floor). Verdict: **pass**, all 5 acceptance criteria
met, no forbidden-path or architectural-invariant violations. New
migration `20260905080000_add_household_member_function.sql` adds
`public.add_household_member(p_household_id, p_user_id, p_name, p_role)`
— re-derives the caller's Parent-ness from `auth.uid()` (never trusts
client-supplied household_id/role, matching the `record_expense` pattern),
inserts the new `household_members` row (`status = 'active'` per the
design spec's decision) plus a paired `audit_log` 'created' row, atomic in
one function transaction. Does not create the `auth.users` row — that
stays M6.3's job. `household_members` still has no INSERT policy; this
function is the sole INSERT path, `execute` granted only to
`authenticated` (explicitly revoked from `anon` too, not just `public`,
per this project's own documented default-grant gotcha).

Both the implementer and the verifier independently mutation-proofed the
Parent-only check (disabled it, confirmed red via a wrong errcode from the
FK constraint, restored). The verifier also directly confirmed a
nonexistent `p_user_id` fails cleanly via the FK constraint (no partial
writes) — relevant since this function runs before M6.3's Edge Function
exists to actually create that `auth.users` row.

One non-blocking observation carried forward to M6.3: nothing in the
schema restricts one `auth.users` id to a single household's
`household_members` — not a defect here, but worth keeping in mind once
M6.3's Edge Function and its UI exist, in case multi-household membership
produces confusing behavior that wasn't an explicit product decision.

`npm run test:db`: 159/159 green (up from 145 pre-task). Commit `d8b95ea`
on `feature/phase-6-member-management`. Not pushed, not merged. Next:
M6.3 (the Edge Function itself — project's first).

### 2026-09-06 — M6.1 done: RLS UPDATE policy + last-active-Parent invariant

Verifier-routed (falls in the `authentication_authorization` floor trigger).
Verdict: **pass**, all 8 acceptance criteria met, no forbidden-path or
architectural-invariant violations. New migration
`20260905070000_household_members_update_policy.sql` adds:
`household_members_update_parent` (Parent-only UPDATE, own household),
a `BEFORE UPDATE` trigger rejecting role/household_id/user_id changes and
archiving a household's only active Parent, and one `audit_log` row per
successful archive/restore/rename. Also added a 4th SELECT policy
(`household_members_select_parent_any_status`) — not originally scoped,
but the verifier independently confirmed this is a required consequence
of Postgres folding SELECT policies into an UPDATE's `WITH CHECK`, not
scope creep (disabling it made the archive path itself fail RLS).

Both the implementer and the verifier independently mutation-proofed the
new trigger invariants (disabled each check, confirmed the suite went
red, restored) — the verifier reproduced this itself rather than trusting
the implementer's account. One non-blocking note: immutability violations
and the last-Parent invariant share the same `42501` errcode, so a future
caller wanting to distinguish them needs to parse the exception message,
not the SQLSTATE — acceptable per the task's own acceptance criteria,
which don't require distinct codes.

`npm run test:db`: 145/145 green (up from 126 pre-task). Two pre-existing
test files updated for staleness this migration's own scope caused
(`001_household_members_constraints.sql`'s user_id-repoint case now
expects `42501` instead of `23505`; `004`'s SELECT-policy count bumped
3→4), both with inline notes explaining why.

Commit `9f4420a` on `feature/phase-6-member-management`. Not pushed, not
merged. Next: M6.2 (`add_household_member` SQL groundwork).

### 2026-09-06 — Scaffolded

Picked "Phase 6: Member management" from the remaining Phase 6 sub-pieces
(the export/backup slice already shipped and merged — see
`docs/proposals/phase-6-admin-polish/`). Research surfaced that this is
bigger than a CRUD screen: `household_members` has zero write policies
today, and there's no existing mechanism for a Parent-created member to
get real login credentials (no self-signup per `ARCHITECTURE.md` §6.2,
no email provider per the cost guardrail). Checked in with the user on the
provisioning mechanism; chose a Parent-invoked Edge Function using the
Auth admin API (service_role), mirroring the existing password-reset
precedent (ADR-010) rather than a manual-dashboard workaround or
deferring credential-linking entirely.

`DESIGN_SPEC.md` written and approved as-is by the user on 2026-09-06 —
including locking in the open question about archiving: Auth accounts are
left alone on archive, RLS is the sole enforcement layer, consistent with
every other authorization boundary in this app.

`IMPLEMENTATION_PLAN.md` written: two stages, four tasks (M6.1–M6.4).
Stage 1 (RLS/invariant, SQL groundwork, Edge Function) is entirely
verifier-routed per the `authentication_authorization` floor trigger.
Stage 2 (the UI) is default-tier unless review finds new authz logic in
it. Not yet delegated to any subagent.
