# Implementation Plan — Phase 2: Payment plans

Branch: `feature/phase-2-payment-plans` (off `main`). Design spec:
`DESIGN_SPEC.md` (signed off 2026-09-05).

Two sequential stages, mirroring Phase 1's own precedent: Stage 1 (data +
authorization layer, entirely verifier-routed) must be fully done and green
before Stage 2 (UI) starts.

## Stage 1 — Data and authorization layer

### P2.1 — Schema: `payment_plans` and `payment_periods`

Add the two tables from `ARCHITECTURE.md` §8.4/§8.5, adapted per the design
spec's decisions:

- `payment_plans`: household_id, member_id (references `household_members`),
  minimum_cents (bigint, > 0), frequency (text, constrained to `'monthly'`
  for now but not structurally precluding future values), a due-day
  representation that handles short months (resolve the design spec's open
  question here — document the clamping rule inline), starts_on (date),
  ends_on (date, nullable), active (boolean), created_by, created_at,
  updated_at.
- **At most one active plan per member**: a partial unique index on
  `(member_id) where active`, mirroring the existing partial-unique pattern
  in `household_members_household_id_user_id_key`.
- `payment_periods`: id, payment_plan_id (references `payment_plans`),
  household_id, member_id (denormalized from the plan, for the same
  RLS-simplicity reason `ledger_transactions` denormalizes household_id),
  period_start (date), due_date (date), minimum_cents (bigint, fixed at
  creation — does not change if the plan is later edited), waived_at
  (timestamptz, nullable), waived_by (references `household_members`,
  nullable), waive_reason (text, nullable), created_at.
- Constraint: `waived_at`/`waived_by`/`waive_reason` are all-null or
  all-non-null together (mirror `ledger_transactions`' existing void-state
  CHECK pattern).
- Constraint: at most one period per `(payment_plan_id, period_start)` —
  the lazy-generation function must not be able to create duplicates under
  concurrent calls.
- RLS enabled on both tables with **zero policies** (default-deny),
  matching the established Phase 0/1 pattern — P2.2 adds the real policies.

**Acceptance criteria:**
1. Both tables exist with the columns/constraints above.
2. A second active plan for the same member is rejected by the database
   (not just discouraged by application code).
3. A period's `waived_*` columns are all-null or all-non-null; a mixed
   state is rejected.
4. Duplicate `(payment_plan_id, period_start)` is rejected.
5. RLS is enabled on both tables with no policies (confirm via
   `pg_policies`).
6. `npx supabase db reset` succeeds cleanly; `npm run test:db` still passes
   (no regression against Phase 0/1's suites).

### P2.2 — RLS policies

Add SELECT policies (following P1.2's helper-function pattern, reusing
`internal.is_household_parent`/`internal.is_household_member`/
`internal.current_household_member_id` rather than reimplementing them):

- `payment_plans`: a Parent reads every plan in their household; a Child
  reads only their own (`member_id` matching their own current membership
  id).
- `payment_periods`: same shape, scoped by the period's `member_id`.
- No INSERT/UPDATE/DELETE policy on either table — all writes go through
  P2.3's security-definer functions, matching P1.2's ledger precedent
  exactly (default-deny is the enforcement; RPCs are the sanctioned path).

**Acceptance criteria:**
1. A Parent can SELECT every plan/period belonging to a child in their own
   household.
2. A Child can SELECT only rows where `member_id` is their own.
3. A member of household A gets zero rows querying household B's
   plans/periods (no error, no data disclosure).
4. Direct INSERT/UPDATE/DELETE against either table is rejected for both
   `anon` and `authenticated`, independent of role (RLS default-deny with no
   write policy).
5. `npm run test:db` green including new assertions for the above.

### P2.3 — Security-definer functions

Following P1.3's exact pattern (derive the caller's household/role from
`auth.uid()` via P1.2's `internal.*` helpers, never from a client-supplied
household_id; write + audit_log row together in the same implicit
transaction):

- `create_payment_plan(p_member_id, p_minimum_cents, p_due_day, p_starts_on, p_ends_on)`
  — Parent-only. Deactivates any existing active plan for that member
  first (the "supersedes" behavior from the design spec), then inserts the
  new one, atomically. Validates `p_member_id` belongs to a Child in the
  caller's own household (a Parent creating a plan for a Parent, or for a
  member of another household, is rejected).
- `deactivate_payment_plan(p_plan_id)` — Parent-only, sets `active = false`
  on a plan the caller's household owns.
