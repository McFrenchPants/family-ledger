# Analysis: Record payment confirmation ignores a backdated payment's month (backlog 13)

Written 2026-10-03, owner-confirmed the same day.

**Problem.** After a Parent records a payment, `RecordPaymentPage` shows a
"Payment period" panel built from `ensure_current_payment_period` +
`payment_period_status` for the child's *current* period, regardless of the
payment's date. A payment dated in September, recorded in October, shows
October's progress, which the payment did not change. Display only: the
stored payment, balances and period status are correct.

**Worth doing?** Yes, cheaply. It is the screen a Parent reads right after
entering money, and the wrong month can make a successful late payment look
like it did nothing. One page, no schema change.

**Approach.** Show the effect on the period whose month the payment falls in
(the month rule from migration `20261003090000`), and name that month in the
panel. If no stored period of the child's active plan covers the date (the
month was never materialized, or the date is before the plan started), show
no period panel; the balance confirmation still stands. Do not reimplement
the allocation rule in the browser beyond picking which stored period to ask
about; `payment_period_status` stays the single source of the numbers.

**Alternatives rejected.** Hiding the panel for any backdated payment
(loses useful feedback for the common "recording last month's payment"
case); materializing past periods on demand (needs a new server function
for a display nicety).
