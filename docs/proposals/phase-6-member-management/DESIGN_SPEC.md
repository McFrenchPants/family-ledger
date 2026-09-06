# Design Spec — Phase 6: Member management

Status: **draft, pending human sign-off**. Backing analysis:
`analysis/07-phase-6-admin-and-polish.md` (item-level) plus the
check-in resolved with the user on 2026-09-06, recorded below. Branch:
`feature/phase-6-member-management`.

This is a goals/requirements/constraints document. It intentionally does
not name files, exact column lists beyond what's needed to state a
constraint, function signatures, or component names — that belongs in the
implementation plan, written after this is signed off.

## Why this is bigger than it looks

There is currently no way for a Parent-created member to end up with real
login credentials at all. `household_members` rows exist today only via
seed/migration; RLS has zero write policies on that table
(`20260904220228_create_households_and_members.sql`'s "deliberate Phase 0
default-deny," still true as of the S2.1 read-access migration); and
`ARCHITECTURE.md` §6.2/ADR-010 already ruled out public self-signup and
self-service email flows. This slice is therefore the first real
account-provisioning mechanism in the app, not a CRUD screen over an
existing write path.

## Decisions carried in from the check-in

Resolved with the user on 2026-09-06 and binding for the implementation
plan:

1. **Provisioning mechanism: a Parent-invoked Supabase Edge Function using
   the Auth admin API**, mirroring the existing password-reset pattern
   (ADR-010's "Parent-assisted, not self-service") and matching
   `ARCHITECTURE.md` §11's own example ("Parent invitation/account
   administration when required" is listed as trusted-server-operation
   material). The function runs server-side with `service_role`, creates
   the `auth.users` row, and links it to a `household_members` row in one
   step. This is the project's first Edge Function — `supabase/functions/`
   does not yet exist.
2. **No transactional email.** Per the Free-Tier cost guardrail
   (`ARCHITECTURE.md`) and ADR-010's existing precedent, this does not add
   an email provider or send an invite/confirmation email. The Edge
   Function creates the account with a Parent-supplied or
   Parent-visible-once initial password (email-confirmed, since there is
   no email flow to confirm through); the Parent is responsible for
   relaying it to the new member out of band (same trust model as any
   other household credential today).
3. **New members are created directly `active`**, not `invited`. The
   existing `invited` status (seed-only today) stays in the schema for
   the not-yet-built self-claim path some future phase might add, but this
   slice's Parent-driven flow doesn't need an intermediate unlinked state:
   the Edge Function creates the `auth.users` row and the
   `household_members` row together, already linked.

## Goals

- Let a Parent add a new household member (Parent or Child role), which
  provisions that person a real, working login in the same step.
- Let a Parent edit an existing active member's display name.
- Let a Parent archive an active member (soft delete — preserves every
  historical ledger/audit row tied to that member's `household_members.id`,
  matching this project's append-oriented, never-truly-delete ethos) and
  restore a previously archived member.
- Enforce, server-side, that a household is never left with zero active
  Parents — every household must always have at least one active Parent
  member who can perform the operations this slice adds.
- Every create/archive/restore action is Parent-only, enforced by RLS
  and/or a security-definer function, and writes an audit row.

## Non-goals (explicitly deferred)

- Changing a member's role after creation (Parent↔Child). Out of scope:
  role changes interact with the "at least one active Parent" invariant
  in ways (e.g. a household's only Parent demoting themselves) that
  deserve their own explicit design rather than riding in on this slice.
- The `invited`/unlinked-member self-claim flow (a member accepting an
  invite and linking their own `user_id` later). The schema already has
  the `invited` status and nullable `user_id` for this; this slice simply
  doesn't need or build the claim step, since provisioning now happens in
  one Parent-driven action.
- Self-service or email-based password reset (already ruled out by
  ADR-010; unchanged by this slice).
- Notification preferences, transaction filtering, categories/presets, and
  the accessibility review — the other Phase 6 sub-pieces, unaffected by
  this one.
- Deleting a member's historical data. Archiving never removes rows from
  `ledger_transactions`, `payment_plans`, `payment_periods`, or
  `audit_log` — matching the project's standing append-oriented rule.

## Users and roles in scope

An active Parent may add, rename, archive, and restore members within
their own household only. A Child has no access to any of this — not
read, not write — through any path (UI, direct PostgREST call, or a
modified request), per this project's standing Child-cannot-elevate rule.
This is not a balance-decreasing operation in the ledger sense, but it is
security-sensitive (it can create new credentialed accounts and can lock a
household out of its own management if the last-Parent invariant is
violated), so it is treated with the same server-side-only rigor as any
Parent-only ledger action.

## Requirements

### Data and integrity

- A new member row belongs to exactly one household, matching every other
  table's household-isolation pattern.
- A household must always have at least one **active** member with role
  `parent`. Enforced at the database level (constraint, trigger, or the
  write path of the archive operation itself — implementer's call, but it
  must be enforced there, not only in the UI) — attempting to archive the
  last active Parent of a household must fail, atomically, with no
  partial effect.
- Archiving sets `status = 'archived'` and `archived_at`; it must not
  delete or nullify the row, its `user_id` link, or any historical data
  referencing it.
- Restoring an archived member sets `status = 'active'` and clears
  `archived_at`; the restored row keeps its original `id` and `user_id` —
  a member is never re-provisioned or re-linked by a restore.
- An archived member's `auth.users` row is not deleted by this feature —
  archiving is a `household_members`-level state change, not an
  Auth-level account deletion. (If disabling sign-in for an archived
  member turns out to matter, that's a separate future decision, not an
  implicit requirement here — flag it as an open question rather than
  silently building it in.)
- Money/ledger tables are untouched by this slice; nothing here changes
  how balances are computed.

### Authorization

- Creating a member (and therefore its linked `auth.users` account),
  editing a member's name, archiving, and restoring are all Parent-only,
  enforced server-side. A Child attempting any of these — via the UI, a
  direct PostgREST/Edge Function call, or a modified request — must fail,
  with a mutation-proofed negative test for each, per this project's
  standing testing rule.
- The Edge Function itself must independently verify the caller is an
  active Parent of the target household before touching the Auth admin
  API or `household_members` — it cannot rely on the browser having
  hidden a "not a Parent" UI state, and it cannot rely on RLS alone, since
  it needs `service_role` to call the Auth admin API in the first place
  (RLS does not apply to `service_role`).
- A Parent may only manage members of their own household; cross-household
  attempts yield a clean authorization failure, never partial success or
  an error that discloses another household's data.
- Every create/archive/restore action writes an audit row (who performed
  it, what changed, when) that ordinary application roles cannot edit or
  delete, per the standing audit-log rule. A plain name edit is a judgment
  call for the implementation plan on whether it rises to audit-worthy —
  create/archive/restore clearly do; a cosmetic rename likely does too,
  for the same "who changed household membership" traceability reason,
  but this can be confirmed at plan time rather than re-litigated here.

### User experience

- A Parent-only "Manage members" affordance (page or section — the
  implementation plan decides, following this project's existing
  `RequireRole` conventions) listing the household's members with their
  role and status (active/archived), consistent with how the export page
  is already gated.
- Adding a member asks for at minimum: display name, role (Parent/Child),
  and however credentials get set (email + initial password, or a
  generated password shown once) — the exact form is an implementation
  decision, but the initial password must be surfaced to the Parent
  clearly enough to relay it, since there is no email flow to do that for
  them.
- Archiving requires a confirmation step (it changes another person's
  ability to sign in), but is explicitly reversible via restore — this is
  softer than the ledger's void workflow, not a permanent action, so the
  confirmation copy should say so rather than implying data loss.
- Do not rely on color alone to distinguish active/archived status (§17
  accessibility rule).

### Verification

- The Edge Function, its RLS/security-definer support, and the
  last-active-Parent invariant fall in this project's `full`-mode
  verification floor (`authentication_authorization`,
  `data_persistence_migrations`) — expect this work to be verifier-routed,
  matching Phase 1/Phase 2's precedent for security-sensitive tasks.
- UI-layer tasks that only call an already-verified Edge Function/RPC are
  spot-checked normally, unless a specific task also changes RLS or the
  Edge Function itself.
- Before this slice is considered done: a mutation-proofed pgTAP suite (or
  equivalent for the Edge Function's own logic, since pgTAP alone can't
  exercise Deno code) covering the Child-cannot-manage-members negative
  cases and the cannot-archive-last-Parent invariant, plus a live
  signed-in-Child negative test if a local Supabase stack is up during
  implementation (matching the standing testing rule's requirement for
  role-scoped RLS checks, not just the code-level review S6.1/S6.2 used).

## Constraints

- Everything from `CLAUDE.md`'s standing rules applies unchanged: the
  browser is untrusted, every schema change is a versioned migration, no
  `service_role` key ever reaches the browser or source control (the Edge
  Function is the only place it's used, and only in Supabase's own
  server environment), dates use the household's IANA timezone where
  relevant (`archived_at`/`created_at` are moments — `timestamptz` — not
  calendar dates, so this mostly doesn't bite here).
- This is the project's first Edge Function. Its deployment/config
  (`supabase/functions/<name>/`, `deploy_edge_function` or CLI-based
  deploy, required secrets) should follow whatever this project's own
  Supabase skill/best-practices guidance recommends for Edge Function
  structure — load the `supabase` skill before implementing it.
- No new paid service, queue, or email provider — matching "keep it
  small."

## Open questions for the implementation plan

- Whether the initial password is Parent-chosen (typed into the form) or
  system-generated and displayed once. Either is consistent with this
  spec; pick whichever the Supabase Admin API makes simpler and safer to
  implement correctly.
- Whether archiving should also disable the member's `auth.users` sign-in
  (ban/disable) or leave it alone, relying solely on `household_members`
  RLS to cut off data access. Leaning toward "leave Auth alone, RLS is the
  enforcement layer" (consistent with how every other authorization
  boundary in this project works), but worth a deliberate call at plan
  time rather than defaulting silently.
