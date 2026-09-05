# Implementation Plan: Phase 1 — Security and core ledger

Design spec: `DESIGN_SPEC.md` (signed off 2026-09-04). Backing analysis:
`../../../analysis/01-phase-1-security-core-ledger.md`.

Per the analysis's sequencing recommendation, Phase 1 is split into two
stages on this one branch/proposal folder. **This plan currently covers
Stage 1 only** — the data/authorization layer. Stage 2 (the UI layer) will
be appended to this file as its own task list once Stage 1's Child
privilege-escalation suite is fully green; per the design spec, Stage 2
must not start before that.

Five tasks, matching this run's `max_tasks_per_run` budget. They are
serial by nature (each stage of the DB layer builds directly on the last)
and touch overlapping migration/policy files, so they are not batched —
consistent with `max_concurrent_implementers: 1`.

**All five tasks are floor/widen-tier and go through the `verifier` agent**,
not a spot-check — this phase is exactly the
`authentication_authorization` / `data_persistence_migrations` /
`monetary_amount_or_balance_logic` /
`rls_policy_or_security_definer_function_changes` / `audit_log_integrity`
territory `.sdlc/project.yaml` names.

Carried forward from Phase 0 (`docs/proposals/phase-0-foundations/PROGRESS.md`),
binding for this plan:

- The existing pgTAP harness is superuser-only; RLS/role tests need
  `set local role` blocks layered on top, following the same
  `begin`/`rollback`-per-file pattern already established.
- `households.timezone` is already a validated, case-sensitive IANA zone
  (T3a). Nothing here needs to touch it.
- `household_members` already has a role/status CHECK and a partial unique
  index preventing one `user_id` from holding two conflicting-role rows in
  the same household (T3a) — Phase 1's policies may rely on this being
  unambiguous.
- Inserting rows into `auth.users` directly in test fixtures is a known
  soft coupling to GoTrue's schema; reuse the existing pattern from
  `supabase/tests/` rather than inventing a new fixture approach.

## Stage 1 — Data and authorization layer

### P1.1 — Ledger schema: transactions, categories, audit log, household policy

**Load the `supabase` and `supabase-postgres-best-practices` skills before
starting.**

**Scope:** A new migration under `supabase/migrations/` adding:
- `categories` (per `ARCHITECTURE.md` §8.7): household-scoped lookup table,
  seed-independent (rows come from Phase 4 admin work later, but the table
  and its household scoping exist now since `ledger_transactions.category_id`
  references it).
- `ledger_transactions` (per §8.3), with **three** transaction types —
  `expense`, `payment`, `adjustment` — not the two the architecture doc
  sketches (this was resolved in the design spec's Decisions section: both
  `payment` and `adjustment` decrease a balance and are Parent-only).
  Include the void-flag columns (`voided_at`, `voided_by`, `void_reason`)
  and every column §8.3 lists otherwise. A CHECK (or equivalent) constraint
  ties `type` to the required sign of `amount_cents` (`expense` positive;
  `payment`/`adjustment` negative) at the database level — this constraint
  is a hard requirement, not an application-layer nicety.
- `audit_log` (per §8.11), append-only for ordinary roles (enforce that
  with RLS/grants in this task or explicitly defer the enforcement to
  P1.2 if it's cleaner to land grants alongside the rest of P1.2's
  policy work — implementer's call, but state which in the completion
  report).
- A new `households` column (or small companion table, implementer's
  choice) for the expense-policy toggle discussed in the design spec:
  defaults to the permissive behavior (any member may expense any child).

**Files:** `supabase/migrations/<timestamp>_ledger_core.sql`.

**Do not** write RLS policies or security-definer functions in this task —
schema and constraints only. Do not touch `payment_plans`/`payment_periods`
(Phase 2) or `expense_presets`/`push_subscriptions`/`notification_events`
(later phases).

**Acceptance criteria:**
- `npx supabase db reset` applies cleanly from scratch.
- Inserting an `expense` row with a negative `amount_cents`, or a `payment`/
  `adjustment` row with a positive `amount_cents`, is rejected by a
  database constraint (not merely by convention).
