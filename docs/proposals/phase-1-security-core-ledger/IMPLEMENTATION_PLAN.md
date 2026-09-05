# Implementation Plan: Phase 1 — Security and core ledger

Design spec: `DESIGN_SPEC.md` (signed off 2026-09-04). Backing analysis:
`../../../analysis/01-phase-1-security-core-ledger.md`.

Per the analysis's sequencing recommendation, Phase 1 is split into two
stages on this one branch/proposal folder. **This plan currently covers
Stage 1 only** — the data/authorization layer. Stage 2 (the UI layer) will
be appended to this file as its own task list once Stage 1's Child
privilege-escalation suite is fully green; per the design spec, Stage 2
must not start before that.

Five tasks, matching this run's `max_tasks_per_run` budget. They are
serial by nature (each stage of the DB layer builds directly on the last)
and touch overlapping migration/policy files, so they are not batched —
consistent with `max_concurrent_implementers: 1`.

**All five tasks are floor/widen-tier and go through the `verifier` agent**,
not a spot-check — this phase is exactly the
`authentication_authorization` / `data_persistence_migrations` /
`monetary_amount_or_balance_logic` /
`rls_policy_or_security_definer_function_changes` / `audit_log_integrity`
territory `.sdlc/project.yaml` names.

Carried forward from Phase 0 (`docs/proposals/phase-0-foundations/PROGRESS.md`),
binding for this plan:

- The existing pgTAP harness is superuser-only; RLS/role tests need
  `set local role` blocks layered on top, following the same
  `begin`/`rollback`-per-file pattern already established.
- `households.timezone` is already a validated, case-sensitive IANA zone
  (T3a). Nothing here needs to touch it.
- `household_members` already has a role/status CHECK and a partial unique
  index preventing one `user_id` from holding two conflicting-role rows in
  the same household (T3a) — Phase 1's policies may rely on this being
  unambiguous.
- Inserting rows into `auth.users` directly in test fixtures is a known
  soft coupling to GoTrue's schema; reuse the existing pattern from
  `supabase/tests/` rather than inventing a new fixture approach.

## Stage 1 — Data and authorization layer

### P1.1 — Ledger schema: transactions, categories, audit log, household policy

**Load the `supabase` and `supabase-postgres-best-practices` skills before
starting.**

**Scope:** A new migration under `supabase/migrations/` adding:
- `categories` (per `ARCHITECTURE.md` §8.7): household-scoped lookup table,
  seed-independent (rows come from Phase 4 admin work later, but the table
  and its household scoping exist now since `ledger_transactions.category_id`
  references it).
- `ledger_transactions` (per §8.3), with **three** transaction types —
  `expense`, `payment`, `adjustment` — not the two the architecture doc
  sketches (this was resolved in the design spec's Decisions section: both
  `payment` and `adjustment` decrease a balance and are Parent-only).
  Include the void-flag columns (`voided_at`, `voided_by`, `void_reason`)
  and every column §8.3 lists otherwise. A CHECK (or equivalent) constraint
  ties `type` to the required sign of `amount_cents` (`expense` positive;
  `payment`/`adjustment` negative) at the database level — this constraint
  is a hard requirement, not an application-layer nicety.
- `audit_log` (per §8.11), append-only for ordinary roles (enforce that
  with RLS/grants in this task or explicitly defer the enforcement to
  P1.2 if it's cleaner to land grants alongside the rest of P1.2's
  policy work — implementer's call, but state which in the completion
  report).
- A new `households` column (or small companion table, implementer's
  choice) for the expense-policy toggle discussed in the design spec:
  defaults to the permissive behavior (any member may expense any child).

**Files:** `supabase/migrations/<timestamp>_ledger_core.sql`.

**Do not** write RLS policies or security-definer functions in this task —
schema and constraints only. Do not touch `payment_plans`/`payment_periods`
(Phase 2) or `expense_presets`/`push_subscriptions`/`notification_events`
(later phases).

**Acceptance criteria:**
- `npx supabase db reset` applies cleanly from scratch.
- Inserting an `expense` row with a negative `amount_cents`, or a `payment`/
  `adjustment` row with a positive `amount_cents`, is rejected by a
  database constraint (not merely by convention).
