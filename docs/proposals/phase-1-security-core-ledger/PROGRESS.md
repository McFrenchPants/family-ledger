# Progress: Phase 1 — Security and core ledger

Branch: `feature/phase-1-security-core-ledger` (off `main`).

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
| P1.1 | Ledger schema: transactions, categories, audit log, household policy | done | Verifier: PASS on all 6 criteria. |
| P1.2 | RLS policies for read access and audit-log protection | done | Verifier: PASS on all 7 criteria. |
| P1.3 | Security-definer functions: insert expense/payment/adjustment, void | done | Verifier: FAIL on first pass (anon could still execute all four functions — default-privileges grant, not covered by `revoke ... from public`), fixed by orchestrator; re-verified independently. |
| P1.4 | Balance derivation | done | Verifier: PASS on all 11 criteria. |
| P1.5 | pgTAP privilege-escalation and integrity regression suite | todo | Depends on P1.1–P1.4. Gates Stage 2 — must be green before any UI task starts. |

Stage 2 (Parent/Child dashboards, Add Expense, Record Payment, History) is
not yet broken into tasks — it will be appended to `IMPLEMENTATION_PLAN.md`
once P1.5 is done and verified, per the design spec's gate.

## Session log

_Newest entries on top._

### 2026-09-05 — P1.4 verified (pass)

Verifier returned **pass** on all eleven acceptance criteria, all
independently re-derived with real fixtures and the actual `record_expense`/
`record_payment`/`record_adjustment`/`void_ledger_transaction` RPCs (not raw
inserts) generating the ledger activity.

