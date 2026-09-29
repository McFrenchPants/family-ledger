# Analysis — Phase 2: Payment plans

Status: **finalized** — open questions confirmed with the user on 2026-09-05
(see `PROGRESS.md` session log once the proposal folder is created).

## What it solves

Phase 1 gives a household a correct total balance and an append-only ledger,
but nothing in the product currently distinguishes "how much a child owes in
total" from "how much they are expected to pay right now." `PROJECT_REQUIREMENTS.md`
§7 and acceptance criterion §20.7 both name this as a required, distinct
capability — a $187.32 balance and a $40/month minimum with $15 remaining due
this period are different facts a Parent needs to see separately. Without
Phase 2 the app is a balance tracker, not the repayment-plan tool the product
requirements describe.

## Is it worth the cost, and is there a simpler path?

Yes. It's explicitly required (§20.7 is a top-level acceptance criterion) and
not something a UI-only reinterpretation of the existing ledger can produce —
"due" and "overdue" are calendar-relative facts that need their own model,
not a filter over `ledger_transactions`.

The one place a simpler path is available, and should be taken: the spec's
optional `payment_allocations` table (§8.6, "do not add this table unless the
simpler payment-period calculation becomes insufficient"). Nothing in this
phase's scope needs per-expense payment allocation, so it's out of scope now,
matching the spec's own recommendation.

## Scope as specified

From `ARCHITECTURE.md` §29 and `PROJECT_REQUIREMENTS.md` §7/§19:

- `payment_plans`: one row per plan (child, minimum amount, monthly
  frequency, due-day rule, start/optional end date, active flag).
- `payment_periods`: one row per expected payment window (period start, due
  date, minimum required, waived-at), persisted rather than computed
  ephemerally, specifically so a waiver is auditable (§8.5's own stated
  reason for the table's existence).
- Status calculation: Upcoming / Due / Partially Paid / Satisfied / Overdue /
  Waived (§7.2).
- Payment allocation rule (§7.3): a payment counts toward the current period
  if made after the period's start and on/before its due date. Must be
  documented in code and covered by tests — not left as an implicit query.
- Parent management UI (create/edit/deactivate a plan, waive a period).
- Child progress UI (current period's due amount, paid-so-far, status).

Deliberately **not** in this phase: `payment_allocations` (per above), any
scheduled/cron-driven period generation (see below), presets/CSV export
(Phase 6), PWA/push (Phases 3–5).

## Scoping decisions — resolved with the user (2026-09-05)

- **One active payment plan per child, decoupled from individual expenses.**
  The user's own example: a child can carry a $3,000 car debt, a $45 gas
  expense, and a $23 misc. expense as three separate ledger entries (each
  individually visible and nameable via the existing `description`/
  `category_id` columns Phase 1 already built), but there is exactly one
  monthly payment plan addressing the child's overall balance — not one
  plan per expense. This matches §7.3's own statement that payments need not
  be allocated to specific expense transactions, and keeps the Parent UI and
  status calculation to one plan per child rather than an aggregation
  problem across several. A new plan for a child deactivates the previous
  one rather than the two coexisting.
- **Lazy period generation, no scheduler.** The current payment period is
  created by a security-definer function the first time anything needs it
  (a dashboard read, a payment RPC), rather than by a pre-generating
  scheduled job. This keeps Phase 2 free of `pg_cron`, which the project
  plan doesn't introduce until Phase 5's reminder system — pulling it
  forward here would violate the standing "no queues/schedulers without an
  observed need" rule for no functional benefit this phase actually
  requires. A period that hasn't been "asked for" yet simply doesn't exist
  as a row; its status is only meaningful once generated.
- **Waiving a period requires a reason**, written to `audit_log`, matching
  the void-workflow precedent Phase 1 already established: every
  balance/plan-affecting action gets an auditable reason, not just a
  timestamp.

## Security/authorization shape

Payment plans and periods are Parent-write, household-scoped-read data,
following the exact pattern already proven in Phase 1 — `households`/
`household_members`-style RLS plus security-definer RPCs for the two
mutating actions (create/deactivate a plan, waive a period), not raw
table writes. This phase's tasks fall under this project's `full`-mode
verification floor (`data_persistence_migrations`) and widened categories
(`monetary_amount_or_balance_logic`, `audit_log_integrity`), so expect most
of its tasks to be verifier-routed, matching Phase 1's Stage 1 treatment.

## Recommendation

Proceed with Phase 2, scoped as above: one active plan per child, lazy
period generation via a security-definer function (no new scheduler),
reasoned waivers audited like voids, and `payment_allocations` deferred
indefinitely per the spec's own guidance. Ready to move to a design spec,
given the phase's size and floor/widen-tier surface area.
