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
| P2.4 | Period status derivation (allocation rule) | todo | Depends on P2.1–P2.3. |
| P2.5 | pgTAP privilege-escalation and status regression suite | todo | Depends on P2.1–P2.4. Gates Stage 2. |
| S3.1 | Parent payment-plan management screen | todo | Depends on Stage 1 complete. |
| S3.2 | Child progress UI | todo | Depends on Stage 1 complete. |
| S3.3 | Parent dashboard plan-status card | todo | Depends on Stage 1 complete. |
| S3.4 | Record Payment: period effect on confirmation | todo | Depends on Stage 1 complete; benefits from S3.1 existing (a plan to test against). |

## Session log

_Newest entries on top._

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
