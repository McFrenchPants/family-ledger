# Implementation plan: Separate balances by category, with payment splitting

Design: `DESIGN_SPEC.md` (signed off 2026-10-03). Branch
`feature/category-balances`. Task prefix `CB`.

Two phases. **Phase A (database)** lands every rule server-side with pgTAP
coverage while keeping today's front end working unchanged (every changed
function keeps today's call shape valid via defaults; a payment recorded the
old way goes wholly to Everyday). **Phase B (front end)** builds the screens.
Every Phase A task is verifier tier (money, RLS, security-definer, migration,
audit). Phase B tasks that touch money display or the split editor are
verifier tier too; the rest default.

Deploy order when this ships: owner pushes all Phase A migrations, then the
front end is promoted. Phase A alone is safe to push early (old UI keeps
working).

Data model summary (binding for all tasks):

- `tracked_balances`: household-scoped (id, household_id, name, sort_order,
  active, `is_everyday`). Exactly one `is_everyday` row per household
  (partial unique index), created for every existing household by migration
  and for new households by trigger. Names unique per household
  (case-insensitive). Everyday cannot be archived or renamed away.
- `categories.tracked_balance_id` (nullable FK, same household). Null means
  Everyday. An expense's balance is derived from its category at read time;
  no category -> Everyday.
- `payment_allocations`: (id, household_id, member_id, transaction_id,
  tracked_balance_id, amount_cents > 0). One or more per payment/adjustment
  row; sum = -transaction.amount_cents, enforced by a deferred constraint
  trigger; never on expenses. Immutable. No direct insert/update/delete
  grants to any app role; written only by the security-definer record
  functions. A voided transaction's parts count for nothing.
- `balance_transfers`: Parent-only "move money" (member, from balance, to
  balance, amount > 0, occurred_on, note, created_by, void columns like the
  ledger). Net zero for the child total. Voidable, audited.
- `payment_plans.tracked_balance_id` not null (backfilled to Everyday); one
  active plan per (member, balance).
- `payment_suggestions` + `payment_suggestion_parts`: Child-created proposals
  (status pending/converted/dismissed/withdrawn), never ledger rows.

## Phase A — database

### CB1 — Tracked balances and the per-balance read path
Tables/columns above for `tracked_balances` and `categories.tracked_balance_id`;
Everyday backfill + new-household trigger; RLS (all household members read;
writes Parent-only via security-definer functions `create_tracked_balance`,
`update_tracked_balance` (name/order/archive), `set_category_balance`), all
audited. New read function `household_member_balance_breakdown(p_household_id)`
returning (member_id, tracked_balance_id, balance_cents) with the same
visibility rule as `household_member_balances` (Parent: all active members;
Child: self). In CB1 it counts expenses by category mapping and puts every
payment/adjustment on Everyday (CB2 replaces that with parts).

Acceptance:
1. Every household has exactly one Everyday row after migration; a new
   household gets one automatically.
2. Per member, SUM of breakdown = `household_member_balances` total (pgTAP
   over a fixture with several categories, mapped and unmapped, voided rows).
3. Child cannot create/rename/archive balances or remap categories (direct
   table writes and the functions both rejected); Child sees only own
   breakdown; no cross-household reads.
4. Remapping a category moves its expenses' balance; totals unchanged.
5. Audit rows for every Parent write. Suite green, new tests mutation-proofed.

### CB2 — Payment/adjustment allocation parts
`payment_allocations` table, deferred sum constraint, backfill one Everyday
part for every existing payment/adjustment. `record_payment` and
`record_adjustment` gain `p_allocations jsonb default null`
(`[{"tracked_balance_id": ..., "amount_cents": ...}]`, positive cents);
null means one part, wholly Everyday. Replace the old signatures (drop +
create, keep grants). Validation: balances belong to the member's household
and are active, no duplicates, positive, sum matches, else reject with a
clear error. Audit row's new_values includes the parts. Breakdown function
now uses parts. Optional `p_suggestion_id` is NOT added here (CB5).

