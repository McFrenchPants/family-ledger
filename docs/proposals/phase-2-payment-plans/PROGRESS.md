# Progress: Phase 2 — Payment plans

Branch: `feature/phase-2-payment-plans` (off `main`).

## Legend

| Status | Meaning |
| --- | --- |
| `todo` | Not started. |
| `in-progress` | Actively being worked. |
| `blocked` | Waiting on a decision, credential, device, or upstream task. |
| `done` | Complete and verified. |

## Tasks

| ID | Task | Status | Notes |
| --- | --- | --- | --- |
| P2.1 | Schema: `payment_plans` and `payment_periods` | done | Verifier: PASS on all 7 criteria, independently re-derived. |
| P2.2 | RLS policies for read access | done | Verifier: PASS on all 5 criteria, independently re-derived. |
| P2.3 | Security-definer functions: create/deactivate plan, ensure-current-period, waive | done | Verifier: FAIL on first pass (month-walk compounding drift for starts_on on day 29-31), fixed by orchestrator, re-verified independently PASS on all criteria. |
| P2.4 | Period status derivation (allocation rule) | done | Verifier: PASS on all 10 criteria, independently re-derived. |
| P2.5 | pgTAP privilege-escalation and status regression suite | done | Verifier: PASS on all criteria, all 3 mutation-proofing claims independently re-derived. **Stage 1 is gated-green.** |
| S3.1 | Parent payment-plan management screen | done | Spot-checked (default tier, no RLS/security-definer changes). |
| S3.2 | Child progress UI | done | Spot-checked (default tier); live-verified against local Supabase (Due/Partially Paid/Satisfied/no-plan). |
| S3.3 | Parent dashboard plan-status card | done | Spot-checked (default tier); live-verified against local Supabase (Due/Overdue/Satisfied/no-plan, four children). |
| S3.4 | Record Payment: period effect on confirmation | done | Spot-checked (default tier); live-verified all 4 scenarios (in-window/no-plan/out-of-window/adjustment). |

## Session log

_Newest entries on top._

### 2026-09-05 — S3.4 done: Record Payment period effect. **Phase 2 complete.**

Default verification tier (only read-path RPCs, already verified in Stage
1). Spot-checked the diff against all 4 acceptance criteria, independently
re-ran `npm run typecheck`/`lint`/`test` (clean; 222/222), and independently
confirmed via `docker exec` that `payment_plans`/`payment_periods`/
`ledger_transactions`/`audit_log`/`auth.users` are all back to 0 rows and
`household_members` shows no residual scratch data.

**What landed.** `src/pages/RecordPaymentPage.tsx` only: the confirmation
panel gains a period-effect block, populated only for `type === "payment"`
(never for an adjustment — adjustments don't count toward a period, so
showing period UI there would mislead, not help). Fetches the member's
active plan, then `ensure_current_payment_period`→`payment_period_status`
inline in `handleSubmit`, right before the final `"done"` state transition.
A failure in this secondary read is deliberately swallowed to `periodEffect:
null` (documented inline) rather than surfaced as a second error — the
payment write itself already succeeded by that point, so a read-only
follow-up failing must not read as the payment having failed. A payment
dated outside the current period's allocation window correctly shows the
period's real (unaffected) numbers, never a false "counted" state — the
existing `payment_period_status` allocation rule already handles this
correctly with no UI-side special-casing needed.

**Live-verified** all four required scenarios against the local Supabase
stack: in-window payment (correct paid/remaining/status), no-active-plan
(plain confirmation only, no error), out-of-window payment (period numbers
correctly unchanged), and an adjustment (no period UI at all). All scratch
fixtures removed; independently re-confirmed clean (see above).

