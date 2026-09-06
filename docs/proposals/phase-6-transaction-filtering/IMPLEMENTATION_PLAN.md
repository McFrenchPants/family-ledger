# Implementation Plan: Phase 6 — Transaction filtering

Scope for this slice: let a viewer of the History view (`/child/:memberId/history`)
narrow the list by transaction type, category, and a date range. See
`BACKLOG.md` item 7 — this is one of the four remaining Phase 6 sub-pieces
(categories/presets, notification preferences, transaction filtering,
accessibility review), picked up on its own per the user's 2026-09-06
choice. No design spec: the shape is fully determined by the existing
schema and `HistoryPage`/`useHistory` — no new tables, no new authz
surface, no new dependency.

## Background for both tasks

- **No RLS/security-definer changes.** `ledger_transactions_select_self` /
  `_select_parent` (P1.2) already scope every row returned to what the
  caller may see; filtering here is a query/UI refinement on top of that,
  not a new access path. This keeps the task at the **default**
  verification tier (see "Verification tier" below).
- **Query location:** `src/features/ledger/useHistory.ts` currently does an
  unfiltered `supabase.from("ledger_transactions").select(...).eq("member_id", memberId)`
  with no `.limit()`. Extend it to accept an optional filter object and
  apply the additional predicates (`.eq("type", ...)`, `.eq("category_id", ...)`,
  `.gte("occurred_on", ...)`, `.lte("occurred_on", ...)`) server-side via
  Supabase query builder chaining, rather than filtering the already-fetched
  array client-side — the history view has no `.limit()` specifically so
  that nothing is hidden, and a household with a long history should not
  have to download every row just to look at last month's payments.
- **Categories for the filter dropdown:** query `public.categories` scoped
  to the member's household (`household_id`, already resolvable the same
  way `AddExpensePage` resolves it for its own category `<select>` at
  `src/pages/AddExpensePage.tsx:244-252` — reuse that pattern, do not
  invent a new one), `active` categories only (mirroring the existing
  household-scoping/active-filtering convention), ordered by `sort_order`.
- **UI convention:** this codebase does not use Radix `Select` anywhere —
  every existing dropdown is a plain Tailwind-styled native `<select>`
  (`src/pages/AddExpensePage.tsx:205-213`, `244-252`). Match that pattern
  for the new type/category filters; do not introduce `@radix-ui/react-select`
  for this. Date-range inputs should be plain `<input type="date">`
  elements, consistent with existing form inputs in `AddExpensePage.tsx`.
- **Types available:** `expense`, `payment`, `adjustment` (see
  `TYPE_LABELS` in `src/pages/HistoryPage.tsx:13-17`) — voided rows are not
  a separate type, they're any row with `voided_at !== null`, and stay in
  scope of this filtering feature only via the type/category/date filters,
  not as their own filter axis (out of scope — do not add a "show voided
  only" toggle, it isn't asked for and complicates the query for no
  requested benefit).
- Filters are independent and combine with AND semantics (e.g. type=payment
  AND category=Allowance AND date between X and Y).

## Tasks

| ID | Task | Depends on |
| --- | --- | --- |
| F6.1 | Extend `useHistory` to accept and apply server-side filters | none |
| F6.2 | Filter UI on `HistoryPage` (type/category/date-range controls, clear filters) | F6.1 |

### F6.1 — Extend `useHistory` to accept and apply server-side filters

**Acceptance criteria:**
1. `useHistory(memberId, filters?)` accepts an optional filters argument
   shaped `{ type?: string; categoryId?: string; from?: string; to?: string }`
   (all optional, `from`/`to` as `YYYY-MM-DD` strings matching `occurred_on`'s
   `date` type) without breaking its existing no-argument callers.
2. Each provided filter field is applied as an additional predicate on the
   Supabase query (`.eq`/`.gte`/`.lte` as appropriate) — verify by
   inspecting the generated query or, more directly, by seeding local test
   data with rows that should and shouldn't match a given filter
   combination and confirming only the matching rows return.
3. Omitting a filter field (or omitting the whole `filters` argument)
   preserves the current unfiltered, unlimited, newest-first behavior
   exactly — no regression for the existing no-filter call site.
4. A combination of all four filters together narrows correctly (AND
   semantics) — verify with at least one multi-filter local test case.
5. A new small helper or hook fetches the caller's household's `categories`
   (active only, ordered by `sort_order`) for populating the category
   filter's options — reuse the household-resolution approach already used
   by `AddExpensePage`'s category select rather than duplicating household
   lookup logic differently.
6. `npm run typecheck`, `npm run lint`, and `npm run test` all pass.

### F6.2 — Filter UI on `HistoryPage`

**Acceptance criteria:**
1. `HistoryPage` renders filter controls above the transaction list: a
   native `<select>` for type (options: All, Expense, Payment, Adjustment),
   a native `<select>` for category (options: All, then the household's
   active categories from F6.1, by name), and two `<input type="date">`
   fields for a from/to date range — styled consistently with existing
   controls (`min-h-touch rounded-card border border-surface-border px-3
   text-body`, per `AddExpensePage.tsx`'s selects).
2. Changing any filter control re-fetches via `useHistory` with the new
   filter values and updates the rendered list — verify live (or via a
   component test if the project's test tooling covers this page; if not,
   verify manually and say so explicitly in the completion report, per
   this project's own "no jsdom for page components" note in
   `analysis/09-component-test-tooling.md`).
3. A "Clear filters" control resets all four filters to their defaults and
   restores the full unfiltered list.
4. Filtering to a combination that matches no rows shows the same "no
   history to show" empty state the page already uses for a member with no
   transactions at all — not a separate/new empty-state variant.
5. Both a Parent viewing a child's history and a Child viewing their own
   history can use the filters — this is a display refinement, not a new
   permission boundary, and must not narrow or widen what either role can
   already see (RLS already governs that).
6. `npm run typecheck`, `npm run lint`, and `npm run test` all pass.

## Verification tier

Default tier for both tasks. Neither touches RLS, security-definer
functions, auth/session logic, migrations, or any of
`.sdlc/project.yaml`'s floor/widen categories (monetary/balance logic is
untouched — filtering narrows which already-computed rows display, it does
not change any amount, balance, or derivation; category/type/date are read
paths, not writes). Spot-check both against their acceptance criteria; no
verifier-agent routing needed.
