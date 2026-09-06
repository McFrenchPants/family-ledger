# Progress: Phase 6 — Categories & quick-add presets

Branch: `feature/phase-6-categories-presets` (off `main`).

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
| C1 | Category management UI | done | Spot-checked (default tier). Commit `e0bc22d`. |
| C2 | `expense_presets` schema + RLS migration | done | **Verifier-agent tier** — pass on all criteria. Commit `dfcb349`. |
| C3 | Preset management UI | done | Spot-checked (default tier). Commit `bb1dda3`. |
| C4 | Quick-add presets on `AddExpensePage` | done | Spot-checked (default tier). Commit `a835be3`. **Slice complete.** |

## Session log

_Newest entries on top._

### 2026-09-06 — C4 done: quick-add presets on `AddExpensePage`. **Categories/presets slice complete.**

Default tier, spot-checked against all 5 acceptance criteria: new
`useExpensePresets` read hook (mirrors `useHouseholdCategories`'s
active-only, `sort_order`-ordered shape — deliberately not
`useManagePresets`, which is shaped for Parent management and returns
inactive rows too). Preset buttons render above the form only when at
least one active preset exists; clicking one prefills amount (via
`toDecimalString`, the same conversion `ManagePresetsPage.tsx` uses),
category, and description without submitting — every field stays
editable afterward, matching `PROJECT_REQUIREMENTS.md` §8 verbatim. A
zero-preset household regresses nothing (no placeholder rendered).
`AddExpensePage` is reachable by both Parent and Child (unguarded route),
so presets are available to either. New `AddExpensePage.test.tsx` (none
existed before) covers rendering, prefill-without-submit, post-prefill
editability, and the zero-preset case. `npm run typecheck`/`lint`/`test`
all clean (263/263 tests). Commit `a835be3`.

All four tasks done. Ready for the routine feature→`main` merge (per
`full` release mode — supervisor role, standing-authorized, no fresh
approval needed for this feature→integration merge).

### 2026-09-06 — C3 done: preset management UI

Default tier, spot-checked against all 5 acceptance criteria: new
`/parent/presets` page + `useManagePresets` hook (mirrors
`useManageCategories`'s shape, resolves category name via an embedded
`categories(name)` select, same convention `useHistory`/`useLedgerExport`
already use). Add/edit both reuse `AddExpensePage`'s decimal-safe
`parsePositiveMoney`/`toDecimalString` helpers and `HistoryPage`'s
`formatCents` for display — no second money-parsing path. Deactivate/
reactivate is soft (`active` toggle), matching C1's precedent exactly. No
migration or RLS touched; relies on `expense_presets`' existing
Parent-only policies from C2. `npm run typecheck`/`lint`/`test` all clean
(259/259 tests, 5 new in `ManagePresetsPage.test.tsx`). Commit `bb1dda3`.

### 2026-09-06 — C2 done: `expense_presets` schema + RLS migration. Verifier-agent pass.

New `public.expense_presets` table mirroring `categories`' shape exactly
(same `internal.is_household_member`/`internal.is_household_parent`
gating, composite FK to `categories(id, household_id)` copying
`ledger_transactions`' pattern). Mutation-proofed pgTAP suite
(`supabase/tests/008_expense_presets_privilege_escalation.sql`, 10
assertions) covers Parent CRUD, Child privilege-escalation negatives, and
cross-household FK rejection — uses `to_regclass()`, not the unsafe
`::regclass` (the documented T7 failure mode). Routed through the verifier
agent per this project's floor/widen tiers (new migration + new RLS): pass
on every acceptance criterion, forbidden-path compliance (only
`supabase/migrations/` and `supabase/tests/` touched), and standing
architectural invariants. The one judgment call — whether preset writes
need an `audit_log` row — resolved as no, consistent with `categories`'
own precedent (audit rows are reserved for the balance-affecting RPCs;
presets don't touch the ledger, a preset only prefills a form that still
goes through the existing `record_expense` RPC). `npx supabase db reset`
and `npm run test:db` (169/169) both independently re-run and confirmed
by the verifier, not just trusted from the implementer's report. Commit
`dfcb349`.

### 2026-09-06 — C1 done: category management UI

Default tier, spot-checked against all 7 acceptance criteria: new
`/parent/categories` page + `useManageCategories` hook (mirrors
`useHouseholdMembers`'s `{status, refetch/retry}` shape), add (name
required/trimmed, optional integer `sort_order` omitted from the insert
when blank), rename, and deactivate/reactivate (soft, via `active`
toggle — no hard delete). No migration or RLS touched; all mutations rely
on categories' existing Parent-only policies as-is. Dashboard link added
for discoverability, consistent with `ManageMembersPage`/`ExportPage`.
`npm run typecheck`/`lint`/`test` all clean (254/254 tests, including 5 new
ones in `ManageCategoriesPage.test.tsx` — component-test tooling for pages
now exists per item 9, so this got real jsdom/RTL coverage rather than
static-only review). Commit `e0bc22d`.

### 2026-09-06 — Slice scaffolded

Picked as the next Phase 6 sub-piece per the user's 2026-09-06 choice among
the four remaining `idea`-equivalent items (categories/presets,
notification preferences, transaction filtering [now done/merged],
accessibility review). No design spec: scope fully determined by
`PROJECT_REQUIREMENTS.md` §8/§18, the already-existing `categories`
table/RLS, and the member-management slice's established CRUD-page
convention. Research pass (background subagent) confirmed: `categories` is
schema/RLS-ready for Parent CRUD today (just no UI); `expense_presets` does
not exist anywhere yet and needs a from-scratch migration. See
`IMPLEMENTATION_PLAN.md` for full acceptance criteria and the verification-
tier reasoning (C2 is the one task in this slice requiring the `verifier`
agent, per new migration + new RLS policies).
