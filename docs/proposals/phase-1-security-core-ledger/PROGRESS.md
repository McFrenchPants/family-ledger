# Progress: Phase 1 — Security and core ledger

Branch: `feature/phase-1-security-core-ledger` (off `main`).

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
| P1.1 | Ledger schema: transactions, categories, audit log, household policy | todo | |
| P1.2 | RLS policies for read access and audit-log protection | todo | Depends on P1.1. |
| P1.3 | Security-definer functions: insert expense/payment/adjustment, void | todo | Depends on P1.1, P1.2. |
| P1.4 | Balance derivation | todo | Depends on P1.1–P1.3. |
| P1.5 | pgTAP privilege-escalation and integrity regression suite | todo | Depends on P1.1–P1.4. Gates Stage 2 — must be green before any UI task starts. |

Stage 2 (Parent/Child dashboards, Add Expense, Record Payment, History) is
not yet broken into tasks — it will be appended to `IMPLEMENTATION_PLAN.md`
once P1.5 is done and verified, per the design spec's gate.

## Session log

_Newest entries on top._

### 2026-09-04 — Plan created; Stage 1 scaffolded

Branched from `main`. Analysis (`analysis/01-phase-1-security-core-ledger.md`)
and design spec both went through explicit user check-ins: void model is a
status-flip (not a reversal row), a third `adjustment` transaction type is
in scope alongside `expense`/`payment`, and the household expense-policy
toggle is built into the schema now (defaulted permissive) even though its
settings UI waits for Phase 4. Design spec signed off 2026-09-04.

Five Stage-1 tasks planned (P1.1–P1.5), matching this run's
`max_tasks_per_run` budget of 5. All five are floor/widen-tier and will go
through the `verifier` agent. Starting P1.1 next.
