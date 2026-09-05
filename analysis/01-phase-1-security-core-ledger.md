# Analysis — Phase 1: Security and core ledger

Status: **finalized** — sequencing and open questions confirmed with the user
on 2026-09-04 (see `PROGRESS.md` session log).

## What it solves

Phase 0 built an empty shell: an app skeleton and an auth proof-of-concept
with no application data model at all. Nothing in the product exists yet —
there is no household, no ledger, no way to record who owes what. Phase 1 is
not an incremental feature; it is the first slice that makes this an actual
ledger application, and every later phase (payment plans, PWA, push,
polish) is additive on top of it. `PROJECT_REQUIREMENTS.md` §19 and
`ARCHITECTURE.md` §29 both name it as the mandatory second phase, and nothing
in either document suggests an alternate order.

## Is it worth the cost, and is there a simpler path?

Yes, and no simpler path reaches the same goal. The one property this whole
project is designed around — *the browser is untrusted; a Child must never
be able to reduce a balance, enforced by Postgres RLS/constraints/security-
definer functions, never by React conditionals* — cannot be partially
implemented or deferred. There is no cheaper version of "add expense/record
payment with real authorization" that isn't also just... Phase 1. Skipping
or shrinking the RLS/security-testing part of it would produce a UI-only
toy that fails the project's own stated acceptance criteria (§20 items 3–6).

The one real scoping question is not *whether* to do Phase 1, but *how to
sequence it internally* — see below.

## Scope as specified

Directly from `ARCHITECTURE.md` §29 / `PROJECT_REQUIREMENTS.md` §19:

- Household/member model (`households`, `household_members`).
- `ledger_transactions` (expense/payment, append-only, void workflow).
- `audit_log`, `categories` (categories are listed in the data model here;
  presets/quick-add stay Phase 4 per the backlog's own item 8.7 vs 8.8
  split — presets are explicitly a Phase 4/administration concern).
- RLS policies + Parent/Child role enforcement, including the negative
  privilege-escalation tests named as the phase's hard gate.
- Balance calculation (derived, not stored).
- Add Expense flow, Record Payment flow (Parent-only), History view.
- Parent dashboard, Child dashboard (per §11.2/§11.3).

Deliberately **not** in this phase (confirmed against the backlog's own
phase split): payment plans/periods (`Phase 2`), expense presets and CSV/JSON
export (`Phase 4`), PWA/push (`Phase 3`/`4`).

## Sequencing recommendation

This phase is large enough, and touches enough floor-tier categories
(`authentication_authorization`, `data_persistence_migrations`, plus this
project's own widened `monetary_amount_or_balance_logic` and
`rls_policy_or_security_definer_function_changes`), that I'd recommend
treating it as the "significant" tier — a real design spec with a human
sign-off gate, not a flat task list — and splitting the implementation plan
into two sequential stages within the one proposal folder/branch:

1. **Data + authorization layer**: migrations for the four tables, RLS
   policies, security-definer functions/RPCs for expense/payment inserts
   and the void workflow, the balance-derivation view/RPC, audit-log
   triggers, and the pgTAP negative-test suite (Child attempts a payment,
   a negative amount, a downward edit, a void, cross-household access, a
   role change). Every task in this stage is verifier-routed — it is
   exactly the floor/widen tier the framework describes.
2. **UI layer**: Parent dashboard, Child dashboard, Add Expense flow,
   Record Payment flow, History view — built against the now-tested
   authorization layer.

Stage 1 must be entirely green (the Child privilege-escalation suite
passing) before any Stage 2 task starts, matching the phase's own stated
gate ("do not proceed to convenience features until Child
privilege-escalation tests pass") applied at the intra-phase level, not
just the inter-phase level.

## Open questions — resolved with the user (2026-09-04)

- **Void workflow**: status-flip on the original row (`voided_at`/
  `voided_by`/`void_reason`), matching `ARCHITECTURE.md` §8.3's sketch. A
  voided transaction stays visible in history but is excluded from the
  balance sum; corrections are a new entry, not an edit of the old one.
- **Transaction types**: three types in Phase 1 — `expense`, `payment`, and
  `adjustment` (Parent-only, for write-offs/manual corrections that aren't
  a normal expense or payment) — not just the two named in
  `PROJECT_REQUIREMENTS.md` §6.2. `adjustment` follows the same
  balance-decrease-is-Parent-only rule as `payment`.
- **Household expense policy toggle**: built into the schema now as a
  `households`-level setting (default: permissive — any member may expense
  any child), enforced by RLS/the insert RPC from Phase 1 on. Only the
  settings *UI* to flip it is deferred to Phase 4; the underlying switch and
  its enforcement ship now.

## Recommendation

Proceed with Phase 1, scoped as above, with the two-stage sequencing
(DB/RLS/security-tests, then UI) and the three resolved decisions above.
Ready to move to the design spec.
