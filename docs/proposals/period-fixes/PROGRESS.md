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
| PF1 | Due date never before the period starts (backlog 15) | in-progress | Migration; verifier tier. Needs owner `db push` at promotion. |
| PF2 | Record payment confirmation names the payment's month (backlog 13) | in-progress | Front end only. |

## Session log

_Newest entries on top._

### 2026-10-03 — Scaffolded

Owner picked backlog 13-15, then agreed to defer 14 after analysis (no screen
shows an inactive plan's periods). Backlog 12's migration confirmed already
applied on the hosted project (read-only migration list).