**Phase 2 (payment plans) is done.** Both stages complete and verified:
Stage 1 (P2.1–P2.5, verifier-routed, gated-green — the Child
privilege-escalation suite this project's standing rules require before UI
work) and Stage 2 (S3.1–S3.4, spot-checked, each independently re-verified
by the orchestrator against real fixtures or independent test/typecheck
reruns). This run used 4 of its `max_tasks_per_run` budget of 5. Next step
is a `full`-mode routine merge of `feature/phase-2-payment-plans` into
`main` via the supervisor role.

### 2026-09-05 — S3.3 done: Parent dashboard plan-status card

Default verification tier (only read-path RPCs, already verified in Stage 1
and reused unchanged from S3.2). Spot-checked the diff against all 3
acceptance criteria, independently re-ran `npm run typecheck`/`lint`/`test`
(clean; 222/222), and independently confirmed via `docker exec` against the
local Postgres container that `payment_plans`/`payment_periods`/
`ledger_transactions` are empty and `household_members` shows no residual
scratch rows, rather than taking the implementer's cleanup claim on faith.

**What landed.** `src/features/payment-plans/useHouseholdPaymentProgress.ts`
(new hook): one batched `payment_plans` query across the whole roster, then
`ensure_current_payment_period`→`payment_period_status` via `Promise.all`
only for children that actually have an active plan — reuses
`useChildPaymentProgress`'s types/row-shapes/clamping verbatim so a Parent
and a Child derive identical status. Extended
`src/pages/ParentDashboardPage.tsx`: each child's existing balance row
(still a single clickable `Link` to history) gains a status chip + due date,
a distinct neutral "No active plan" chip (visually and textually separate
from "Satisfied" — AC2), a per-row "Loading plan status…" placeholder
independent of the balances' own loading state, and a scoped error+Retry
that doesn't blank the whole page if only plan-status fails.

**Live-verified against the local Supabase stack** across all four required
states in one household: Due, Overdue, Satisfied (via a real payment
transaction), and no-active-plan — confirmed via `read_page` and a
screenshot. All scratch fixtures were deleted afterward; independently
re-confirmed clean (see above).

**Stage 2 now has one task remaining: S3.4** (Record Payment: period effect
on confirmation). Starting it next.

### 2026-09-05 — S3.2 done: Child progress UI

Default verification tier (only read-path RPCs: `ensure_current_payment_period`
and `payment_period_status`, both already verified in Stage 1). Spot-checked
the diff against all 4 acceptance criteria, then independently re-ran
`npm run typecheck`/`lint`/`test` (clean; 222/222) rather than taking the
implementer's report on faith.