- `ensure_current_payment_period(p_plan_id)` — the lazy-generation function.
  Computes the household's "today" in its configured time zone, determines
  the current period's `period_start`/`due_date` from the plan's
  `due_day`/`starts_on`, and inserts the period row if it doesn't already
  exist (idempotent — safe to call from both a Parent and Child read path).
  Callable by any active member of the household who can already read the
  plan (this is period *creation*, not a privileged mutation of existing
  data — the period's contents are fully determined by the plan, not
  caller-supplied).
- `waive_payment_period(p_period_id, p_reason)` — Parent-only. Requires a
  non-empty `p_reason`. Sets `waived_at`/`waived_by`/`waive_reason`
  atomically with an `audit_log` row.

**Acceptance criteria:**
1. A Child calling `create_payment_plan`, `deactivate_payment_plan`, or
   `waive_payment_period` is rejected at the database, regardless of
   arguments supplied.
2. Creating a plan for a member outside the caller's own household is
   rejected.
3. Creating a second plan for a member with an existing active plan
   deactivates the old one and activates the new one atomically (no window
   where both or neither are active).
4. `ensure_current_payment_period` is idempotent: calling it twice for the
   same plan on the same day produces exactly one period row.
5. `ensure_current_payment_period` uses the household's configured time
   zone, not the database server's, to determine "today" (verified with a
   household in a time zone offset from the server's).
6. `waive_payment_period` with an empty/null reason is rejected.
7. `waive_payment_period` produces exactly one `audit_log` row per call,
   attributing the correct actor.
8. Every write path here uses integer cents throughout — no floating point
   at any stage.
9. `npm run test:db` green including new assertions for all of the above.

### P2.4 — Period status derivation

A read-side function or view, `payment_period_status(p_period_id)` (or
equivalent), computing one of Upcoming / Due / Partially Paid / Satisfied /
Overdue / Waived from: the period's dates, its `minimum_cents`, its
waived state, and the sum of the child's `payment`-type ledger transactions
(never `expense` or `adjustment`) that fall within the allocation window —
**after the period's `period_start` and on/before its `due_date`** (the
exact rule from `PROJECT_REQUIREMENTS.md` §7.3), documented inline as the
single place this rule is implemented.

Resolve the design spec's open question about status precedence here,
documented inline: `Waived` takes precedence over every other state;
otherwise `Satisfied` (amount paid ≥ minimum) beats `Overdue`/`Due`/
`Partially Paid`; among the remainder, `Overdue` (past due date, not fully
paid) beats `Partially Paid` (some but not all paid, not yet/still due)
beats `Due` (on or after `period_start`, not yet past due, nothing or
partial paid) beats `Upcoming` (before `period_start`).

**Acceptance criteria:**
1. A period with no payments and a future `period_start` is `Upcoming`.
2. A period within its window, no payments yet, not past due, is `Due`.
3. A period with a partial payment, not past due, is `Partially Paid`.
4. A period with payments ≥ minimum is `Satisfied` regardless of due date.
5. A period past its `due_date` with payments < minimum is `Overdue`.
6. A waived period is always `Waived`, regardless of what the payment math
   would otherwise say.
7. A payment made before the period's `period_start` or after its
   `due_date` does not count toward that period (confirms the allocation
   rule is actually applied, not just documented).
8. A voided payment does not count toward any period's paid amount.
9. The function/view respects the existing RLS boundary — calling it for a
   period outside the caller's authorized set returns nothing/errors
   safely, not another household's data.
10. Every case above is covered by an automated test, not just manually
    confirmed.

### P2.5 — Regression suite (pgTAP, mutation-proofed)

One new pgTAP file covering every negative case named across P2.1–P2.4's
acceptance criteria (Child attempts create/deactivate/waive, cross-
household plan/period access, duplicate-active-plan, malformed waive
reason, direct table writes bypassing the RPCs) plus the positive
Parent-success paths and every status-derivation case from P2.4. Per
`CLAUDE.md`'s testing rule, each protected invariant must be mutation-
proofed: drop or disable the thing it protects, confirm the specific
assertions actually go red, then restore.

**Acceptance criteria:**
1. Every P2.1–P2.4 acceptance criterion above has at least one
   corresponding pgTAP assertion.
2. Every negative/privilege-escalation case is present and passing.
3. At least three independent mutation-proofing checks are performed and
   reported (e.g. dropping the one-active-plan-per-member unique index,
   disabling the Parent-only check in `waive_payment_period`, and removing
   the allocation-window filter from the status function), each confirmed
   to flip the expected assertions red, then restored to green.
