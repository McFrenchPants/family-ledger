# Design spec: Separate balances by category, with payment splitting

Status: **signed off by the owner 2026-10-03.** Open questions resolved: (1) only Parent-marked categories get a balance, several may share one; (2) move-money adjustment; (3) suggestions on Parent Home only, no push yet. No
file/class-level detail on purpose; that belongs in the implementation plan.

Backlog item 16. Owner decisions 2026-10-03 (live, in the orchestrator
session):

- Payments apply to a **category balance**, not to individual expenses.
- Each separately-tracked category may have **its own monthly minimum**.
- Recording a payment shows a **suggested split the Parent can adjust**.
- A **Child can suggest** where a payment should go; a Parent confirms.

This reverses `PROJECT_REQUIREMENTS.md` §3's non-goal "complex debt
allocation" in a deliberately limited form (category level, never
per-expense). §3, §6, §7 and §8 must be updated when this ships.

## Motivating example

Child owes $2,400 for a car ($300/month minimum) and $1,000 for college
(no minimum). They pay $500. The Parent records it as $300 to Car and $200
to College, or all $500 to College. Home shows each balance and the Car
month's progress separately.

## Goals

1. A child's total balance is broken down into **tracked balances**, each
   tied to one or more categories, plus one **Everyday** balance for
   everything else.
2. Every expense lands in exactly one tracked balance (by its category);
   every payment, adjustment and void is split across tracked balances,
   and the parts always add up to the whole.
3. Each tracked balance may have its own monthly payment plan (minimum, due
   day, start, optional end), with today's period/status rules unchanged
   per plan.
4. Record payment pre-fills a split the Parent can change before saving.
5. A Child can send a **payment suggestion** ("I sent $500, put $300 on the
   car") that a Parent turns into a real payment, adjusting if needed.
6. The total balance shown today stays exactly the same number; this only
   adds a breakdown.
7. Everything enforced server-side and audited; a Child still can never
   reduce any balance.

## Non-goals

- Paying off individual expenses (the rejected alternative).
- Interest, automatic transfers, or any real money movement.
- Moving an already-recorded expense between balances by editing it
  (transactions stay immutable; a correction is void + re-enter, as today).
- Reminders per balance (Phase 5 will build on per-balance plans later).

## Requirements

### R1. Tracked balances
- A Parent can mark a category as **tracked separately** (e.g. Auto ->
  "Car", School -> "College"). Optionally several categories share one
  tracked balance (see Open Q1).
- Categories not tracked separately, and expenses with no category, roll
  into **Everyday**. Everyday always exists.
- Balance per tracked balance = SUM of its non-voided parts; derived, never
  stored (standing rule). Child total = SUM across balances = today's
  number.
- A tracked balance with nothing owed and no plan is hidden from the child's
  view, not deleted.

### R2. Payment and adjustment splitting
- A payment (or balance-decreasing adjustment) is stored once as today,
  plus its **allocation parts**: (balance, amount). Parts are positive
  cents, at least one, and sum exactly to the payment's amount (DB
  constraint, not UI).
- A part may exceed what that balance owes only if the Parent confirms an
  overpayment; the result shows as a credit on that balance (§6 language
  already allows an explicit credit).
- Voiding a payment voids its parts with it.
- Parts are immutable like the transaction itself.

### R3. Suggested split (Record payment)
- Default suggestion: first, each tracked balance's **remaining minimum for
  its current period**, in order of earliest due date; then any remainder to
  the balance the Parent last picked for this child, or Everyday.
- If a Child's pending suggestion exists for this child, it pre-fills
  instead (R5).
- The Parent can edit any part, add or remove balances; Save is disabled
  until parts sum to the amount (and the server rejects otherwise).
- The confirmation shows the effect on each balance and each affected plan.

### R4. Plans per tracked balance
- Today's one-active-plan-per-child becomes one-active-plan-per-balance.
- A plan's period counts only the payment **parts** allocated to its
  balance, using the existing month-window rule (§7.3) on the payment's
  date.
- The existing per-child plan becomes the Everyday plan on migration.

### R5. Child payment suggestions
- A Child can create a **suggestion**: amount, date, optional note, and a
  proposed split. It changes no balance and is never a ledger row.
- Parents see pending suggestions on Home; opening one goes to Record
  payment pre-filled. Recording links the payment to the suggestion and
  closes it. A Parent can also dismiss it with an optional reason.
- A Child sees their own suggestions and their outcome; can withdraw a
  pending one. No editing after creation.
- Server-side: a Child can only insert suggestions for themselves, only
  positive amounts, cannot set status, and cannot create a payment.

### R6. Display
- Parent Home and Family: each child's total, with a breakdown by balance
  (and each plan's month progress). Child Home: the same for themselves.
- Activity: a payment row shows its split ("$300 Car · $200 College").
- Add expense: unchanged except it shows which balance the chosen category
  feeds.
- Backup/export includes balances, parts and suggestions.

### R7. Migration of existing data
- All existing expenses and payments go to Everyday; no historical payment
  is re-split. Totals unchanged, verified by a test comparing every child's
  total before and after.
- A Parent can then mark categories tracked; expenses in those categories
  move to the new balance automatically (they were never "allocated"; an
  expense's balance is derived from its category). Past payments stay on
  Everyday, which may then show a credit while the new balance shows the
  full amount owed. The Parent fixes that with a one-off **rebalance
  adjustment** (Open Q2).

### R8. Security invariants (verifier checks these)
- Allocation parts are written only inside the Parent-only payment /
  adjustment functions, never by direct table insert from any role.
- A Child cannot change parts, cannot create a payment from a suggestion,
  cannot mark a category tracked, and cannot see another child's balances,
  plans or suggestions.
- Parts sum to the transaction amount, enforced in the database.
- Every write here (tracked-balance changes, payments with parts, plans,
  suggestion create/dismiss/convert) writes an audit row.
- Totals before/after migration identical per child.

## Constraints
- Integer cents throughout; split arithmetic never uses floats.
- Household time zone for every date rule (unchanged).
- Free tier; no new services.

## Risks
- This touches the money core: balances, plans and every status read. The
  plan must keep the total-balance path untouched and add the breakdown
  beside it, with heavy pgTAP coverage and verifier review per task.
- Category-to-balance mapping changing over time moves expenses between
  balances retroactively (R7). Acceptable because balances are derived and
  the total never moves, but it must be explained in the UI when a Parent
  changes the mapping.

## Open questions (resolved 2026-10-03, proposed answers adopted)

1. **Which categories get their own balance?** Proposed: only ones a Parent
   marks "track separately"; everything else is pooled as Everyday. The
   alternative, every category being its own balance, would give a child a
   Gas balance, a Food balance, and so on. Can several categories share
   one balance (e.g. Auto and Gas both feed "Car")? Proposed: yes.
2. **Fixing old payments after switching on a tracked balance.** Proposed:
   a Parent-only "move balance" adjustment that shifts an amount from one
   balance to another (net zero, audited). The alternative is letting a
   Parent re-split an old payment, which breaks "transactions are
   immutable".
3. **Child suggestions: notification?** Proposed: shown on Parent Home only
   for now; push notification waits for Phase 5.
