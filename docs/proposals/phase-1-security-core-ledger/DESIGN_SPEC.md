# Design Spec — Phase 1: Security and core ledger

Status: **draft, pending human sign-off**. Backing analysis:
`analysis/01-phase-1-security-core-ledger.md`. Branch:
`feature/phase-1-security-core-ledger`.

This is a goals/requirements/constraints document. It intentionally does
not name files, tables' exact columns, function signatures, or component
names — that belongs in the implementation plan, written after this is
signed off.

## Goals

- Give the application its first real data: households, members with
  Parent/Child roles, and a ledger that records expenses and payments.
- Make the core authorization invariant real, not aspirational: a Child can
  never reduce a balance, through any path — UI, direct API call, modified
  request, or a manipulated anon-key request — because Postgres itself
  refuses it, not because the React app declines to render a button.
- Let a Parent and a Child each sign in and see a dashboard reflecting only
  their own authorized view of the household's ledger.
- Let a Parent add an expense, record a payment, and correct a mistake
  through an explicit void, with every one of those actions attributable in
  an audit trail a normal user cannot edit.
- Establish the pgTAP regression suite that proves the above — especially
  every negative case where a Child *attempts* something forbidden — so
  this invariant stays provably true as the schema evolves in later phases.

## Non-goals (explicitly deferred)

- Payment plans, payment periods, due/overdue/satisfied status (Phase 2).
- Categories' quick-add presets, CSV/JSON export, member-management UI,
  notification preferences (Phase 4).
- Any push/notification machinery (Phase 3/4).
- A settings *screen* for the household expense-policy toggle — the
  underlying switch and its enforcement ship now (see Decisions), but no UI
  to flip it yet.
- Payment-to-specific-expense allocation (`payment_allocations`) — out of
  scope for the whole project unless a real need emerges later.

## Users and roles in scope

Matches `PROJECT_REQUIREMENTS.md` §4 exactly for the parts Phase 1 touches:
Parents can read all household ledger data, insert expenses, insert
payments, insert adjustments, and void/correct transactions. Children can
read only their own ledger and insert expenses (subject to the household's
expense policy setting), and can never insert a payment, an adjustment, a
negative amount, a downward edit, or a void.

## Decisions carried in from the analysis check-in

These were resolved with the user on 2026-09-04 and are binding for the
implementation plan:

1. **Void model**: a status-flip on the original transaction
   (voided/voided-by/void-reason, in whatever the implementation plan's
   exact column names turn out to be). A voided transaction is excluded
   from the balance sum but remains visible in history and audit data.
   Corrections are made by voiding the wrong entry and adding a new,
   correct one — never by editing an existing amount.
2. **Transaction types**: three, not two — `expense`, `payment`, and
   `adjustment`. `expense` increases a balance and may be inserted by a
   Child (subject to the policy setting) or a Parent. `payment` and
   `adjustment` both decrease a balance and are Parent-only. The database
   must enforce the sign/type combination and the role restriction; it must
   not rely on the client sending a well-formed request.
3. **Household expense-policy toggle**: a per-household setting,
   defaulting to the permissive behavior (any household member may create
   an expense for any child), enforced by the authorization layer from day
   one. Only the settings UI to change it is deferred; a household stuck
   on the default is a real, supported, permanent configuration, not a
   placeholder.

## Requirements

### Data and integrity

- Every household's data is isolated from every other household's, at the
  database level, not just by the application never constructing a
  cross-household query.
- Money is integer cents throughout — no floating point in storage,
  calculation, or transit.
- Balances are derived (summed from non-voided transactions) at read time
  or via a maintained view/RPC — never a mutable stored balance column.
- Every transaction records who created it and when, and (if voided) who
  voided it, when, and why.
- Every security-sensitive or balance-affecting action produces an
  append-only audit row that ordinary application roles cannot edit or
  delete.
- Deleting or archiving a household member must not cause their historical
  ledger entries to lose attribution.

### Authorization

- All of the above is enforced by Row Level Security, database constraints,
  and/or security-definer functions — the browser and its anon key are
  always untrusted.
- A Child attempting any of the following must fail at the database, not
  merely be hidden by the UI: recording a payment or adjustment, inserting
  a negative-amount or wrong-sign expense, editing an existing transaction
  amount, voiding a transaction, changing a payment-plan-adjacent setting
  (n/a yet, but the pattern must generalize), changing their own or
  another member's role, or reading another household's data.
- Every one of those negative cases gets an automated, mutation-proofed
  test (per `CLAUDE.md`'s testing section) — a test that cannot pass
  against a broken/missing policy.

### User experience

- A Parent signing in sees a household-level dashboard: every child's name,
  current balance, and a way to drill into that child's ledger (§11.3).
- A Child signing in sees only their own balance and history, with a
  prominent Add Expense action and no control that implies they could
  record a repayment (§11.2).
- Add Expense is optimized for a fast phone interaction: amount, category,
  description, date (defaulting to today), and — subject to the household
  policy — a child selector.
- Record Payment is a distinct, Parent-only flow whose confirmation shows
  both the resulting balance and (in Phase 1, since payment plans don't
  exist yet) simply the new balance — no due-date/period language until
  Phase 2 adds that model.
- History shows newest-first, clearly distinguishes expense/payment/
  adjustment/voided entries, and always shows who created each entry and
  when.
- Destructive/balance-decreasing actions are visually distinct from
  ordinary expense entry, per §11.1's UX principles.

### Verification

- This phase's DB/RLS/security-definer-function work is entirely within the
  framework's floor + widened verifier-routing tiers
  (`authentication_authorization`, `data_persistence_migrations`,
  `monetary_amount_or_balance_logic`,
  `rls_policy_or_security_definer_function_changes`, `audit_log_integrity`)
  — every task in Stage 1 (see the analysis's sequencing recommendation)
  goes through the `verifier` agent, not just a spot-check.
- Stage 2 (UI) tasks are verified normally unless a specific task also
  touches one of those tiers (e.g. a UI action that calls a new
  security-definer RPC).
- The phase is not complete — and Stage 2 must not start — until the full
  Child privilege-escalation pgTAP suite is green.

## Constraints

- Everything from `CLAUDE.md`'s standing rules applies unchanged: integer
  cents, append-only ledger, no offline write queue, no service-role key or
  VAPID key in the browser, versioned migrations only, household time zone
  for date logic (Phase 1 doesn't yet have due-date logic, but
  `households.timezone` should exist from the schema Phase 0 already
  established use of, if any — verify during the implementation plan).
- No new paid services, caching layers, or infrastructure beyond what's
  already provisioned (Supabase Free, Cloudflare Pages).
- Categories (§8) are in scope as a simple lookup table since expenses need
  to reference one; expense *presets* are not.

## Open questions for the implementation plan (not blocking sign-off)

- Exact due-date/timezone column shape for `households` — Phase 0 may or
  may not have already created this table; the implementation plan should
  check the current schema before assuming.
- Exact shape of the "read shared household information specifically
  required by the UX" a Child needs beyond their own ledger (e.g. do they
  see sibling names on a shared view anywhere in Phase 1, or is that purely
  a Parent-dashboard concern until later) — resolve by re-reading §11.2's
  example screen, which shows no sibling data.

## Sign-off

Awaiting explicit user approval before the implementation plan is written.
