# Implementation plan: Home improvements and payment-period rule fix

Small work item, no design spec. Branch `feature/home-improvements`.
Owner decisions 2026-10-03 (live, in the orchestrator session):

- Payment rule: a payment counts toward a month's minimum if it falls
  anywhere in that period's month ("whole calendar month"), chosen over
  "since the last due date" and "only fix the 1st-of-month gap".
- Home: build all four offered changes (compact child rows on Parent Home,
  remove repeated labels, one place for the status line, hide voided entries
  from Home's recent list).

## Why H1 exists

`payment_period_status` (migration `20260905060000`) counts a payment toward
a period only when `occurred_on > period_start and occurred_on <= due_date`.
Periods start on the plan's anchor day (usually the 1st) and the due date is
earlier in the same month, so:

- a payment made **on** `period_start` counts toward no period at all;
- a payment made after `due_date` but before the next `period_start` also
  counts toward no period.

Found 2026-10-03 on the local Test Family: Sam paid $30.00 on Oct 1, Home
shows "$0.00 of $25.00 paid". Balances were never affected; only period
progress/status (Home, Family, Record payment shortcuts and confirmation).
The exclusive start was meant to stop one payment counting toward two
periods, but adjacent windows ending at `due_date` can never overlap, so it
bought nothing.

## Tasks

### H1 — Payment-period allocation: whole period month

New migration replacing `public.payment_period_status` (same signature,
same return shape, still SECURITY INVOKER, `search_path = ''`). Window
becomes `occurred_on >= period_start and occurred_on < next_period_start`,
where `next_period_start` is the start the plan's following period would
have, anchored to the plan's `starts_on` exactly as
`ensure_current_payment_period` does (no month-end drift: starts_on Jan 31
gives periods Jan 31, Feb 28, Mar 31, and windows tile with no gap or
overlap). Status precedence unchanged; a late payment inside the month can
now turn `overdue` into `satisfied`.

Acceptance:
1. Payment on `period_start` counts (old case 18a inverted).
2. Payment on `due_date` counts; payment after `due_date` but before the next
   period start counts toward this period and clears `overdue` once the
   minimum is met.
3. Payment on the next period's start counts toward the next period only,
   never both.
4. Month-end anchor (starts_on on the 31st) tiles with no gap/overlap across
   February.
5. Voided payments, expenses and adjustments still never count; RLS behaviour
   (zero rows for an unauthorized period) unchanged.
6. pgTAP suite green; the new boundary assertions mutation-proofed (restore
   the old `>`/`<= due_date` window, confirm red, restore).
7. `PROJECT_REQUIREMENTS.md` §7.3 states the exact rule.

Verification tier: verifier (monetary/balance logic, DB function).

### H2 — Home page tidy (front end only)

1. Parent Home: each child is a compact row (avatar, name, amount owed,
   status chip, thin progress bar); the whole row opens that child's Family
   page; Expense/Payment remain reachable in one tap (small icon buttons on
   the row). On a 375 px phone with three children, all three rows and the
   start of Recent activity are visible without scrolling, or as close as
   possible.
2. Due date shown once per child (chip or progress line, not both).
3. Recent activity rows (Parent and Child Home) never repeat "Payment" in
   title and subtitle.
4. "Everyone is up to date" / needs-attention block sits in the same place
   relative to the total on phone and desktop.
5. Voided entries are not shown in Home's recent list (Parent and Child);
   Activity is unchanged. Filter in the query so the list still fills.
6. typecheck, lint, tests, build pass; browser check both roles at 375 px
   and desktop.

Verification tier: default (orchestrator spot-check).
