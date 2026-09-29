# Implementation Plan: Phase 6 — Administration and polish

Scope for this slice: **export and backup** only. See
`analysis/07-phase-6-admin-and-polish.md` for why this slice was picked
first and why the rest of item 7 (categories/presets, member management,
notification preferences, transaction filtering, accessibility review) is
deliberately deferred to future picks under the same backlog item, appended
to this same proposal folder if/when they're taken up.

No design spec: the shape is fully determined by `ARCHITECTURE.md` §19's
field list and the existing schema (all tables it names already exist).

## Background for both tasks

- Both exports are **Parent-only**, scoped to the signed-in Parent's own
  household. RLS already restricts every underlying table read to the
  caller's own household — use the normal authenticated `supabase` client
  from `src/lib/supabase.ts` exactly as the existing dashboards do; do not
  introduce a service-role client or an Edge Function (per
  `ARCHITECTURE.md` §11, server-side export is only needed when it can't be
  done safely client-side, and this can).
- Tables involved: `households`, `household_members`, `categories`,
  `ledger_transactions`, `payment_plans`, `payment_periods`, `audit_log`.
  Push subscriptions are explicitly excluded per `ARCHITECTURE.md` §19.
- Follow this project's existing conventions: `RequireRole` for gating
  (see `src/features/auth/RequireRole.tsx` and any existing page that uses
  it, e.g. `src/pages/ParentDashboardPage.tsx`), the router in
  `src/app/router.tsx`, and `src/lib/currency.ts` for money formatting.
- File download: client-side `Blob` + a temporary anchor `download`
  attribute. No new dependency needed for either CSV or JSON generation at
  this scale (household-sized data, per `ARCHITECTURE.md` §27) — hand-roll
  CSV serialization (with correct quoting/escaping for commas, quotes, and
  newlines in free-text fields like transaction descriptions) rather than
  adding a CSV library.

## Tasks

| ID | Task | Depends on |
| --- | --- | --- |
| S6.1 | CSV export of ledger transactions | none |
| S6.2 | JSON snapshot export (full household backup) | none (independent of S6.1, but shares the export entry point/page — implementer for S6.2 should reuse whatever S6.1 establishes rather than duplicating it) |

### S6.1 — CSV export of ledger transactions

**Acceptance criteria:**
1. A signed-in Parent has a discoverable way to trigger a CSV download of
   their household's `ledger_transactions`.
2. The CSV is human-readable: columns include at least date, member name,
   transaction type, amount (formatted via `src/lib/currency.ts`'s
   `Intl.NumberFormat`-based helper, not raw integer cents), category,
   description/memo, and voided status. Include a header row.
3. Only the signed-in Parent's own household's transactions appear — verify
   by checking the query goes through the normal RLS-scoped client, not a
   privileged path.
4. CSV values are properly escaped (a description containing a comma,
   quote, or newline does not corrupt the file structure) — verify with at
   least one such value in local test data.
5. A Child account cannot reach this export (route/action is Parent-only,
   enforced the same way other Parent-only screens are).
6. `npm run typecheck`, `npm run lint`, and `npm run test` all pass.

### S6.2 — JSON snapshot export (full household backup)

**Acceptance criteria:**
1. A signed-in Parent has a discoverable way to trigger a JSON download of
   a complete household snapshot.
2. The JSON includes, at minimum: household settings (name, timezone),
   members, ledger transactions, payment plans, payment periods,
   categories, and relevant audit log rows for the household —
   per `ARCHITECTURE.md` §19.
3. Monetary amounts in the JSON stay as integer cents (this is a
   re-importable backup format, not a human report — do not format them as
   currency strings the way the CSV does).
4. Only the signed-in Parent's own household's data appears, via the
   normal RLS-scoped client.
5. A Child account cannot reach this export.
6. The downloaded filename and/or a field inside the JSON identifies which
   household and when the export was taken (e.g. a timestamp), so a Parent
   comparing multiple backups over time isn't guessing.
7. `npm run typecheck`, `npm run lint`, and `npm run test` all pass.

## Verification tier

Default tier for both tasks (spot-check by the orchestrator, no separate
`verifier` agent spawn) — neither task changes RLS policies, security-
definer functions, balance/monetary *calculation* logic, or audit-log
write paths; they only read already-derived data through the existing
RLS-scoped client and format it for download. This mirrors how Phase 2's
UI-only stage tasks (S3.1-S3.4) were tiered in
`docs/proposals/phase-2-payment-plans/PROGRESS.md`.
