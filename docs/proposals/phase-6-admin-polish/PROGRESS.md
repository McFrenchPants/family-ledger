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
| S6.2 | JSON snapshot export (full household backup) | todo | |

## Session log

_Newest entries on top._

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
