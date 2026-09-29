# Implementation Plan: Phase 6 — Categories & quick-add presets

Scope for this slice: let a Parent manage expense categories (currently
seed-only, no UI) and configurable quick-add presets (e.g. `+$20 Gas`) that
prefill — but don't auto-submit — the Add Expense form. See `BACKLOG.md`
item 7 — one of the four remaining Phase 6 sub-pieces, picked up per the
user's 2026-09-06 choice. No design spec: scope is fully determined by
`PROJECT_REQUIREMENTS.md` §8/§18 and the existing `categories`
table/RLS/member-management CRUD pattern — see the research note below.

## Background for all tasks

- **`categories` already exists and is already Parent-write-enforced by
  RLS**, just with no UI yet. Schema:
  `supabase/migrations/20260904223000_ledger_schema.sql:17-39`
  (`id`, `household_id`, `name`, `sort_order integer` nullable no default,
  `active boolean not null default true`, composite unique
  `(id, household_id)`). RLS:
  `supabase/migrations/20260904230000_ledger_rls_policies.sql:138-164` —
  `categories_select_household_members` (any member, SELECT),
  `categories_insert_parent_only` / `_update_parent_only` /
  `_delete_parent_only`, all gated on `internal.is_household_parent(household_id)`.
  **No RLS changes needed for category management** — C1 below is a pure UI
  task consuming already-correct server-side authorization.
- **`expense_presets` does not exist yet** — it's documented as a future
  table in `docs/ARCHITECTURE.md` §8.8 but has no migration. C2 creates it
  from scratch: schema + RLS in one migration, following the same
  composite-FK-to-`(id, household_id)` pattern `ledger_transactions` uses
  against `categories` (`supabase/migrations/20260904223000_ledger_schema.sql:115-125`)
  so a preset's `category_id` (if set) is guaranteed to belong to the same
  household. RLS mirrors categories' shape exactly: household-wide SELECT,
  Parent-only INSERT/UPDATE/DELETE via `internal.is_household_parent`.
  **This is the one task in this slice that touches
  `.sdlc/project.yaml`'s floor/widen verification tiers** (new migration +
  new RLS policies) — route through the `verifier` agent, not a spot-check
  (see "Verification tier" below).
- **Deletion is soft, not hard**, for both categories and presets — use the
  existing `active` boolean (`update ... set active = false`), never a SQL
  `DELETE`. This matches the schema's own `active` column design and avoids
  breaking any historical `ledger_transactions.category_id` references to a
  "deleted" category. The RLS `_delete_parent_only` policies exist for
  completeness/defense-in-depth per the schema author's original intent,
  not because the UI is expected to issue real deletes — the Parent-facing
  UI action is "deactivate", not "delete".
- **CRUD-page convention to follow** (established by the merged
  member-management slice): `src/pages/ManageMembersPage.tsx` +
  `src/features/members/useHouseholdMembers.ts`. Outer page component reads
  `useMembership()`, is route-gated by `RequireRole role="parent"`
  (`src/app/router.tsx` — convenience only, RLS re-enforces server-side,
  per `ManageMembersPage.tsx:15-24`'s own doc comment and `CLAUDE.md`'s
  "browser is untrusted" rule), passes `householdId` down. A state hook
  returns `{status: "loading" | "error" | "loaded", ...}` with a
  `retry`/`refetch`, fetching via plain `supabase.from(...)` calls (no new
  abstraction). Page composes a list + an add-form, calling `.refetch()`
  after a successful mutation. Follow this shape for both new pages/hooks
  in this slice — don't invent a different pattern.
- **Existing read-only categories hook**:
  `src/features/ledger/useHouseholdCategories.ts` (active-only,
  `sort_order`-ordered) is used by `AddExpensePage`/`useAddExpenseFormData`
  and by the transaction-filtering slice. Reuse it for read paths where
  possible; C1's management hook is a separate Parent-facing CRUD hook
  (needs to see inactive rows too, for a re-activate action), not a
  replacement for it.
- **UI convention**: plain Tailwind-styled native `<select>`/`<input>`
  elements throughout this codebase — no Radix `Select`. Match
  `AddExpensePage.tsx`'s existing control styling
  (`min-h-touch rounded-card border border-surface-border px-3 text-body`).
- **Money**: preset `amount_cents` is `bigint`/integer cents, parsed with
  the same decimal-safe input parsing `AddExpensePage.tsx` already uses for
  its amount field — do not introduce a second amount-parsing path.

## Tasks

| ID | Task | Depends on | Verification tier |
| --- | --- | --- | --- |
| C1 | Category management UI (Parent add/rename/deactivate/reactivate) | none | default |
| C2 | `expense_presets` schema + RLS migration | none | **verifier** (new migration + RLS) |
| C3 | Preset management UI (Parent add/edit/deactivate/reactivate) | C2 | default |
| C4 | Quick-add presets on `AddExpensePage` (buttons prefill, remain editable) | C2, C3 | default |

C1 and C2 have no dependency on each other and may be delegated together as
an independent batch.

### C1 — Category management UI

**Acceptance criteria:**
1. A new Parent-only page (e.g. `src/pages/ManageCategoriesPage.tsx`, route
   e.g. `/parent/categories`, gated by the existing `RequireRole
   role="parent"` pattern) lists the household's categories — both active
   and inactive — ordered by `sort_order` (nulls last), showing name and
   active/inactive state.
2. A Parent can add a new category (name required, non-empty after trim;
   `sort_order` optional — omit if not provided, matching the column's
   nullable-no-default shape).