- `ledger_transactions.member_id`/`household_id` and `categories.household_id`
  are real foreign keys; `category_id` on a transaction is nullable (a
  transaction without a category is valid) but if present must belong to
  the same household as the transaction.
- A voided transaction's columns (`voided_at`/`voided_by`/`void_reason`)
  are all-null-or-all-set together (a partial void state is invalid) —
  enforced by a constraint, not left to application discipline.
- The new household expense-policy column exists, defaults to permissive,
  and is not nullable.
- RLS is enabled (default-deny, no policies yet) on all three new tables,
  matching the Phase 0 T3 pattern.

**Depends on:** nothing new (Phase 0's `households`/`household_members`
are already on `main`).

### P1.2 — RLS policies for read access and audit-log protection

**Load both Supabase skills before starting.**

**Scope:** RLS policies on `categories`, `ledger_transactions`, and
`audit_log` implementing:
- Household-boundary isolation: a member may only read rows for a
  household where their membership is `active`.
- A Child may `SELECT` only their own `ledger_transactions` rows (by
  `member_id`); a Parent may `SELECT` every member's rows in their
  household.
- No role may `UPDATE` or `DELETE` `ledger_transactions` directly (voiding
  happens through a function in P1.3, not a raw `UPDATE`) or `audit_log`
  at all (no `UPDATE`/`DELETE`/direct `INSERT` for `anon`/`authenticated` —
  audit rows are written only by the security-definer functions in P1.3,
  as that owner role).
- `categories` readable household-wide; writable by Parents only (even
  though the admin UI for categories is a later phase, the write
  authorization boundary should exist now rather than being backfilled).

**Do not** write the INSERT-side policies for creating expenses/payments/
adjustments here if that logic is better expressed as a security-definer
function per the design spec's §10.4 principle ("if an RLS policy becomes
difficult to reason about, prefer a narrow RPC") — that is exactly what
P1.3 is for. If a straightforward RLS INSERT policy is genuinely simpler
and equally safe for a given case, state that reasoning in the completion
report rather than defaulting to an RPC out of habit.

**Files:** `supabase/migrations/<timestamp>_ledger_rls.sql`.

**Acceptance criteria:**
- As a Child role (via `set local role`/equivalent test harness pattern),
  `SELECT` against another household's data returns zero rows.
- As a Child, `SELECT` against a sibling's `ledger_transactions` in the
  *same* household returns zero rows; against their own returns their rows.
- As a Parent, `SELECT` returns all household members' rows.
- Any direct `UPDATE`/`DELETE` attempt against `ledger_transactions` or
  `audit_log`, by either role, is rejected.
- `categories` is readable by both roles in-household, writable only by
  Parent.

**Depends on:** P1.1.

### P1.3 — Security-definer functions: insert expense/payment/adjustment, void

**Load both Supabase skills before starting.**

**Scope:** Narrow, security-definer RPCs (per §10.4/§11) that are the only
sanctioned write path for ledger mutations:
- An expense-insert function: callable by any active household member;
  internally checks the household's expense-policy setting (P1.1) and
  rejects a Child inserting for a different member when the household is
  configured to the stricter mode; always rejects a non-positive amount;
  always writes an `audit_log` row.
- A payment-record function and an adjustment-record function: both
  Parent-only (verify the caller's own membership role server-side, never
  trust a client-supplied role claim); reject a non-negative amount; both
  write an `audit_log` row.
