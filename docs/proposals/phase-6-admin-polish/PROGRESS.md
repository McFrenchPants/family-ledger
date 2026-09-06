# Progress: Phase 6 — Administration and polish (export/backup slice)

Branch: `feature/phase-6-admin-polish` (off `main`).

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
| S6.1 | CSV export of ledger transactions | done | Spot-checked (default tier). |
| S6.2 | JSON snapshot export (full household backup) | done | Spot-checked (default tier). **Slice complete.** |

## Session log

_Newest entries on top._

### 2026-09-06 — S6.2 done: JSON snapshot export. **Export/backup slice complete.**

Default verification tier (read-only export, no RLS/security-definer/
balance-logic changes). Spot-checked the diff against all 7 acceptance
criteria and independently re-ran `npm run typecheck`/`lint`/`test` myself
(clean; 244/244, up from 240). New: `src/features/backup/household-backup.ts`
(pure snapshot builder + JSON serializer, 4 new tests including one that
asserts monetary fields stay raw integer `number`s, never a formatted
string), `src/features/backup/useHouseholdBackup.ts` (7-table
`Promise.all` fetch via the normal RLS-scoped client — `households`,
`household_members`, `ledger_transactions`, `payment_plans`,
`payment_periods`, `categories`, `audit_log`; push subscriptions
deliberately excluded per `ARCHITECTURE.md` §19). Second button added to
the existing `/export` page next to S6.1's CSV button, no new route.
Verified independently that `categories`, `ledger_transactions`, and
`audit_log` all carry a direct `household_id` column and that `audit_log`
has a Parent-only `audit_log_select_parent` RLS policy (checked the
migrations directly), so the household-scoping and Parent-only claims
aren't just the implementer's say-so.

As with S6.1, no local Supabase stack was running, so RLS/Parent-only
gating is verified at the code + migration level, not a live signed-in-
Child negative test. Same non-blocking follow-up as S6.1's note: worth a
live spot-check next time a local stack is up.

This closes out the export/backup slice of Phase 6 — the remaining
sub-pieces (categories/presets UI, member management, notification
preferences, transaction filtering, accessibility review) stay deferred as
separate future picks under backlog item 7.

### 2026-09-05 — S6.1 done: CSV export of ledger transactions

Default verification tier (read-only export, no RLS/security-definer/
balance-logic changes). Spot-checked the diff against all 6 acceptance
criteria and independently re-ran `npm run typecheck`/`lint`/`test` myself
(clean; 240/240, up from 226 pre-task). New: `src/features/ledger/ledger-export.ts`
(pure mapper + RFC4180 CSV serializer, 14 new tests covering comma/quote/
newline escaping), `src/features/ledger/useLedgerExport.ts` (household-wide
fetch via the normal RLS-scoped client, mirroring `useAddExpenseFormData`'s
`Promise.all` pattern), `src/pages/ExportPage.tsx` (Parent-only page at
`/export`, gated by `RequireRole` same as `/parent`). Money is formatted via
`formatCents` in the CSV (not raw cents), dates via the household's own
timezone for the downloaded filename.

No local Supabase stack was running during implementation, so RLS/Parent-
only gating was verified at the code level (matches the existing
`ledger_transactions_select_parent` policy and `RequireRole` pattern already
exercised by other Parent-only routes) rather than a live signed-in-Child
negative test. Worth a live spot-check next time a local stack is up, but
not blocking — the export adds no new database access path beyond what
`useHistory`/`useHouseholdBalances` already exercise live.

### 2026-09-05 — Scaffolded

Item 8 (split Supabase client) deferred after investigation — see
`analysis/08-split-supabase-client.md` and `BACKLOG.md`. Picked up item 7
(Phase 6) instead, scoped down to just the export/backup slice per
`analysis/07-phase-6-admin-and-polish.md` — it's a named MVP acceptance
criterion (`PROJECT_REQUIREMENTS.md` §20 #12), fully schema-ready, and
doesn't need physical-device testing the way the push-notification phases
do. Branch created off `main`, two tasks planned (S6.1 CSV, S6.2 JSON).
