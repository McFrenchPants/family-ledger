# Analysis: Separate balances by category, with payment splitting (backlog 16)

Written 2026-10-03 with the owner, who answered the four framing questions
live.

**Problem.** A child's debt is one pot today. Real family debts are not: a
car paid off at a fixed monthly amount and a one-off college cost have
different expectations, and a payment toward one should not look like
progress on the other. Today's single per-child plan cannot express "Car
$300/month, College whenever", and the Parent cannot say where a payment
went.

**Worth doing?** Yes; it is the owner's stated real need and the current
model genuinely cannot express it. It is the largest change since Phase 2
and touches balances, plans, Record payment, Home and Activity.

**Shape chosen (owner).** Category-level balances, not per-expense
allocation (per-expense was the original non-goal and is much fiddlier for
little gain). Per-balance plans. Suggested split, Parent adjusts. Child can
suggest a split; Parent confirms.

**Key design calls (orchestrator, in the spec).** Total balance stays the
same derived number, with the breakdown beside it. Only categories marked
"track separately" get their own balance; the rest pool into Everyday, so a
child is not shown a Gas balance and a Food balance. Payments carry
immutable allocation parts that must sum to the payment. Existing data all
goes to Everyday, so no historical number changes.

**Simpler alternatives considered.** (a) Several plans per child without
split payments: cannot show what is owed per debt. (b) Treat "Car" as a
separate child-like member: hacky, breaks permissions and Home. (c) Labels
only, no split: does not meet the request.
