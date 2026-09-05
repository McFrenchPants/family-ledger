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
| P1.5 | pgTAP privilege-escalation and integrity regression suite | done | Verifier: PASS on all 12 cases, all 3 mutation-proofing claims independently re-derived. **Stage 1 is gated-green.** |
| S2.1 | Household membership read access (RLS/RPC) | done | Verifier: PASS on all 5 criteria, independently re-derived. |
| S2.2 | Session/role context, membership hook, and route guarding | done | Spot-checked: typecheck/lint/test clean, redirect behavior verified live in-browser. |
| S2.3 | Parent dashboard: household overview | done | Spot-checked: typecheck/lint/test clean, verified live with real balances ($187.32/$63.81) and a $0.00 zero-transaction case. |
| S2.4 | Child dashboard: own balance and recent activity | done | Spot-checked: typecheck/lint/test clean, verified live including sibling-isolation and empty-state cases. |
| S2.5 | Add Expense flow | done | Uncovered a real gap (`households` had zero RLS policies) fixed via a verifier-routed migration; UI spot-checked after the fix landed. |
| S2.6 | Record Payment/Adjustment and Void flow | done | Spot-checked: typecheck/lint/test clean (185/185, 13 new), verified live including balance decrease, Child-inaccessibility, empty-reason blocking, and the already-voided race. |
| S2.7 | History view | done | Spot-checked: typecheck/lint/test clean (172/172, 5 new), verified live including sibling-attribution, RLS-blocked-vs-empty distinction, and a voided-entry render. |

## Session log

_Newest entries on top._

### 2026-09-05 — S2.6 done: Record Payment/Adjustment and Void flow (spot-checked); Stage 2 complete

Default verification tier — no new RLS/RPC. Spot-checked the diff directly
and re-ran `npm run typecheck`/`npm run lint`/`npm run test` myself
(185/185, 13 new, clean) rather than taking the implementer's report on
faith.

**What landed.** `/record-payment` registered in `router.tsx`. One combined
page, `RecordPaymentPage.tsx` (a Payment/Adjustment type toggle rather than
two screens, since `record_payment`/`record_adjustment` share one signature
and differ only in `type`): reuses `useAddExpenseFormData` for the active-
member list/categories/timezone, a new `record-transaction.ts` module
(`buildRecordMemberOptions` — Parent-only, no `child_expense_scope`
branching; `validateRecordForm` — Parent types a positive amount, the
function negates it before returning `amountCents` so no call site has to
remember the sign flip; `validateVoidReason`), and a post-submit
confirmation panel showing the resulting balance via a second
`household_member_balances` call. Not wrapped in `RequireRole` (that guard's
two-way redirect doesn't fit a route with no legitimate Child destination at
all) — instead renders an explicit "Parents only" message for a loaded Child
membership, confirmed to render zero form elements.

**Visual distinctness (§11.1 principle 5) achieved concretely, not just by
route:** Add Expense stays `bg-accent` blue; Record Payment/Adjustment uses
`bg-settled` green plus a type toggle and confirmation panel Add Expense has
neither of; Void (in History) uses an outlined `border-owed`/`bg-owed` red
control with its own inline reason-then-confirm step, distinct from both.

**Void wiring:** `HistoryPage.tsx`'s reserved per-row slot now renders
`VoidControl` only for `!transaction.isVoided && viewerRole === "parent"`.
Confirm is DOM-`disabled` until the reason is non-empty. `useHistory.ts`
gained a `refetch` on its `loaded` state (same `retryToken` bump as `retry`)
so a successful void reloads the row rather than patching local state
against a join this component has no independent copy of. An
already-voided rejection surfaces the RPC's own message verbatim.

Verified live against the local Docker Supabase stack with real seeded
Parent/Child accounts: a $4.99 payment against a child correctly dropped
their balance from $9.99 to $5.00 with the confirmation panel showing the
new balance; voiding that same transaction was blocked with an empty reason
(confirm button disabled) and succeeded with one, updating the row in place
to "Voided by Parent One" with the reason shown; voiding it again reproduced
the already-voided rejection (`23514`) surfaced verbatim; as a Child,
`/record-payment` rendered zero form elements and no History page rendered
any Void button anywhere in the DOM.

**Stage 2 (S2.1–S2.7) is now complete.** Per the design spec, next step is
confirming all seven tasks are genuinely done/verified and, per this
project's `full` release mode, dispatching a `supervisor` agent to merge
`feature/phase-1-security-core-ledger` into `main` and push (routine,
standing-authorized once the whole phase is verified — not the separate,
always-gated `main` → `production` promotion). **Deliberately not done in
this run** — the user asked to stop after this task while approaching a
usage limit. A future session should pick this up as the very next step.

### 2026-09-05 — S2.7 done: History view (spot-checked)