- `ledger_transactions.member_id`/`household_id` and `categories.household_id`
  are real foreign keys; `category_id` on a transaction is nullable (a
  transaction without a category is valid) but if present must belong to
  the same household as the transaction.
- A voided transaction's columns (`voided_at`/`voided_by`/`void_reason`)
  are all-null-or-all-set together (a partial void state is invalid) —
  enforced by a constraint, not left to application discipline.
- The new household expense-policy column exists, defaults to permissive,
  and is not nullable.
- RLS is enabled (default-deny, no policies yet) on all three new tables,
  matching the Phase 0 T3 pattern.

**Depends on:** nothing new (Phase 0's `households`/`household_members`
are already on `main`).

### P1.2 — RLS policies for read access and audit-log protection

**Load both Supabase skills before starting.**

**Scope:** RLS policies on `categories`, `ledger_transactions`, and
`audit_log` implementing:
- Household-boundary isolation: a member may only read rows for a
  household where their membership is `active`.
- A Child may `SELECT` only their own `ledger_transactions` rows (by
  `member_id`); a Parent may `SELECT` every member's rows in their
  household.
- No role may `UPDATE` or `DELETE` `ledger_transactions` directly (voiding
  happens through a function in P1.3, not a raw `UPDATE`) or `audit_log`
  at all (no `UPDATE`/`DELETE`/direct `INSERT` for `anon`/`authenticated` —
  audit rows are written only by the security-definer functions in P1.3,
  as that owner role).
- `categories` readable household-wide; writable by Parents only (even
  though the admin UI for categories is a later phase, the write
  authorization boundary should exist now rather than being backfilled).

**Do not** write the INSERT-side policies for creating expenses/payments/
adjustments here if that logic is better expressed as a security-definer
function per the design spec's §10.4 principle ("if an RLS policy becomes
difficult to reason about, prefer a narrow RPC") — that is exactly what
P1.3 is for. If a straightforward RLS INSERT policy is genuinely simpler
and equally safe for a given case, state that reasoning in the completion
report rather than defaulting to an RPC out of habit.

**Files:** `supabase/migrations/<timestamp>_ledger_rls.sql`.

**Acceptance criteria:**
- As a Child role (via `set local role`/equivalent test harness pattern),
  `SELECT` against another household's data returns zero rows.
- As a Child, `SELECT` against a sibling's `ledger_transactions` in the
  *same* household returns zero rows; against their own returns their rows.
- As a Parent, `SELECT` returns all household members' rows.
- Any direct `UPDATE`/`DELETE` attempt against `ledger_transactions` or
  `audit_log`, by either role, is rejected.
- `categories` is readable by both roles in-household, writable only by
  Parent.

**Depends on:** P1.1.

### P1.3 — Security-definer functions: insert expense/payment/adjustment, void

**Load both Supabase skills before starting.**

**Scope:** Narrow, security-definer RPCs (per §10.4/§11) that are the only
sanctioned write path for ledger mutations:
- An expense-insert function: callable by any active household member;
  internally checks the household's expense-policy setting (P1.1) and
  rejects a Child inserting for a different member when the household is
  configured to the stricter mode; always rejects a non-positive amount;
  always writes an `audit_log` row.
- A payment-record function and an adjustment-record function: both
  Parent-only (verify the caller's own membership role server-side, never
  trust a client-supplied role claim); reject a non-negative amount; both
  write an `audit_log` row.
