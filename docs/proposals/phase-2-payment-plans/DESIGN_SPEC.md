# Design Spec — Phase 2: Payment plans

Status: **draft, pending human sign-off**. Backing analysis:
`analysis/02-phase-2-payment-plans.md`. Branch:
`feature/phase-2-payment-plans`.

This is a goals/requirements/constraints document. It intentionally does
not name files, tables' exact columns, function signatures, or component
names — that belongs in the implementation plan, written after this is
signed off.

## Goals

- Give each child at most one active monthly payment plan, distinct from
  their overall ledger balance: a minimum amount, a due date, and how much
  of the current period has been paid.
- Represent each expected payment window as an explicit, persisted payment
  period with a deterministic status: Upcoming, Due, Partially Paid,
  Satisfied, Overdue, or Waived.
- Apply a single, deterministic, code-documented rule for which payments
  count toward the current period (§7.3): a payment made after the period's
  start and on/before its due date counts toward that period.
- Let a Parent create, edit, and deactivate a child's payment plan, and
  waive a period (with a required reason, audited).
- Let a Child see their own plan's status alongside their balance, matching
  §11.2's information hierarchy (total owed, amount still due, due date,
  progress).
- Let a Parent see every child's plan status at a glance on the household
  dashboard, matching §11.3.

## Non-goals (explicitly deferred)

- `payment_allocations` (per-expense payment allocation) — deferred
  indefinitely per the spec's own guidance (§8.6) and the analysis; a
  payment applies to the child's plan as a whole, not to individual
  expenses.
- Any scheduled/cron job that pre-generates future periods. The current
  period is created lazily, on first read or write that needs it, by a
  security-definer function. Pre-generation is deferred to whenever (if
  ever) a real need for it appears — likely alongside Phase 5's reminder
  system, which needs `pg_cron` anyway.
- Weekly/biweekly/custom frequencies — monthly only, though the schema
  should not preclude adding them later (§7.1).
- Reminders/notifications about due or overdue payments (Phase 5).
- Any change to how expenses are recorded, categorized, or named — Phase 1
  already covers per-expense `description`/`category_id`, which is what a
  Parent uses to tell a $3,000 car debt apart from a $45 gas expense on the
  same child's ledger. Phase 2 does not add a second naming mechanism.

## Users and roles in scope

Matches `PROJECT_REQUIREMENTS.md` §4/§7 for the parts Phase 2 touches:
Parents create/modify/deactivate payment plans and can waive a period.
Children read their own plan and period status only, and can never create,
edit, deactivate a plan, or waive a period — through any path, per this
project's standing browser-is-untrusted rule.

## Decisions carried in from the analysis check-in

Resolved with the user on 2026-09-05 and binding for the implementation
plan:

1. **One active plan per child**, decoupled from individual expenses. A
   child may have any number of ledger entries (expenses of any size, each
   individually named/categorized) contributing to their overall balance,
   but exactly one payment plan addresses that balance as a whole. Creating
   a new active plan for a child deactivates the previous one — the two
   never coexist as active.
2. **Lazy period generation.** No scheduled job creates periods in advance.
   A security-definer function creates the current period (if it doesn't
   already exist) whenever something needs to read or affect it — a
   dashboard load, a payment recorded against that child. A period that
   hasn't been asked for yet simply has no row.
3. **Waiving a period requires a reason**, recorded to `audit_log`, mirroring
   the Phase 1 void-workflow precedent for every balance/plan-affecting
   action.

## Requirements

### Data and integrity

- A payment plan belongs to exactly one household and one child
  (`household_members` row), matching Phase 1's household-isolation
  pattern.
- At most one **active** plan per child at any time — enforced at the
  database level (a constraint or the write path), not just by convention.
- A payment period always belongs to exactly one plan and carries its own
  due date, minimum amount, and (if applicable) a waived-at timestamp and
  reason — a period's terms are fixed at creation time and do not silently
  change if the parent plan is later edited (editing a plan affects future
  periods, not ones already generated).
- Status (Upcoming/Due/Partially Paid/Satisfied/Overdue/Waived) is derived
  — computed from the period's dates, its minimum, and the sum of
  applicable payments — never a mutable stored status column, matching the
  project's existing "balances are derived" rule extended to periods.