**What landed.** One migration,
`supabase/migrations/20260905010000_ledger_member_balances.sql`:
`public.household_member_balances(p_household_id uuid)`, a `SECURITY
DEFINER` SQL function returning `(member_id, balance_cents)` — live
`SUM(amount_cents) WHERE voided_at IS NULL`, coalesced to `0` for a member
with no transactions. Chosen over a `security_invoker` view specifically
because `household_members` still has zero RLS policies of its own (a
Phase 0 default-deny state carried through P1.1–P1.3): a security_invoker
view's `FROM household_members` would see nothing for anyone and silently
break the "0 balance" guarantee for every caller. The function reuses
P1.2's exact access-boundary helpers
(`internal.is_household_parent`/`internal.current_household_member_id`)
rather than reimplementing them — a Parent sees every active member's
balance in their household, a Child sees only their own row, and a
household_id the caller doesn't belong to yields zero rows, never another
household's data. Correctly applied the explicit `revoke ... from public,
anon` pattern P1.3's verifier forced onto this project — confirmed `anon`
genuinely cannot call it.

Verifier specifically pushed on the cross-household edge cases (Child
against household B, Parent of A against B, a nonexistent household_id) —
all three yielded zero rows, no error, no data disclosure.

Starting P1.5 (pgTAP privilege-escalation suite) next — this is the last
Stage 1 task and the gate for Stage 2 (UI).

### 2026-09-05 — P1.3 verifier FAIL, fixed by orchestrator, re-verified

Verifier's first pass returned **fail**. Every functional/authorization
acceptance criterion passed (Child restricted from payment/adjustment/void,
`child_expense_scope` enforced correctly, cross-household isolation held,
sign checks fire at the function layer independent of the table CHECK,
audit_log writes are atomic with the ledger insert), but one explicit
requirement was not met: **`anon` could still execute all four public RPCs**.
Root cause: Supabase's `ALTER DEFAULT PRIVILEGES` grants `EXECUTE` to
`anon`/`authenticated`/`service_role` automatically at function-creation
time, as a grant independent of the PUBLIC pseudo-role — so
`revoke execute on function ... from public` (what the implementer wrote)
never touched it. Not an exploitable write path (an unauthenticated `anon`
caller still has no `auth.uid()`, so every function's own caller-membership
check rejects it) but a real, testable miss against the stated requirement
and the standing invariant that these functions must not be callable by
`anon`.

**Fixed directly by the orchestrator** (small, precise correction, not a
re-spawn): every `revoke` in
`supabase/migrations/20260904233000_ledger_write_functions.sql` now
explicitly lists `anon` (and, for the two `internal`-schema helpers,
`authenticated` too, since nothing outside the public wrapper functions
should be able to call them directly). Re-verified independently:
`has_function_privilege('anon', ..., 'execute')` now `false` for all six
functions; `has_function_privilege('authenticated', ...)` still `true` for
exactly the four intended public entry points.

Also fixed the verifier's second, non-blocking finding: `record_expense`
and `internal.record_balance_decrease` previously looked up the *target*
member's existence/status before checking the *caller's* own household
membership, letting an outsider distinguish "no such member" / "exists but
archived" / "exists and active" for a member in a household they don't
belong to. Reordered so the caller-membership (or Parent-role, for
payment/adjustment) check runs first and produces one generic rejection in
all three cases — verified directly: probing a nonexistent id, an archived
household-A member, and an active household-A member, all as an
unrelated household-B Parent, now raise the identical
`'caller is not an active member of this household'` (or the Parent-only
equivalent), and the legitimate expense-recording path still works
unchanged.

Re-ran the full verification set after both fixes: `npx supabase db reset`
clean, `npm run test:db` still 19/19 on Phase 0's suite, and a fresh
manual script confirming the three previously-distinguishable error paths
now collapse to one.

### 2026-09-04 — P1.2 verified (pass)

Verifier returned **pass** on all seven acceptance criteria, all
independently re-derived against the live local database with real
two-household/Parent+Child fixtures, not taken on the implementer's report.

**What landed.** One migration,
`supabase/migrations/20260904230000_ledger_rls_policies.sql`. The notable
design decision: a new `internal` schema holding three `SECURITY DEFINER`
helper functions (`is_household_member`, `is_household_parent`,
`current_household_member_id`), because `household_members` itself still
has RLS enabled with zero policies (a deliberate Phase 0 default-deny
state) — a plain policy subquerying it directly would always see zero rows
and every predicate would silently evaluate false forever. Each helper
only ever reports the *caller's own* membership (derived from `auth.uid()`
internally, no caller-supplied user id), lives outside `api.schemas`
(confirmed not reachable via PostgREST), and `authenticated` isn't even
granted `USAGE` on the schema — verifier confirmed no privilege-escalation
surface.

`ledger_transactions` gets role-scoped SELECT (Parent sees household-wide,
Child sees only their own `member_id`) and deliberately no UPDATE/DELETE/
INSERT policy — default-deny is the entire enforcement, and the verifier
confirmed both roles get silently zero-rows-affected on UPDATE/DELETE
attempts. `audit_log` uses two independent layers: grants revoked from
`anon`/`authenticated` (primary — fails loud with `permission denied`
before RLS even runs) plus a Parent-only SELECT policy with no write
policy at all (secondary, in case grants were ever loosened by mistake).
Verifier confirmed both layers are real and non-redundant, not just
decorative. `categories` is Parent-write/household-read as specified.

**Not yet committed at verification time** — committing now, in this same
step, before starting P1.3.

Carried forward for P1.3: the `internal.*` helpers are ready to reuse from
the insert/void RPCs; a `SECURITY DEFINER` function's writes are governed
entirely by its *owner's* privileges, independent of what was just revoked
from `anon`/`authenticated` on `audit_log` — confirmed empirically, so
P1.3's audit-writing function will not be blocked by anything here.

### 2026-09-04 — P1.1 verified (pass)

Verifier returned **pass** on all six acceptance criteria, all independently
re-derived against the live local database rather than taken on the
implementer's report.

**What landed.** One migration,
`supabase/migrations/20260904223000_ledger_schema.sql`: `categories`,
`ledger_transactions` (three types — expense/payment/adjustment — with a
sign-vs-type CHECK and an all-or-nothing void-state CHECK), `audit_log`, and
`households.child_expense_scope` (text enum, defaults `'any_member'`). RLS
enabled with zero policies on all three new tables (default-deny), matching
the Phase 0 pattern. `category_id` household-matching is enforced via a
composite FK against a new `categories (id, household_id)` unique
constraint, not a trigger. `created_by`/`voided_by` reference
`household_members`, not `auth.users` directly.

**Verifier's one non-blocking finding.** No pgTAP regression tests were
added for the new constraints (amount-sign check, void-all-or-nothing
check, cross-household category FK) — expected, since that's P1.5's job,
not this task's. Verifier's manual verification of these constraints does
not persist as a regression guard until P1.5 lands; noted so it isn't
forgotten.

**Also confirmed:** `audit_log`'s table-level grants for `anon`/
`authenticated` are Supabase's broad defaults (same as every other table),
so the append-only guarantee currently rests entirely on RLS staying
enabled with no policy ever added — P1.2 should either gate all writes
through a security-definer function or explicitly narrow the raw grants as
defense in depth, per the implementer's own report.

Starting P1.2 (RLS policies) next.

### 2026-09-04 — Plan created; Stage 1 scaffolded

Branched from `main`. Analysis (`analysis/01-phase-1-security-core-ledger.md`)
and design spec both went through explicit user check-ins: void model is a
status-flip (not a reversal row), a third `adjustment` transaction type is
in scope alongside `expense`/`payment`, and the household expense-policy
toggle is built into the schema now (defaulted permissive) even though its
settings UI waits for Phase 4. Design spec signed off 2026-09-04.

Five Stage-1 tasks planned (P1.1–P1.5), matching this run's
`max_tasks_per_run` budget of 5. All five are floor/widen-tier and will go
through the `verifier` agent. Starting P1.1 next.
