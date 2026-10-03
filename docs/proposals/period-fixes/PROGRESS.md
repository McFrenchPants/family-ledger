# Progress: Payment-period fixes

Branch `feature/period-fixes`. See `IMPLEMENTATION_PLAN.md`.

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
| PF1 | Due date never before the period starts (backlog 15) | done | Migration `20261003120000` + helper `internal.payment_period_due_date`; also repairs stored rows with due_date < period_start (including inactive plans' periods). pgTAP 012 (20 cases, suite 336), mutation-proofed. Verifier: pass; it checked the repair by hand (rolled back) — no automated test plants a bad row. Needs owner `npx supabase db push --linked` at promotion. |
| PF2 | Record payment confirmation names the payment's month (backlog 13) | done | `4e6d4f7`. Panel heading is "<Month> payment period"; backdated payment uses the stored period whose window holds the date (page-local `nextPeriodStart` mirrors the server's anchor rule; new `addMonths` in `src/lib/dates`), none if not stored. 816 unit tests. Component tests only; not seen in a browser. |

## Session log

_Newest entries on top._

### 2026-10-03 — PF1 and PF2 done

Both tasks built in parallel. PF2 spot-checked (diff, typecheck/lint/816
tests). PF1 verifier pass; test:db 336 green. Next: merge into `main`; the
owner promotes to production and pushes migration `20261003120000` to the
hosted database at the same time (old code works fine with the new function;
the new function only changes due dates).

### 2026-10-03 — Scaffolded

Owner picked backlog 13-15, then agreed to defer 14 after analysis (no screen
shows an inactive plan's periods). Backlog 12's migration confirmed already
applied on the hosted project (read-only migration list).
