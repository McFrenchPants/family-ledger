# Analysis: Due date can fall before the period starts (backlog 15)

Written 2026-10-03, owner-confirmed the same day.

**Problem (wider than the backlog note).** `ensure_current_payment_period`
sets `due_date = make_date(year(period_start), month(period_start), due_day)`.
Whenever the plan's start day-of-month is later than `due_day`, every period
of that plan is "due" before it starts. Not only plans starting on the
29th-31st: a plan created on Oct 3 with due day 1 has a first period starting
Oct 3, due Oct 1, and reads `overdue` the moment it is saved (`today >
due_date` and nothing is paid yet). Plans starting on or before their due day
are unaffected.

**Worth doing?** Yes. Creating a plan "starting today" with an early-month due
day is a natural thing to do, and the result is an immediate, wrong "overdue"
on Home for the child and the Parent.

**Approach.** The due date becomes the first `due_day` on or after
`period_start`: the same month if `due_day >= day(period_start)`, otherwise
the following month. It must also stay before the next period start; the one
collision case (start on the 29th-31st, due day 28, next period starting on
Feb 28) clamps to the day before the next period start. A new migration
replaces the function and repairs already-stored periods whose
`due_date < period_start` (`payment_periods` is a derived cache of plan
terms, not an audited record). Needs an owner `db push` to reach production.

**Alternatives rejected.** Restricting start dates to the 1st (changes the
product); computing the due date client-side (two sources of truth).