- A void function: Parent-only; sets the void columns atomically (all three
  together, matching P1.1's constraint); rejects voiding an already-voided
  transaction; writes an `audit_log` row recording the prior state.

Every function must resolve the caller's household membership and role
itself (via `auth.uid()` and a lookup against `household_members`), not
accept either as a parameter it trusts.

**Files:** `supabase/migrations/<timestamp>_ledger_functions.sql`.

**Acceptance criteria:**
- A Child calling the expense-insert function for themselves succeeds
  (permissive-mode default); for another member, succeeds only because
  the default is permissive — re-test this specific case once the
  household is switched to the strict setting and confirm it then fails.
- A Child calling the payment or adjustment function, in any form, fails —
  not merely returns an error the client could ignore, but performs no
  write and asserted via a subsequent row-count check.
- A Child calling the void function fails, including against their own
  transaction.
- A Parent calling any of the four functions succeeds and produces exactly
  one new `ledger_transactions` effect and exactly one new `audit_log` row.
- Attempting to insert a negative-amount expense, or a positive-amount
  payment/adjustment, through the function is rejected (defense in depth
  alongside P1.1's table constraint — confirm both layers actually fire,
  don't assume the constraint alone covers the function path).
- Voiding an already-voided transaction is rejected.

**Depends on:** P1.1, P1.2.

### P1.4 — Balance derivation

**Load the `supabase-postgres-best-practices` skill before starting.**

**Scope:** A view or RPC exposing each member's current balance as
`SUM(amount_cents) WHERE voided_at IS NULL`, per §9 — never a stored/mutable
balance column. Expose it in a form both a Parent (all household members)
and a Child (self only) can read within the RLS boundary established in
P1.2.

**Files:** `supabase/migrations/<timestamp>_ledger_balances.sql`.

**Acceptance criteria:**
- Balance for a member with no transactions is `0`, not `NULL`.
- Balance reflects only non-voided rows — insert an expense, void it,
  confirm the balance returns to what it was before the insert.
- A Parent querying the balance surface sees every member's balance; a
  Child sees only their own (via the same RLS boundary, not a separate
  ad hoc check duplicated in the view).
- No application code or migration anywhere maintains a mutable balance
  column — this is a structural check (grep/schema inspection), not just
  "the new view is correct."

**Depends on:** P1.1, P1.2, P1.3 (needs real transactions to derive from,
including at least one voided one, to test meaningfully).

### P1.5 — pgTAP privilege-escalation and integrity regression suite

**Load both Supabase skills before starting.**

**Scope:** New pgTAP test file(s) under `supabase/tests/`, extending
`npm run test:db`, covering every negative case named in the design spec
and this plan:

- Child attempts to record a payment → rejected, no row written.
- Child attempts to record an adjustment → rejected, no row written.
- Child attempts to insert a negative-amount expense → rejected.
- Child attempts to insert an expense with a wrong-signed/mismatched type
  combination → rejected (table constraint).
- Child attempts to void any transaction (their own or another's) →
  rejected.
- Child attempts to directly `UPDATE`/`DELETE` a `ledger_transactions` row
  (bypassing the functions entirely) → rejected by RLS.
- Child attempts to read another household's `ledger_transactions`,
  `categories`, or balance data → zero rows, not an error that leaks
  existence.
- Child attempts to read a sibling's `ledger_transactions` in the same
  household → zero rows.
- Child attempts to insert an expense for a different member while the
  household is in strict (self-only) mode → rejected; the same call
  succeeds in permissive mode — proving the toggle actually changes
  behavior, not just that it exists as a column.
- Child attempts to write to `audit_log` directly, in any form → rejected.
- Parent performing each legitimate action (expense, payment, adjustment,
  void) succeeds and produces the expected balance and audit effects.
- A structural assertion that RLS is enabled on all three new tables and
  that no permissive policy accidentally grants a Child role write access
  to `ledger_transactions`/`audit_log`.

**Mutation-proof the suite**, per `CLAUDE.md`'s standing testing rule:
temporarily drop or weaken each policy/constraint/function check in turn on
a scratch reset, confirm the relevant tests actually go red, restore, and
report the actual failure counts — do not assert this from reasoning alone.

**Files:** `supabase/tests/*.sql` (new files; do not modify the existing
Phase 0 test files unless a genuine conflict requires it — explain in the
report if so).

**Acceptance criteria:**
- `npm run test:db` passes from a clean `npx supabase db reset`.
- Every negative case above has its own named assertion, not a single
  broad "some error occurred" check.
- The mutation-proofing exercise is reported with concrete before/after
  failure counts for each policy/constraint/function it targeted.
- This suite is the thing that gates Stage 2 — do not report Stage 1
  complete in `PROGRESS.md` until this task is verifier-passed.

**Depends on:** P1.1, P1.2, P1.3, P1.4 (all done).

## After Stage 1 lands

Orchestrator (not a subagent) confirms the full privilege-escalation suite
is green, updates this proposal's `PROGRESS.md`, and only then writes
Stage 2's task list (Parent dashboard, Child dashboard, Add Expense,
Record Payment, History) as a new section appended to this file — mirroring
how Phase 0 grew its plan incrementally rather than trying to fully
pre-specify UI tasks against a data layer that doesn't exist yet.