4. `npm run test:db` reports a clean run from a fresh `npx supabase db
   reset`, combining Phase 0/1's existing suites with this one.

**Stage 1 is not complete, and Stage 2 must not start, until P2.1–P2.5 are
all done and independently verifier-passed** — matching Phase 1's own gate,
applied here to the payment-plan privilege-escalation surface specifically.

## Stage 2 — UI layer

Built against the now-verified Stage 1 RPCs. None of these tasks introduce
new RLS policies or security-definer functions unless noted, so they are
spot-checked normally per this project's default verification tier.

### S3.1 — Parent payment-plan management screen

A screen (reachable from a child's detail/history view, per Phase 1's
existing navigation) where a Parent creates or edits a child's plan
(minimum amount via `parsePositiveMoney`, due day, start date, optional end
date) and deactivates it. Calls `create_payment_plan`/
`deactivate_payment_plan`. Rejected/failed writes show a retry-able error
(ADR-007) — never a silent queue.

**Acceptance criteria:**
1. A Parent can create a plan for a child with no existing plan.
2. Creating a new plan for a child with an existing active plan is shown as
   a supersession (UI makes clear the old plan will be replaced), and after
   confirmation only the new plan is active.
3. A Parent can deactivate a child's active plan (a state supported by the
   UI, not just the database — see `waived_*` non-goal note: "no active
   plan" is a first-class, clearly-labeled state, not an error).
4. A Child cannot reach this screen in a way that renders any control
   implying they could create/edit/deactivate a plan.
5. `npm run typecheck`/`lint`/`test` clean.

### S3.2 — Child progress UI

Extend the Child home screen (built in Phase 1's S2.4) to add, when an
active plan exists: current period's remaining minimum due, due date, and
payment progress (e.g. "$25 of $40 paid"), per §11.2's example hierarchy.
When no active plan exists, show no due/overdue language at all (per the
design spec's explicit non-placeholder requirement) — the existing balance/
recent-activity content is unaffected either way.

**Acceptance criteria:**
1. A child with an active plan and an Upcoming/Due/Partially
   Paid/Satisfied/Overdue period sees the correct corresponding status
   language and amounts.
2. A child with no active plan sees zero due/overdue UI elements — not a
   "$0 due" or blank placeholder.
3. Status is never conveyed by color alone (§17).
4. `npm run typecheck`/`lint`/`test` clean; verified live in-browser per
   this project's preview-tool conventions.

### S3.3 — Parent dashboard plan-status card

Extend the Parent dashboard (built in Phase 1's S2.3) so each child's card
shows current payment-plan status (due/overdue/satisfied/waived, with due
date) alongside the existing balance, per §11.3's example. A child with no
active plan shows a distinct, clearly-labeled "no active plan" state, not a
blank or a false "all caught up."

**Acceptance criteria:**
1. Each active child's card correctly reflects their current period's
   derived status and due date.
2. A child with no active plan is visibly distinguished from a child whose
   plan is fully satisfied.
3. `npm run typecheck`/`lint`/`test` clean; verified live with real
   fixtures covering at least one child in each of Due/Overdue/Satisfied/
   no-plan states.

### S3.4 — Record Payment: period effect on confirmation

Extend Phase 1's existing Record Payment confirmation screen
(`RecordPaymentPage.tsx`) to also show the effect on the current minimum
payment period (§11.5's second required confirmation element, explicitly
deferred by Phase 1's own design spec until this phase). Calls
`ensure_current_payment_period` (read-path only — no new write RPC) to
resolve the period the payment counted toward, if any.

**Acceptance criteria:**
1. Recording a payment against a child with an active plan shows the
   period's updated paid-amount/remaining/status on the confirmation panel.
2. Recording a payment against a child with no active plan shows only the
   existing resulting-balance confirmation, unchanged from Phase 1 — no
   error, no plan-shaped placeholder.
3. A payment made outside the current period's allocation window (e.g.
   post-dated past the due date) is reflected accurately — the
   confirmation does not claim it satisfied a period it didn't actually
   count toward.
4. `npm run typecheck`/`lint`/`test` clean; verified live including both
   the has-plan and no-plan cases.

## Verification-tier summary

- **Verifier-routed** (floor: `data_persistence_migrations`; widened:
  `monetary_amount_or_balance_logic`, `audit_log_integrity`): P2.1, P2.2,
  P2.3, P2.4, P2.5.
- **Spot-checked (default tier)**: S3.1, S3.2, S3.3, S3.4 — unless a task's
  actual diff turns out to touch RLS/a security-definer function/audit_log,
  in which case route that specific task to the verifier instead.