Acceptance:
1. Old-shape call still works and allocates wholly to Everyday.
2. Split payment stores parts; breakdown moves accordingly; total unchanged
   vs `household_member_balances`.
3. Mismatched sum, zero/negative part, foreign-household balance, archived
   balance, duplicate balance: each rejected, nothing written.
4. Direct insert/update/delete on `payment_allocations` rejected for
   authenticated and anon; Child can read only own parts.
5. Voiding the payment removes its parts' effect.
6. Backfill: every pre-existing payment/adjustment has exactly one part,
   equal to its amount. Mutation-proofed.

### CB3 — Move-money transfers
`balance_transfers` table + `record_balance_transfer` (Parent-only) +
voiding via a new `void_balance_transfer(p_id, p_reason)`; audited; breakdown
includes transfers. A transfer from a balance may make it negative (credit)
and that is allowed.

Acceptance: total unchanged by any transfer; from/to must differ and belong
to the member's household; Child rejected (function and direct table);
void restores; mutation-proofed.

### CB4 — Plans per balance
`payment_plans.tracked_balance_id` (backfill Everyday); unique active per
(member, balance) replaces per-member; `create_payment_plan` gains
`p_tracked_balance_id default null` (null = Everyday) and supersedes only the
same balance's active plan. `payment_period_status` counts the payment
**parts allocated to the plan's balance** (non-voided payment, same member,
part's balance = plan's balance) with the unchanged month-window rule;
adjustments still never count. `ensure_current_payment_period` unchanged
apart from what the schema needs.

Acceptance: existing pgTAP 005/012 still green (Everyday behaviour identical
to today); two plans for one child on different balances coexist; a split
payment counts each part only toward its own balance's plan; RLS and
Child-rejection cases extended; mutation-proofed.

### CB5 — Child payment suggestions
Tables, RLS (Child: read own; Parent: read household), functions:
`create_payment_suggestion` (Child only, self only, positive amount, date,
note, proposed parts summing to amount, balances in household),
`withdraw_payment_suggestion` (Child, own, pending only),
`dismiss_payment_suggestion` (Parent, reason optional), and
`record_payment(..., p_suggestion_id default null)` marking it converted in
the same transaction (pending only, same member). Audited.

Acceptance: a suggestion never changes any balance; Child cannot set status,
convert, or create for a sibling; Parent cannot create; conversion is atomic
and single-use; mutation-proofed.

## Phase B — front end

### CB6 — Settings: tracked balances
Categories settings gains "Balances": add/rename/reorder/archive tracked
balances, and per category a "Counts toward" picker (Everyday default). Plain
explanation that remapping moves past expenses too, totals unchanged.

### CB7 — Record payment split editor (verifier tier)
Amount, then parts: pre-filled suggestion (remaining current-period minimums
by earliest due date, then remainder to the last-used balance for this child,
else Everyday; or a pending child suggestion if opened from one). Editable;
Save disabled until parts sum; overpayment of a balance asks to confirm.
Confirmation shows each balance's new amount and each affected plan's
period. Adjustment uses the same editor. "Move money" form (from/to/amount).
Integer cents only.

### CB8 — Home, Family, Activity with balances
Parent Home and Family: per child, total plus breakdown and each plan's
progress; plan controls per balance on the child page. Child Home: own
breakdown and plans. Activity: split payments show their parts; transfers
listed. Balances with nothing owed and no plan hidden.

### CB9 — Child suggestions UI, export, requirements
Child: "Tell a parent about a payment" form with optional split, list of own
suggestions with outcome, withdraw. Parent Home: pending suggestions, opens
CB7 pre-filled, or dismiss. Backup/export includes the new tables.
`PROJECT_REQUIREMENTS.md` §3/§6/§7/§8 updated to the new rules.
