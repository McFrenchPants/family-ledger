# Analysis: A payment can count toward two plans when a plan is replaced mid-month (backlog 14)

Written 2026-10-03, owner-confirmed the same day: **deferred**.

**Problem.** `create_payment_plan` deactivates the old plan without setting
its `ends_on`, and `payment_period_status` deliberately ignores `ends_on`.
If a plan is replaced partway through a month, a payment after the new
plan's start falls inside both the old plan's last period window and the new
plan's first, so both report it as paid.

**Is it visible?** No. Every caller of `payment_period_status`
(`useChildPaymentProgress`, `useHouseholdPaymentProgress`,
`RecordPaymentPage`) only asks about the *active* plan's periods. The backup
export stores raw `payment_periods` rows, not derived paid totals. No screen
shows an inactive plan's periods.

**Decision.** Defer. Fixing it means changing the allocation rule again a day
after H1 changed it (risk to the one function every status depends on) for no
user-visible gain. Revisit if a screen ever shows past plans' periods, or if
Phase 5 reminders evaluate anything other than the active plan. The likely
fix then: end a plan's last window at the earlier of its next period start
and the start of the member's superseding plan.