3. A Parent can rename an existing category (`update ... set name = ...`).
4. A Parent can deactivate an active category and reactivate an inactive
   one (`update ... set active = ...`) — no hard delete from the UI.
5. All mutations use the existing Parent-only RLS policies as-is (no new
   migration for this task) — a Child attempting any of these calls (e.g.
   via direct PostgREST) is already rejected by
   `categories_insert_parent_only`/`_update_parent_only`; this task doesn't
   need to re-prove that (C2's migration is where new RLS gets tested), but
   should not regress it either.
6. New/renamed/deactivated categories are reflected wherever
   `useHouseholdCategories` is already consumed (`AddExpensePage`,
   `HistoryPage`'s filter) after a refetch — no separate propagation
   mechanism needed, since those call sites already re-query on mount/filter
   change.
7. `npm run typecheck`, `npm run lint`, and `npm run test` all pass.

### C2 — `expense_presets` schema + RLS migration

**Acceptance criteria:**
1. New migration file
   `supabase/migrations/<timestamp>_expense_presets.sql` (timestamp after
   the latest existing migration, `20260905080000_add_household_member_function.sql`)
   creates `public.expense_presets`: `id uuid primary key default
   gen_random_uuid()`, `household_id uuid not null references
   public.households(id) on delete cascade`, `label text not null`,
   `amount_cents bigint not null` (positive-only via a check constraint —
   presets are always additions to an expense, never negative), `category_id
   uuid` (nullable — a preset need not specify a category), `description
   text` (nullable, prefill text for the expense description field),
   `sort_order integer`, `active boolean not null default true`.
2. Composite FK `(category_id, household_id) references
   public.categories (id, household_id)` mirroring
   `ledger_transactions`'s existing pattern
   (`20260904223000_ledger_schema.sql:115-125`) — default `MATCH SIMPLE` so
   a `NULL category_id` is exempt, exactly as documented there.
3. Index on `household_id` (mirroring `categories_household_id_idx`).
4. RLS enabled; policies mirror categories' shape exactly:
   `expense_presets_select_household_members` (any household member,
   SELECT, scoped by household membership same as
   `categories_select_household_members`),
   `expense_presets_insert_parent_only` / `_update_parent_only` /
   `_delete_parent_only` (all via `internal.is_household_parent(household_id)`,
   same function categories already uses — do not write a new authorization
   function).
5. Migration applies cleanly via `npx supabase db reset` against local
   Docker.
6. New pgTAP test file under `supabase/tests/` (mirroring the existing
   pattern for `categories`' RLS tests, if one exists — check
   `supabase/tests/*.sql` for the categories/RLS test file to follow as a
   template) covers: a Parent can insert/update/deactivate a preset; a
   Child cannot (negative test, `set local role` per this project's pgTAP
   convention); a preset's `category_id` must belong to the same household
   as its `household_id` (FK rejects a cross-household reference).
   Mutation-proof this suite per `CLAUDE.md`'s standing rule — drop the
   constraint/policy under test, confirm the suite goes red, restore it.
7. `npm run test:db` passes locally (needs Docker).

### C3 — Preset management UI

**Acceptance criteria:**
1. A new Parent-only page or a section added to `ManageCategoriesPage`
   (implementer's call, but keep it discoverable — either a tab/section on
   the same page or a clearly-linked separate page under `/parent/presets`)
   lists the household's presets — active and inactive — ordered by
   `sort_order`, showing label, formatted amount (`Intl.NumberFormat`, per
   `CLAUDE.md`'s money-formatting rule), category name (or "no category"),
   and active state.
2. A Parent can add a new preset: label (required), amount (required,
   parsed with the same decimal-safe helper `AddExpensePage` uses, stored
   as integer cents), category (optional, `<select>` from
   `useHouseholdCategories`, active categories only), description
   (optional prefill text).
3. A Parent can edit an existing preset's fields.
4. A Parent can deactivate/reactivate a preset (soft, matching C1's
   pattern) — no hard delete from the UI.
5. `npm run typecheck`, `npm run lint`, and `npm run test` all pass.

### C4 — Quick-add presets on `AddExpensePage`

**Acceptance criteria:**
1. `AddExpensePage` renders the household's *active* presets (via a new
   `useExpensePresets` read hook, mirroring `useHouseholdCategories`'s
   shape) as quick-add buttons/chips above or alongside the expense form.
2. Clicking a preset prefills the form's amount, category, and description
   fields from the preset's stored values — it does **not** submit the
   form. Per `PROJECT_REQUIREMENTS.md` §8: "A quick preset should prefill
   the form but still allow the amount or description to be changed before
   submission."
3. After clicking a preset, the Parent (or Child, if `AddExpensePage` is
   used by both roles — check current route gating) can still edit any
   prefilled field before submitting, exactly like manual entry.
4. A household with no active presets renders the form with no quick-add
   section (not an empty placeholder) — this must not regress the existing
   no-preset Add Expense flow.
5. `npm run typecheck`, `npm run lint`, and `npm run test` all pass.

## Verification tier

C2 requires the `verifier` agent per `.sdlc/project.yaml`'s floor
(`data_persistence_migrations`) and widen list
(`rls_policy_or_security_definer_function_changes`) — a brand-new table and
brand-new RLS policies. C1, C3, C4 are default tier: they consume
already-correct RLS (C1) or a migration C2 already verified (C3, C4), touch
no auth/session logic, and don't change any balance/amount derivation
(presets only prefill a form the existing expense-write path already
validates and processes).