- A void function: Parent-only; sets the void columns atomically (all three
  together, matching P1.1's constraint); rejects voiding an already-voided
  transaction; writes an `audit_log` row recording the prior state.

Every function must resolve the caller's household membership and role
itself (via `auth.uid()` and a lookup against `household_members`), not
accept either as a parameter it trusts.

**Files:** `supabase/migrations/<timestamp>_ledger_functions.sql`.

**Acceptance criteria:**
- A Child calling the expense-insert function for themselves succeeds
  (permissive-mode default); for another member, succeeds only because
  the default is permissive — re-test this specific case once the
  household is switched to the strict setting and confirm it then fails.
- A Child calling the payment or adjustment function, in any form, fails —
  not merely returns an error the client could ignore, but performs no
  write and asserted via a subsequent row-count check.
- A Child calling the void function fails, including against their own
  transaction.
- A Parent calling any of the four functions succeeds and produces exactly
  one new `ledger_transactions` effect and exactly one new `audit_log` row.
- Attempting to insert a negative-amount expense, or a positive-amount
  payment/adjustment, through the function is rejected (defense in depth
  alongside P1.1's table constraint — confirm both layers actually fire,
  don't assume the constraint alone covers the function path).
- Voiding an already-voided transaction is rejected.

**Depends on:** P1.1, P1.2.

### P1.4 — Balance derivation

**Load the `supabase-postgres-best-practices` skill before starting.**

**Scope:** A view or RPC exposing each member's current balance as
`SUM(amount_cents) WHERE voided_at IS NULL`, per §9 — never a stored/mutable
balance column. Expose it in a form both a Parent (all household members)
and a Child (self only) can read within the RLS boundary established in
P1.2.

**Files:** `supabase/migrations/<timestamp>_ledger_balances.sql`.

**Acceptance criteria:**
- Balance for a member with no transactions is `0`, not `NULL`.
- Balance reflects only non-voided rows — insert an expense, void it,
  confirm the balance returns to what it was before the insert.
- A Parent querying the balance surface sees every member's balance; a
  Child sees only their own (via the same RLS boundary, not a separate
  ad hoc check duplicated in the view).
- No application code or migration anywhere maintains a mutable balance
  column — this is a structural check (grep/schema inspection), not just
  "the new view is correct."

**Depends on:** P1.1, P1.2, P1.3 (needs real transactions to derive from,
including at least one voided one, to test meaningfully).

### P1.5 — pgTAP privilege-escalation and integrity regression suite

**Load both Supabase skills before starting.**

**Scope:** New pgTAP test file(s) under `supabase/tests/`, extending
`npm run test:db`, covering every negative case named in the design spec
and this plan:

- Child attempts to record a payment → rejected, no row written.
- Child attempts to record an adjustment → rejected, no row written.
- Child attempts to insert a negative-amount expense → rejected.
- Child attempts to insert an expense with a wrong-signed/mismatched type
  combination → rejected (table constraint).
- Child attempts to void any transaction (their own or another's) →
  rejected.
- Child attempts to directly `UPDATE`/`DELETE` a `ledger_transactions` row
  (bypassing the functions entirely) → rejected by RLS.
- Child attempts to read another household's `ledger_transactions`,
  `categories`, or balance data → zero rows, not an error that leaks
  existence.
- Child attempts to read a sibling's `ledger_transactions` in the same
  household → zero rows.
- Child attempts to insert an expense for a different member while the
  household is in strict (self-only) mode → rejected; the same call
  succeeds in permissive mode — proving the toggle actually changes
  behavior, not just that it exists as a column.
- Child attempts to write to `audit_log` directly, in any form → rejected.
- Parent performing each legitimate action (expense, payment, adjustment,
  void) succeeds and produces the expected balance and audit effects.
- A structural assertion that RLS is enabled on all three new tables and
  that no permissive policy accidentally grants a Child role write access
  to `ledger_transactions`/`audit_log`.

**Mutation-proof the suite**, per `CLAUDE.md`'s standing testing rule:
temporarily drop or weaken each policy/constraint/function check in turn on
a scratch reset, confirm the relevant tests actually go red, restore, and
report the actual failure counts — do not assert this from reasoning alone.

**Files:** `supabase/tests/*.sql` (new files; do not modify the existing
Phase 0 test files unless a genuine conflict requires it — explain in the
report if so).

**Acceptance criteria:**
- `npm run test:db` passes from a clean `npx supabase db reset`.
- Every negative case above has its own named assertion, not a single
  broad "some error occurred" check.
- The mutation-proofing exercise is reported with concrete before/after
  failure counts for each policy/constraint/function it targeted.
- This suite is the thing that gates Stage 2 — do not report Stage 1
  complete in `PROGRESS.md` until this task is verifier-passed.

**Depends on:** P1.1, P1.2, P1.3, P1.4 (all done).

## After Stage 1 lands

Orchestrator (not a subagent) confirms the full privilege-escalation suite
is green, updates this proposal's `PROGRESS.md`, and only then writes
Stage 2's task list (Parent dashboard, Child dashboard, Add Expense,
Record Payment, History) as a new section appended to this file — mirroring
how Phase 0 grew its plan incrementally rather than trying to fully
pre-specify UI tasks against a data layer that doesn't exist yet.

Stage 1 landed 2026-09-05: P1.1–P1.5 all verifier-passed, the 35-assertion
Child privilege-escalation suite is green and mutation-proofed. Stage 2
below is appended per that gate.

## Stage 2 — UI layer

**A gap Stage 1 leaves open, that Stage 2 must close first (S2.1):**
`household_members` still carries RLS enabled with **zero policies** — a
deliberate Phase 0 default-deny state that P1.2/P1.4 each had to route
around with a `SECURITY DEFINER` helper for their own narrow purpose
(`internal.is_household_member`/`is_household_parent`/
`current_household_member_id`, and `household_member_balances`). None of
those expose the thing the UI now actually needs: the current user's own
membership row (their `id`, `role`, `name`, `household_id`) to know who
they are and where to route them, and — for a Parent — every active
member's `name` in their household to put names on the dashboard
(`household_member_balances` returns `member_id`/`balance_cents`, not
`name`). Building the UI against a direct `select * from household_members`
would currently return zero rows for everyone. S2.1 closes this gap; every
later Stage 2 task depends on it.

Existing RPCs Stage 2 calls, unchanged from Stage 1 (all `security definer`,
already granted to `authenticated`, already revoked from `anon`):
- `public.household_member_balances(p_household_id uuid) returns table
  (member_id uuid, balance_cents bigint)` — Parent gets every active
  member's balance in the household, Child gets only their own row.
- `public.record_expense(p_member_id, p_amount_cents, p_description,
  p_occurred_on, p_category_id default null, p_note default null) returns
  ledger_transactions` — any active member; a Child is restricted by
  `households.child_expense_scope` when it is `'self_only'`.
- `public.record_payment(...)` / `public.record_adjustment(...)` — same
  signature shape as `record_expense`, both Parent-only, both require
  `p_amount_cents < 0`.
- `public.void_ledger_transaction(p_transaction_id uuid, p_void_reason
  text) returns ledger_transactions` — Parent-only, rejects an
  already-voided row, requires a non-empty reason.

None of S2.2–S2.7 below introduce a new security-definer function or RLS
policy — per the design spec's verification-routing carve-out, only S2.1
goes through the `verifier` agent; the rest are spot-checked normally
unless a task turns out to need its own new RPC/policy (state that
explicitly in the completion report if so, rather than silently expanding
scope).

Per the design spec, Stage 2 deliberately omits due-date/payment-plan/
minimum-payment-period language throughout (§11.2/§11.3's example screens
show it, but payment plans are Phase 2) — dashboards show current balance
and recent activity only.

### S2.1 — Household membership read access

**Load both Supabase skills before starting.**

**Scope:** Close the gap above. Either RLS policies directly on
`household_members`, or a `SECURITY DEFINER` function mirroring
`household_member_balances`'s shape (implementer's choice; state the
reasoning in the completion report, same as P1.2's guidance on RLS-vs-RPC) —
expose:
- The caller's own membership row (`id`, `household_id`, `role`, `name`,
  `status`) via `auth.uid()`, no parameter the caller could use to ask for
  someone else's.
- For a Parent, every `active` member's `id`/`name`/`role` in their own
  household (needed for the dashboard's child list); for a Child, no
  visibility into siblings' rows beyond what P1.2 already grants elsewhere
  (this task must not widen a Child's read access beyond their own row).

**Do not** add write access of any kind to `household_members` — this task
is read-only. Do not touch `ledger_transactions`/`categories`/`audit_log`
policies, already settled in P1.2.

**Files:** `supabase/migrations/<timestamp>_household_members_read_access.sql`.

**Acceptance criteria:**
- As a Child (`set local role`/equivalent), reading own membership returns
  exactly one row with correct `role`/`name`/`household_id`; reading a
  sibling's row, or a member row in another household, returns zero rows.
- As a Parent, reading household membership returns every `active` member
  of their own household (siblings included) and zero rows for any other
  household's members.
- An `archived` or `invited` member does not appear in a Parent's result
  set unless the implementer has a specific, stated reason to include them
  (default expectation: `active` only, matching `household_member_balances`).
- `anon` cannot call/select any of this (explicit revoke, per the
  established default-privileges pattern from P1.3/P1.4 — `revoke ... from
  public` alone is insufficient, name `anon` explicitly).
- `npx supabase db reset` applies cleanly; existing `npm run test:db` suite
  (54 assertions) stays green.

**Depends on:** P1.1–P1.5 (done).

**Verification tier:** floor/widen (`data_persistence_migrations`,
`rls_policy_or_security_definer_function_changes`) — goes through the
`verifier` agent.

### S2.2 — Session/role context, membership hook, and route guarding

**Scope:** Extend `src/features/auth/` with a hook/context that, once a
Supabase session exists, fetches the current user's household membership
via S2.1 and exposes `{ householdId, memberId, role, name }` (loading/error
states included — no offline queue, ADR-007: a failed fetch shows a clear
retry/error state, never a silent stale value). Use it in `RootLayout`/
`router.tsx` to redirect a Parent hitting `/child` to `/parent` and vice
versa (a Child should not casually land on the Parent dashboard route, but
per `CLAUDE.md`'s standing rule this redirect is a UX convenience only —
it is not a security control and must not be described as one anywhere in
code comments or the completion report; the real boundary is S2.1's RLS/
the RPCs' own server-side role checks). A signed-out visitor still reaches
`/sign-in` unimpeded.

**Files:** likely `src/features/auth/membership-context.ts` (or similar),
a provider wired into `src/app/providers.tsx`, and edits to
`src/app/router.tsx`/`RootLayout.tsx` for the redirect. Do not modify
`src/features/auth/SignInForm.tsx`'s actual sign-in logic.

**Acceptance criteria:**
- Signed in as a household's Parent, visiting `/child` redirects to
  `/parent`; signed in as a Child, visiting `/parent` redirects to
  `/child`. Visiting the matching route for the caller's own role does not
  redirect/loop.
- Signed out, `/parent` and `/child` do not crash — they behave reasonably
  (e.g. redirect to `/sign-in`; exact UX is the implementer's call, no
  existing pattern to match yet since this is the first route guard).
- A membership fetch failure (e.g. simulate by temporarily breaking the
  query) renders a visible retry/error state, not a blank page or an
  infinite loading spinner.
- `npm run typecheck` and `npm run lint` pass.

**Depends on:** S2.1.

**Verification tier:** default (spot-check) — no new RPC/policy.

### S2.3 — Parent dashboard: household overview

**Scope:** Replace `ParentDashboardPage`'s placeholder with a real
household overview per §11.3: each active child's name and current balance
(via `household_member_balances`, joined client-side with S2.2's household
member list for names), a way to drill into a child's ledger (link to
S2.7's history view — route it to `/child/:memberId/history` or similar;
implementer's call on the exact path, keep it consistent with S2.7), and
entry points for Add Expense (S2.5) and Record Payment (S2.6) — these can
be simple navigation links/buttons if S2.5/S2.6 aren't built yet in this
run; do not stub fake data. Omit due-date/payment-plan-status text per the
design spec's Stage 2 scope note above.

**Files:** `src/pages/ParentDashboardPage.tsx`, new files under
`src/features/ledger/` as needed (e.g. a `useHouseholdBalances` hook).

**Acceptance criteria:**
- Signed in as a Parent with active children in the household, the
  dashboard lists every active child's name and current balance, sourced
  from real Supabase queries (no mock data).
- A child with zero transactions shows a $0.00 balance, not blank/`NaN`/
  missing.
- Money is rendered via `formatCents` (`src/lib/currency.ts`) exclusively —
  no ad hoc `${cents / 100}` or similar float arithmetic anywhere in this
  task's diff.
- A loading state and an error/retry state are both visibly distinct from
  the loaded state.
- `npm run typecheck`, `npm run lint`, `npm run test` pass.

**Depends on:** S2.1, S2.2.

**Verification tier:** default (spot-check).

### S2.4 — Child dashboard: own balance and recent activity

**Scope:** Replace `ChildDashboardPage`'s placeholder per §11.2, scoped to
what Phase 1 actually has: current balance ("You Owe $X", via
`household_member_balances` filtered to self), a prominent Add Expense
action (link/button to S2.5), and a short recent-activity list (most
recent N `ledger_transactions` rows for self — a direct `select` is fine,
already covered by P1.2's Child-self RLS policy). Omit due date/minimum-
payment/payment-progress (Phase 2). Per §11.2's own guidance and the
design spec's resolved open question, do not show sibling data anywhere on
this screen.

**Files:** `src/pages/ChildDashboardPage.tsx`, reusing
`src/features/ledger/` hooks from S2.3 where the query shape overlaps
(e.g. a shared `formatCents`-based amount display component) rather than
duplicating them.

**Acceptance criteria:**
- Signed in as a Child, the dashboard shows their own current balance
  (real query, `formatCents`-rendered) and a recent-activity list of their
  own transactions only — never a sibling's or another household's.
- A Child with zero transactions sees a $0.00 balance and an empty-state
  message for recent activity, not an error.
- No control on this screen implies the Child can record a payment/
  adjustment/void (per §11.2's explicit requirement) — this is a UI
  omission, not a disabled button that a client-side toggle could re-enable.
- `npm run typecheck`, `npm run lint`, `npm run test` pass.

**Depends on:** S2.1, S2.2.

**Verification tier:** default (spot-check).

### S2.5 — Add Expense flow

**Scope:** A form (per §11.4's minimum fields: child, amount, category,
description/note, date defaulting to today) reachable from both dashboards,
calling `public.record_expense`. Amount entry uses `parseMoney`/
`parsePositiveMoney` from `src/lib/currency.ts` (never a raw
`parseFloat`/`Number()` on the typed string). The child selector: a Parent
always sees every active child; a Child sees themselves locked in when the
household's `child_expense_scope` is `'self_only'`, or a selector when it
is `'any_member'` — read the actual household setting rather than assuming
one, and remember the server still enforces this regardless of what the UI
shows or hides (a UI mistake here is a UX bug, not a security hole, but
still fix it if found). Category options come from `public.categories`
for the household (already Parent-write/household-read per P1.2 — this
task only reads them, doesn't add a management UI). On success, navigate
back to the relevant dashboard with the new balance visible; on failure
(constraint rejection, network error), show a clear retry/error message
naming what went wrong where feasible — never silently queue the write for
later (ADR-007).

**Files:** new files under `src/features/ledger/` (e.g. `AddExpenseForm.tsx`
and a route/page to host it), wiring from S2.3/S2.4's entry points.

**Acceptance criteria:**
- A Parent can record an expense for any active child; the household's
  balance for that child updates and is reflected on next dashboard load.
- A Child in an `'any_member'`-scoped household can record an expense for
  a sibling; the same Child in a `'self_only'`-scoped household cannot see
  a selector letting them pick a sibling (server-side rejection already
  covered by P1.3/P1.5 — this task is about the UI matching that reality,
  not re-proving the RPC's own enforcement).
- Amount parsing rejects malformed input (matching `parseMoney`'s
  documented error codes) with a message the user can act on, before any
  network call is made.
- A rejected write (e.g. simulate a negative amount bypassing client
  validation, or a network failure) shows a retry/error state, not a
  silent failure or a queued retry.
- `npm run typecheck`, `npm run lint`, `npm run test` pass.

**Depends on:** S2.1, S2.2, S2.3, S2.4 (needs both dashboards' entry
points to wire into).

**Verification tier:** default (spot-check) — calls an existing RPC, adds
no new one.

### S2.6 — Record Payment / Adjustment and Void flow

**Scope:** Parent-only. A Record Payment form (per §11.5: child, amount,
date, optional note/method) calling `public.record_payment`, whose
confirmation shows the resulting balance (no due-date/period language yet,
per the design spec's explicit Phase 1 carve-out of §11.5's due-date
mention). A minimal Adjustment entry point calling `public.record_adjustment`
can share the same form shape with a type toggle, since both are
Parent-only negative-amount actions with the same RPC signature —
implementer's call on whether to combine them into one screen or two;
state the choice in the completion report. Also: a Void action (reachable
from history — coordinate with S2.7 on exactly where the control lives)
calling `public.void_ledger_transaction` with a required, non-empty reason,
confirming before an irreversible-looking action, and rejecting an
already-voided transaction with the RPC's own error surfaced clearly.
Every one of these actions must be visually distinct from Add Expense per
§11.1's principle 5 (destructive/balance-decreasing actions look different
from ordinary expense entry) — not just present in a different location.

**Files:** new files under `src/features/ledger/` (e.g.
`RecordPaymentForm.tsx`, a void confirmation component), wired from the
Parent dashboard (S2.3) and history view (S2.7).

**Acceptance criteria:**
- A Parent can record a payment against any active child in their
  household; the child's balance decreases by exactly that amount and the
  confirmation shows the new balance.
- No control anywhere in this task's UI is reachable by a Child account
  (verify by checking the rendered DOM as a Child session, not just by
  the RPC rejecting it server-side).
- Voiding a transaction requires a non-empty reason before the action is
  submittable; voiding an already-voided transaction surfaces the RPC's
  rejection clearly rather than silently no-op'ing.
- Payment/adjustment/void controls are visually distinct (color, icon,
  placement — implementer's call) from the Add Expense entry point.
- `npm run typecheck`, `npm run lint`, `npm run test` pass.

**Depends on:** S2.1, S2.2, S2.3, S2.7 (void needs a place in history to
act from — implementer may build a minimal inline void trigger first and
integrate fully once S2.7 lands, if sequencing this after S2.7 is
inconvenient; state the actual approach taken).

**Verification tier:** default (spot-check) — calls existing RPCs, adds no
new one.

### S2.7 — History view

**Scope:** A ledger history view per §11.6: newest-first, clearly
distinguishing expense/payment/adjustment/voided entries, always showing
who created each entry and when, plus description/category. A Parent can
view any child's history (drill-in from S2.3's dashboard); a Child sees
only their own (already the only thing P1.2's RLS permits them to query).
Filtering by category/date/type is explicitly not required (per §11.6) —
do not build it. This is also where S2.6's void action is expected to live
(a void control per row, Parent-only, hidden entirely for a Child viewer).

**Files:** new files under `src/features/ledger/` (e.g. `HistoryPage.tsx`
or a shared list component used by both dashboards' "recent activity" and
this full view — reuse S2.4's recent-activity query shape rather than
duplicating it if the shapes genuinely match).

**Acceptance criteria:**
- History for a given member shows newest-first, every entry labeled with
  its type (expense/payment/adjustment), voided entries visually marked as
  voided (not hidden), and each row shows creator name and date.
- A Parent viewing a child's history sees that child's full history
  (including entries other household members created for them, e.g. a
  sibling recording an expense under `'any_member'` scope); a Child viewing
  their own history never sees a sibling's row mixed in.
- A voided transaction still appears (not deleted from the view) and is
  excluded from the balance shown elsewhere — no double-accounting bug
  where a voided row still visually reads as an active debit/credit without
  the voided marker.
- `npm run typecheck`, `npm run lint`, `npm run test` pass.

**Depends on:** S2.1, S2.2.

**Verification tier:** default (spot-check).

## After Stage 2 lands

Orchestrator confirms all of S2.1–S2.7 are done and verified (S2.1 via the
`verifier` agent, the rest spot-checked), updates `PROGRESS.md`, and — per
`.sdlc/project.yaml`'s `full` release mode — dispatches a `supervisor` agent
to merge `feature/phase-1-security-core-ledger` into `main` and push
(routine, standing-authorized once the whole phase's work is verified; not
the same as the separate, always-gated `main` → `production` promotion).