- The payment-to-period allocation rule (§7.3, "after the period's start
  and on/before its due date") is implemented once, in one place (a
  function/view), documented inline, and covered by automated tests —
  not duplicated ad hoc in the UI layer and the database.
- Money is integer cents throughout, matching every other balance-affecting
  value in this project.
- "Today," due dates, and overdue determinations use the household's
  configured IANA time zone (`households.timezone`, already established in
  Phase 1), never the browser's or server's implicit local time.

### Authorization

- Creating, editing, deactivating a plan, and waiving a period are
  Parent-only, enforced by RLS and/or security-definer functions — never by
  a UI-only check.
- A Child attempting any of the above (via the UI, a direct PostgREST call,
  or a modified request) must fail at the database. Each such case gets a
  mutation-proofed pgTAP negative test, per this project's standing testing
  rule, before this phase is considered done — matching the precedent
  Phase 1's P1.5 suite set.
- A Child may only read their own plan/period data; a Parent may read every
  active child's plan/period data in their own household; cross-household
  access yields zero rows, never an error that discloses existence.
- Waiving a period writes an audit row (who, when, why) that ordinary
  application roles cannot edit or delete, per the standing audit-log
  rule.

### User experience

- Child home screen shows total owed, current period's remaining minimum
  due, due date, and payment progress (e.g. "$25 of $40 paid"), per
  §11.2's example hierarchy — alongside Phase 1's existing balance/recent
  activity, not replacing it.
- Parent dashboard's per-child card shows current payment-plan status
  (due/overdue/satisfied, with a due date or "no active plan") alongside
  the existing balance, per §11.3.
- Record Payment's confirmation screen (Phase 1's existing flow) gains the
  "effect on the current minimum payment period" half of §11.5's
  requirement, which Phase 1 explicitly deferred (its design spec: "no
  due-date/period language until Phase 2 adds that model").
- A child with no active plan sees no due/overdue language at all (not a
  zero or an error) — an intentionally supported state, not a placeholder.
- Do not rely on color alone to distinguish due/overdue/satisfied/waived
  states (§17 accessibility rule).

### Verification

- This phase's schema, RLS, and security-definer-function work falls in
  this project's `full`-mode verification floor
  (`data_persistence_migrations`) and widened categories
  (`monetary_amount_or_balance_logic`, `audit_log_integrity`) — expect the
  data/authorization-layer tasks to be verifier-routed, matching Phase 1's
  Stage 1 treatment.
- UI-layer tasks (dashboards, plan management screens) that call only
  already-verified RPCs are spot-checked normally, per Phase 1's Stage 2
  precedent — unless a specific task also introduces a new RLS policy or
  security-definer function.
- The phase is not complete until the period-status/allocation-rule logic
  has an automated, mutation-proofed regression suite covering every
  status transition and the Child-cannot-waive/create/edit negative cases.

## Constraints

- Everything from `CLAUDE.md`'s standing rules applies unchanged: integer
  cents, append-only/derived data (extended here to periods, not just
  balances), no offline write queue, no new paid services or scheduling
  infrastructure (`pg_cron` stays out of scope this phase per the lazy-
  generation decision above), versioned migrations only, household time
  zone for all date logic.
- No change to Phase 1's ledger schema, RLS policies, or RPCs — Phase 2 is
  additive. If implementation reveals a genuine gap in Phase 1 (as S2.5
  found with `households`), fix it as its own small, verified task, not
  folded silently into a Phase 2 task's diff.

## Open questions for the implementation plan (not blocking sign-off)

- Exact due-day rule representation for `payment_plans.due_day` (a plain
  day-of-month integer vs. a small rule object) — `ARCHITECTURE.md` §8.4
  leaves this as "integer / rule representation"; the implementation plan
  should pick the simplest representation that handles short months (e.g.
  a due day of 31 in a 30-day month) correctly and document the clamping
  rule.
- Whether "Partially Paid" and "Due" are mutually exclusive or a period can
  be both (e.g. some money paid, but still short and past due) — resolve
  by re-reading §7.2's status list and picking a precise precedence order
  (e.g. Waived > Satisfied > Overdue > Partially Paid > Due > Upcoming)
  during the implementation plan, since the six named statuses read as a
  priority list rather than orthogonal flags.

## Sign-off

Approved as written by the user on 2026-09-05. Proceeding to the
implementation plan.
