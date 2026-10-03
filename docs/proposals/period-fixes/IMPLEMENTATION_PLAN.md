# Implementation plan: Payment-period fixes (backlog 13 and 15)

Small work item, no design spec. Branch `feature/period-fixes`.
Owner decisions 2026-10-03: do backlog 13 and 15; defer 14 (invisible today,
see `analysis/14-payment-counted-twice-on-plan-swap.md`).

## PF1 — Due date never before the period starts (backlog 15)

New migration replacing `public.ensure_current_payment_period` (same
signature, return type, SECURITY DEFINER, `search_path = ''`, authorization,
idempotency, revoke/grant). Only the due-date calculation changes.

Acceptance:
1. due_date = first date with day-of-month `due_day` that is >= period_start
   (same month if due_day >= day(period_start), else next month).
2. due_date is always < the next period start (anchored to starts_on as in
   `payment_period_status`); the collision case clamps to next period
   start - 1 day.
3. Plans with day(starts_on) <= due_day: due dates unchanged.
4. The migration repairs stored `payment_periods` rows with
   due_date < period_start (and no others) to the new rule.
5. A plan created "today" with a due day earlier than today's day is `due`,
   not `overdue`, until its next-month due date passes.
6. pgTAP cases, mutation-proofed (restore the old same-month due date,
   confirm red, restore). Whole suite green.
7. `PROJECT_REQUIREMENTS.md` states the due-date rule next to the §7.3
   allocation rule.

Verification tier: verifier (monetary/plan-status logic, migration).

## PF2 — Record payment confirmation names the payment's month (backlog 13)

Front end only (`src/pages/RecordPaymentPage.tsx` and its test).

Acceptance:
1. If the payment's date is on or after the current period's start, the panel
   behaves exactly as today.
2. If it is earlier, the panel shows the stored period of the child's active
   plan whose month contains the date, with its status from
   `payment_period_status`.
3. If no stored period covers the date, no period panel is shown; the balance
   confirmation is unchanged.
4. The panel heading names the month (e.g. "September payment period").
5. Adjustments unchanged (no panel). Failure of these reads never shows an
   error state.
6. Component tests cover current, earlier-covered and earlier-uncovered
   cases. typecheck, lint, tests, build pass.

Verification tier: default (orchestrator spot-check).
