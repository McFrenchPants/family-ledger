# Progress: Home improvements and payment-period rule fix

Branch `feature/home-improvements`. See `IMPLEMENTATION_PLAN.md`.

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
| H1 | Payment-period allocation: whole period month | in-progress | Migration + pgTAP; verifier tier. Needs `db push` to the hosted project after merge (owner step). |
| H2 | Home page tidy (compact rows, labels, status line, hide voided) | in-progress | Front end only. Independent of H1. |

## Session log

_Newest entries on top._

### 2026-10-03 — Scaffolded

Owner chose to publish UI10 and then look at Home. Review of the UI10
screenshots found the payment-period gap (see plan). Owner picked the
"whole calendar month" rule and all four Home changes.