**What landed.** `src/features/payment-plans/useChildPaymentProgress.ts`
(new hook mirroring `useOwnBalance`'s retry-token pattern): resolves the
child's own active plan, lazily materializes its current period via
`ensure_current_payment_period`, then reads status/amounts via
`payment_period_status`; `progress: null` (no active plan) is a normal
`loaded` outcome, not an error, matching `usePaymentPlan`'s convention.
Extended `src/pages/ChildDashboardPage.tsx` with a `PaymentProgressCard`
between "You Owe" and "+ Add Expense" (§11.2 ordering) — all six statuses
(Upcoming/Due/Partially Paid/Satisfied/Overdue/Waived) get a colored chip
**with a text label** (never color alone, AC3) plus status-specific copy
(never a generic "$0.00 remaining" template for Satisfied/Waived, AC1). No
active plan renders nothing at all for this section — no heading, no
placeholder (AC2).

**Live-verified against the local Supabase stack**, not just component-mount
inspection: a scratch auth user linked to the seeded "Child One" member,
driven through the real dev server + browser across four states (Due →
Partially Paid → Satisfied → plan deactivated/no active plan, confirming the
section is fully absent from the DOM in that last case). All scratch
fixtures (plan, transactions, member linkage, auth user) were deleted
afterward; `supabase/` shows no diff.

Starting S3.3 (Parent dashboard plan-status card) next.

### 2026-09-05 — S3.1 done: Parent payment-plan management screen

Default verification tier (no RLS/security-definer/audit_log changes — this
task only calls the already-verified `create_payment_plan`/
`deactivate_payment_plan` RPCs), so spot-checked directly: reviewed the full
diff against all 5 acceptance criteria, then independently re-ran
`npm run typecheck`/`lint`/`test` rather than taking the implementer's report
on faith. Typecheck clean, lint clean, 222/222 tests passing (12 files,
including a new 13-test `payment-plans.test.ts`).

**What landed.** `src/features/payment-plans/payment-plans.ts` (pure types +
`validatePlanForm`, mirroring `record-transaction.ts`'s split), `usePaymentPlan.ts`
(fetches the member's current active plan, mirroring `useHouseholdBalances`'s
retry-token pattern — `plan: null` is a normal "no active plan" outcome, not an
error), and `src/pages/PaymentPlanPage.tsx` at `/child/:memberId/payment-plan`.
Parent-only end to end via the same `RecordPaymentPage`-style membership gate
(not `RequireRole`) — a Child hitting this route directly sees only "Only a
parent can manage a payment plan.", no create/edit/deactivate control ever
renders (AC4). "No active plan" is its own labeled state with a direct-submit
create form (AC1, AC3's converse). An existing active plan shows its terms plus
a `ReplacePlanControl` (collapsed→editing→confirming→submitting→error) that
explicitly names the old plan's terms before calling `create_payment_plan` to
supersede it (AC2), and a `DeactivatePlanControl` with the same two-step-confirm
shape (AC3). Both mirror `HistoryPage`'s `VoidControl` state-machine shape.
Every RPC failure surfaces `error.message` verbatim, re-submittable — no
silent queue (ADR-007). Added the route in `router.tsx` and a
"Manage payment plan" link on `HistoryPage`, gated on `viewerRole === "parent"`.

Starting S3.2 (Child progress UI) next.

### 2026-09-05 — P2.5 verified (pass); Stage 1 complete and gated-green

Verifier returned **pass**, and — since this task gates the entire next
stage — was explicitly asked to independently re-derive all three
mutation-proofing claims rather than trust the implementer's reported
numbers. It did: dropping `payment_plans_member_id_active_key` flipped
test 27 red (then cascaded, since `create_payment_plan` itself depends on
the invariant); neutering the Parent-only check in `waive_payment_period`
flipped exactly tests 6, 7, 10 (Child and cross-household rejection);
removing the allocation-window/voided filters from `payment_period_status`
flipped exactly tests 47-49, 52-53 (the boundary/voided-payment
assertions). All three restored, full 126-assertion suite re-confirmed
green afterward.

**What landed.** One new file,
`supabase/tests/005_payment_plans_privilege_escalation.sql` — 53 pgTAP
assertions covering every negative case from the design spec (Child
attempting create/deactivate/waive, cross-household rejection on all three
write RPCs, Child SELECT scoping, raw-table-bypass rejection, anon
execute-denial on all five functions) plus every integrity case (active-
plan uniqueness both at the schema and RPC-supersede level, waive
all-or-nothing CHECK, reason validation, idempotent period generation,
voided-payment exclusion, the asymmetric allocation-window boundary) and
every status-derivation case (all six statuses, including the two
trickiest interactions: satisfied beating overdue both before and after
due_date, and waived beating both). `npm run test:db` now runs 126
assertions total across all five files (73 from Phase 0/1, unmodified; 53
new), all green from a clean `npx supabase db reset`.

**Stage 1 (the DB/authorization layer) is done.** Every one of P2.1–P2.5
is verifier-passed, and the Child privilege-escalation suite — the gate
this project's standing rules require before proceeding to UI — is
genuinely green, independently confirmed twice (implementer's report, then
the verifier's own re-derivation of every mutation-proofing claim).

**This closes out this run's `max_tasks_per_run` budget of 5
(P2.1–P2.5).** Stage 2 (S3.1–S3.4, the UI layer) carries to a future run.

### 2026-09-05 — P2.4 verified (pass)

Verifier returned **pass** on all ten acceptance criteria, all
independently re-derived with real fixtures built exclusively through the
established RPCs (`create_payment_plan`, `ensure_current_payment_period`,
`record_payment`/`record_expense`/`record_adjustment`,
`void_ledger_transaction`, `waive_payment_period`) — never raw inserts.
Given P2.3 had a verifier-caught date bug, the verifier specifically
stress-tested this task's boundaries too; all held.

**What landed.** One migration,
`supabase/migrations/20260905060000_payment_period_status.sql`:
`public.payment_period_status(p_period_id)`, a `SECURITY INVOKER` (not
DEFINER) table-valued function returning status plus paid/remaining
cents — deliberately invoker-rights since it discloses nothing beyond
what the caller's existing RLS SELECT policies already allow, unlike
P2.3's write functions which needed DEFINER to check a caller's role
against a target row before revealing anything. The allocation rule
(`type='payment'`, not voided, `occurred_on > period_start and <=
due_date`) is implemented exactly once. Status precedence: waived beats
satisfied beats overdue beats partially_paid beats due beats upcoming —
verifier specifically confirmed the two trickiest interactions
(fully-paid-after-due-date still reads `satisfied`, not `overdue`; a
payment dated exactly `period_start` is excluded while one dated exactly
`due_date` is included) are correct by design, not by accident of test
data. Time zone resolved the same way P2.3's fix does
(`(now() at time zone h.timezone)::date`).

Bonus check beyond the plan's criteria: confirmed `expense`/`adjustment`
transactions never count toward a period's paid amount, only `payment`.

**Stage 1 (P2.1–P2.4) is done.** P2.5 (the pgTAP regression suite) is the
last Stage 1 task and gates Stage 2 (UI) — this run's `max_tasks_per_run`
budget of 5 will be fully used once P2.5 completes.

### 2026-09-05 — P2.3 verifier FAIL, fixed by orchestrator, re-verified

Verifier's first pass returned **fail**. Nine of ten acceptance criteria
passed, but `ensure_current_payment_period`'s month-walk loop had a real,
reachable bug: it compounded from its own previous iteration
(`v_period_start := (v_period_start + interval '1 month')::date`), so for
any plan with `starts_on` on day 29/30/31, Postgres's month-length clamping
(e.g. `2025-01-31 + 1 month` → `2025-02-28`) never recovered — a
`starts_on = '2025-01-31'` plan silently drifted to `period_start =
2026-08-28` after ~20 iterations instead of the correct `2026-08-31`.
`starts_on` is not schema-constrained to 1-28 (only `due_day` is), so this
was a reachable input, not a contrived edge case, and directly undermines
the household-timezone/due-date-correctness standing rule even though the
timezone resolution itself was correct.

**Fixed directly by the orchestrator** (small, precise correction): each
candidate `period_start` is now anchored back to the plan's *original*
`starts_on` (`starts_on + N months`, computed independently for each N)
rather than compounding from the previous iteration's already-clamped
result. Independently confirmed via direct SQL before re-verification:
`('2025-01-31'::date + (19 || ' months')::interval)::date` = `2026-08-31`
(correct) vs. the old buggy output of `2026-08-28`.

Re-verified independently: the original repro now returns the correct
date, all 10 original acceptance criteria still hold, and three additional
boundary cases (leap-day `2024-02-29`, `starts_on` exactly today, and a
non-boundary control date) all pass against independently-computed
expected values. Verifier's one non-blocking note: no pgTAP regression
test yet exists for this fix (expected — that's explicitly P2.5's job, not
this task's, per the implementation plan), so nothing currently guards
against this exact bug class recurring until P2.5 lands; flagged here so
it isn't forgotten. The existence-check-before-authorization-check
ordering asymmetry (`create_payment_plan` vs. `deactivate_payment_plan`/
`waive_payment_period`) was re-confirmed non-blocking — matches an
existing accepted pattern (`void_ledger_transaction`) and discloses only
"this ID exists somewhere," never which household.

Starting P2.4 (period status derivation) next.

### 2026-09-05 — P2.2 verified (pass)

Verifier returned **pass** on all five acceptance criteria, all
independently re-derived against the live local database with real
two-household/Parent+Child(+sibling) fixtures inside a rolled-back
transaction — not taken on the implementer's report.

**What landed.** One migration,
`supabase/migrations/20260905040000_payment_plans_rls_policies.sql`: four
SELECT policies (Parent-sees-household, Child-sees-own, one pair per
table) reusing P1.2's `internal.is_household_parent`/
`internal.current_household_member_id` helpers with no reimplementation.
No INSERT/UPDATE/DELETE policy on either table — deliberate default-deny,
matching `ledger_transactions`' exact precedent; writes are P2.3's job.

Verifier specifically probed the RLS null-membership edge case: a caller
with no `household_members` row at all gets `current_household_member_id
= NULL`, and confirmed `member_id = NULL` correctly evaluates to
unknown/false (zero rows), not a dangerous all-rows leak. Also confirmed a
sibling with no plan of their own sees zero rows under the self-policy
(true `member_id` scoping, not just household membership). One
non-blocking observation: INSERT violations raise a loud Postgres error
while UPDATE/DELETE silently affect zero rows — expected RLS behavior,
already identical in the `ledger_transactions` precedent, not a new
inconsistency.

Starting P2.3 (security-definer functions) next.

### 2026-09-05 — P2.1 verified (pass)

Verifier returned **pass** on all seven acceptance criteria, all
independently re-derived against the live local database (savepoint-per-
test, rolled back), not taken on the implementer's report.

**What landed.** One migration,
`supabase/migrations/20260905030000_payment_plans_schema.sql`:
`payment_plans` (minimum_cents/frequency/due_day/starts_on/ends_on/active,
at most one active plan per member via a partial unique index on
`(member_id) where active`, mirroring `household_members`' existing
partial-unique pattern) and `payment_periods` (period_start/due_date/
minimum_cents fixed at creation, an all-or-nothing waive-state CHECK
mirroring `ledger_transactions`' void CHECK, and a unique
`(payment_plan_id, period_start)` constraint to prevent duplicate periods
under future concurrent lazy-generation calls). `due_day` is deliberately
capped at 1–28, sidestepping end-of-month clamping ambiguity entirely
rather than resolving it per-call. Both tables denormalize `household_id`/
`member_id` from the plan onto periods, matching `ledger_transactions`'
own precedent, specifically so P2.2's RLS policies won't need to join
through `payment_plans`. RLS enabled with zero policies on both tables —
deliberate default-deny, real policies are P2.2.

Verifier's only non-blocking note: no pgTAP tests exist yet for these new
constraints (expected — that's P2.5's job, not this task's), so a future
regression against them wouldn't be caught until P2.5 lands.

Starting P2.2 (RLS policies) next.

### 2026-09-05 — Plan created; Stage 1 scaffolded

Branched `feature/phase-2-payment-plans` from `main`. Analysis
(`analysis/02-phase-2-payment-plans.md`) and design spec both went through
explicit user check-ins: one active plan per child decoupled from
individual expenses (a child's many named/categorized expenses all roll up
under a single plan), lazy period generation with no scheduler (defers
`pg_cron` to Phase 5), and waived periods require a reason, audited like
Phase 1's void workflow. Design spec signed off 2026-09-05.

Five Stage-1 tasks planned (P2.1–P2.5), matching this run's
`max_tasks_per_run` budget of 5. All five are floor/widen-tier and will go
through the `verifier` agent, mirroring Phase 1's Stage 1 treatment. Four
Stage-2 UI tasks (S3.1–S3.4) planned to follow once Stage 1 is
gated-green. Starting P2.1 next.