Picked up S2.7 out of order ahead of S2.6, since S2.6's own dependency list
names S2.7 (void needs a place in history to act from) and S2.7 only depended
on already-done S2.1/S2.2. New run, budget reset.

Default verification tier — no new RLS/RPC. Spot-checked the diff directly
and re-ran `npm run typecheck`/`npm run lint`/`npm run test` myself
(172/172, 5 new, clean) rather than taking the implementer's report on faith.

**What landed.** `/child/:memberId/history` registered in `router.tsx`
(previously fell through to `NotFoundPage`, per S2.3's note). A new sibling
module `history.ts` (deliberately not an extension of `recent-activity.ts`
— different consumer, would leak unused optional fields onto the Child
dashboard's row type) adds `HistoryTransactionRow`/`toHistoryTransactions`
covering `voided_at`/`void_reason` and two FK-disambiguated embeds
(`created_by_member`/`voided_by_member`, since `ledger_transactions` has two
FKs to `household_members`). `useHistory.ts` mirrors `useRecentActivity`'s
loading/error/loaded shape but deliberately has no `.limit()`. `HistoryPage.tsx`
handles `useMembership()` states directly (like `AddExpensePage`, since both
roles reach this route), renders newest-first with type label, date,
description/category, creator name, and — for a voided row — a strikethrough
amount, shaded row, "Voided by X" badge, and reason shown, not hidden. A
per-row action area is reserved (commented) for S2.6's void button.

**One real, accepted limitation surfaced and documented, not routed around:**
`created_by_member`/`voided_by_member` can legitimately come back `null` for
a Child viewer, because S2.1's `household_members` RLS only lets a Child read
their own row plus active siblings under `any_member` scope — a Parent's own
row is not necessarily readable by a Child. `toHistoryTransactions` falls back
to rendering `"someone"` rather than adding any elevated-privilege client-side
workaround.

Verified live against the local Docker Supabase stack with real seeded
Parent/Child users and real RPC-generated transactions (`record_expense`/
`record_payment`/`void_ledger_transaction`, never raw inserts): a Parent
viewing a child's full history including a sibling-attributed `any_member`
entry; a Child viewing their own equivalent history; a Child manually
navigating to a sibling's `memberId` who *does* have a transaction, confirming
RLS returns zero rows (rendered as "No history to show", not an error/crash) —
distinguishing "blocked" from "genuinely empty"; and a voided transaction
rendering with the strikethrough/badge/reason treatment rather than looking
like an active entry.

S2.6 (Record Payment/Adjustment/Void) is next — its only remaining
dependency (S2.7) is now satisfied.

### 2026-09-05 — S2.5 done: uncovered and closed a real RLS gap, then verified

While building the Add Expense form, the implementer found that
`public.households` has carried RLS enabled with **zero policies** since
Phase 0 — nobody could read `timezone` or `child_expense_scope`. Its first
pass worked around this with a browser-timezone fallback and a forced
`self_only` default. **Rejected that workaround outright**: a
browser-driven "today" directly violates `CLAUDE.md`'s standing rule that
dates use the household's configured IANA timezone, never the browser's.
Treated S2.5 as not-done and dispatched a fix instead of accepting it.

**The fix**, `supabase/migrations/20260905020000_household_settings_and_sibling_read_access.sql`
(+ 19 new pgTAP assertions, `supabase/tests/004_...sql`, suite now 73/73):
a `households_select_member` policy (any active member reads their own
household's row, reusing P1.2's `internal.is_household_member`), and a
third `household_members` policy,
`household_members_select_siblings_when_any_member`, letting a Child see
active siblings **only when** `child_expense_scope = 'any_member'` — in
`self_only` mode this grants nothing beyond S2.1's existing policies.
Verifier: **PASS** on all 7 criteria, independently re-derived, including
an independent mutation test proving the `any_member` gate is genuinely
load-bearing (removing it let a `self_only` Child incorrectly see 2 rows
instead of 1).

With the gap closed, `useAddExpenseFormData.ts` was updated to read the
real `timezone`/`child_expense_scope` — the browser-timezone fallback and
forced-`self_only` default are gone entirely; a missing/unreadable
household row is now a genuine, distinct error state instead of a silent
degraded default.

**The Add Expense form itself** (`AddExpensePage.tsx`, `add-expense.ts`):
child selector (Parent sees all active children; a Child is locked to
themselves in `self_only` mode, offered a real sibling selector in
`any_member` mode), amount via `parsePositiveMoney` (never `parseFloat`),
category dropdown, description/note/date fields, calling `record_expense`.
Rejected/failed writes show a retry-able error, never a silent queue
(ADR-007). Spot-checked directly (no new RLS in this half of the diff) —
typecheck/lint/test clean (167/167), and live-verified end to end: a
Parent recording for a child, and (after the fix) a Child recording
against a sibling via the newly-real selector, both with correct balance
updates observed on the relevant dashboards.

**This closes out this run's `max_tasks_per_run` budget of 5 (S2.1–S2.5).**
S2.6 (Record Payment/Adjustment/Void) and S2.7 (History) carry to a future
run.

### 2026-09-05 — S2.4 spot-checked (pass)

Default verification tier — no new RLS/RPC. Spot-checked the diff and
re-ran `npm run typecheck`/`npm run lint`/`npm run test` myself (152/152,
3 new, clean).

**What landed.** `ChildDashboardPage.tsx` rewritten: own balance via a new
`useOwnBalance` (single call to the existing `household_member_balances`
RPC, picking out the caller's own row rather than assuming `data[0]` —
deliberately not built on S2.3's `useHouseholdBalances`, which is
Parent-shaped and would pull in an unneeded `household_members` listing
read), a recent-activity list via `useRecentActivity` (a plain
`ledger_transactions` select relying entirely on P1.2's
`ledger_transactions_select_self` RLS policy for correctness — no new
authorization logic in the client), newest-first by `occurred_on` with
`created_at` as a same-day tiebreaker, limited to 8 rows. "+ Add Expense"
links to `/add-expense` (S2.3's established path). No control anywhere on
this screen implies the Child can record a payment/adjustment/void.

Verified live against the local Docker Supabase stack with the same seeded
Child One/Child Two fixtures S2.3 left behind: confirmed sibling isolation
(Child One's screen shows only their own transaction, never Child Two's),
a genuine $0.00/empty-state case for a zero-transaction Child, and a
network-log-confirmed single RPC + single scoped query per load.

Starting S2.5 (Add Expense flow) next — the last task this run's
`max_tasks_per_run` budget of 5 covers (S2.1–S2.5). S2.6/S2.7 (Record
Payment/Adjustment/Void, History) carry to a future run.

### 2026-09-05 — S2.3 spot-checked (pass)

Default verification tier — no new RLS/RPC. Spot-checked the diff and
re-ran `npm run typecheck`/`npm run lint`/`npm run test` myself (149/149,
3 new, clean).

**What landed.** `ParentDashboardPage.tsx` rewritten to a real household
overview: `useHouseholdBalances` (new, `src/features/ledger/`) issues two
parallel reads — `household_members` filtered to active members of the
household (S2.1's Parent-listing RLS policy) and the
`household_member_balances` RPC — joined client-side by
`joinChildBalances` (`household-balances.ts`, unit-tested), which
deliberately excludes Parent rows and defaults a missing balance to 0. Money
rendered via `formatCents` exclusively. Loading/error(+retry)/loaded states
distinct.

Verified live against the local Docker Supabase stack with real seeded
data pushed through the actual `record_expense`/`record_payment` RPCs (not
raw inserts): correct per-child balances, a genuine $0.00 case for a
zero-transaction member, and a simulated RPC-permission failure producing a
visible error+retry that recovered on click.

**Placeholder routes established for later tasks to stay consistent with:**
child history drill-in `/child/:memberId/history` (not yet built — falls
through to `NotFoundPage`), Add Expense `/add-expense`, Record Payment
`/record-payment`. S2.5/S2.6/S2.7 should target these exact paths rather
than inventing new ones.

Starting S2.4 (Child dashboard) next.

### 2026-09-05 — S2.2 spot-checked (pass)

Default verification tier — no new RLS/RPC. Spot-checked the diff directly
and re-ran `npm run typecheck`/`npm run lint`/`npm run test` myself
(146/146, clean) rather than taking the implementer's report on faith.

**What landed.** `src/features/auth/membership-context.ts` (a
`MembershipState` discriminated union: `signed-out` / `loading` /
`no-membership` / `error` / `loaded`, plus `useMembership()`),
`MembershipProvider.tsx` (queries the caller's own `household_members` row
via S2.1's RLS policy, explicitly filtered to `user_id = auth.uid()` — the
implementer caught and fixed a real bug here: an *unfiltered* select for a
Parent returns multiple rows under S2.1's second policy, which the task
prompt's suggested `select('*')` shortcut would have broken on), and
`RequireRole.tsx` (route guard consuming it). Wired into
`app/providers.tsx` and `app/router.tsx`.

Verified live in a real browser against the local Supabase stack with real
seeded Parent/Child test users: Parent visiting `/child` redirects to
`/parent` and vice versa, neither role loops on its own route, signed-out
redirects to `/sign-in`, and a simulated fetch failure (temporarily querying
a nonexistent table) rendered a visible retry/error state that recovered
once reverted. Every redirect-as-UX-not-security-control point from the
task prompt is stated explicitly in the new code's comments.

Starting S2.3 (Parent dashboard: household overview) next.

### 2026-09-05 — S2.1 verified (pass)

Verifier returned **pass** on all five acceptance criteria, all
independently re-derived against the live local database (role-switched
fixtures, not taken on the implementer's report), plus a clean forbidden-
path check and a pass on every relevant architectural invariant.

**What landed.** One migration,
`supabase/migrations/20260905013000_household_members_read_access.sql`,
adding two SELECT policies on `household_members` (RLS policies chosen over
a new `SECURITY DEFINER` function — reasoned in-file: unlike
`household_member_balances`, this is a plain row filter, not a
"manufacture a 0-row for a member with no matches" case): `..._select_self`
(own row, unconditional on status, `to authenticated`) and
`..._select_parent_active_members` (every `active` member of a household
the caller parents, reusing P1.2's `internal.is_household_parent` helper).
`invited`/`archived` siblings are excluded from a Parent's listing by
design, matching `household_member_balances`'s own filter. No new grants —
`anon` is blocked by both policies being scoped `to authenticated` plus
RLS default-deny, independently confirmed operationally (not just by
reading the policy).

Verifier's one non-blocking observation: table-level grants for
`anon`/`authenticated` are left at Supabase's broad defaults here (same
precedent as `categories`/`ledger_transactions` in P1.2), rather than the
stricter belt-and-suspenders revoke `audit_log` got — worth considering if
a future task wants to standardize the stricter pattern everywhere, not a
defect in this task.

Starting S2.2 (session/role context and route guarding) next.

### 2026-09-05 — Stage 2 planned

Confirmed Stage 1 is genuinely gated-green (all five tasks verifier-passed,
P1.5's 35-assertion privilege-escalation suite green and mutation-proofed)
before writing anything further, per the design spec's gate.

Broke Stage 2 into seven tasks (S2.1–S2.7), appended to
`IMPLEMENTATION_PLAN.md`. The one thing worth flagging: `household_members`
itself still has zero RLS policies (a Phase 0 default-deny carried through
all of Stage 1, each task routing around it narrowly for its own purpose —
P1.2's three `internal.*` helpers, P1.4's `household_member_balances`).
None of those expose what the UI now actually needs — the current user's
own membership row, and a Parent's list of child names — so S2.1 closes
that gap first; every other Stage 2 task depends on it. S2.1 is the only
Stage 2 task in the verifier-routed tier (RLS/data-persistence); S2.2–S2.7
call only existing, already-verified RPCs and are spot-checked normally,
per the design spec's explicit carve-out.

This run's `max_tasks_per_run` budget (5) will cover S2.1–S2.5; S2.6/S2.7
carry to a future run. Starting S2.1 next.

### 2026-09-05 — P1.5 verified (pass); Stage 1 complete and gated-green

Verifier returned **pass** on all 12 required cases, and — since this task
gates the entire next stage — was explicitly asked to independently
re-derive all three mutation-proofing claims rather than trust the
implementer's reported numbers. It did: dropping
`ledger_transactions_amount_sign_check` flipped exactly 2/35 assertions
red; dropping the `ledger_transactions_select_self` RLS policy flipped
exactly 1/35 (the Case 8 positive control, proving that case isn't a
false-negative "everyone sees nothing" scenario); disabling the Parent-only
check in `internal.record_balance_decrease` flipped exactly 7/35. All three
restored, full suite re-confirmed green afterward.

**What landed.** One new file,
`supabase/tests/003_ledger_privilege_escalation.sql` — 35 pgTAP assertions
covering every negative case from the design spec (Child attempting
payment/adjustment/void/negative-expense/direct-UPDATE-DELETE/cross-household-
read/sibling-read/audit_log-write, the `child_expense_scope` toggle actually
changing behavior in both directions, a raw-table bypass hitting the CHECK
constraint as backstop) plus the positive Parent-success path and
structural RLS/policy assertions. `npm run test:db` now runs 54 assertions
total across all three files (19 from Phase 0, unmodified; 35 new), all
green from a clean `npx supabase db reset`.

**Stage 1 (the DB/authorization layer) is done.** Every one of P1.1–P1.5 is
verifier-passed, and the Child privilege-escalation suite — the specific
gate this project's standing rules require before proceeding to
convenience/UI features — is genuinely green, independently confirmed
twice now (implementer's report, then the verifier's own re-derivation).

**Next step, in a future session:** append Stage 2's task breakdown
(Parent/Child dashboards, Add Expense, Record Payment, History) to
`IMPLEMENTATION_PLAN.md`, per the design spec. This run has used its full
`max_tasks_per_run` budget of 5 (P1.1–P1.5), so Stage 2 planning and
delegation starts fresh next time.

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
