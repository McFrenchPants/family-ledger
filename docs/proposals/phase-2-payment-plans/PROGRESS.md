# Progress: Phase 2 — Payment plans

Branch: `feature/phase-2-payment-plans` (off `main`).

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
| P2.1 | Schema: `payment_plans` and `payment_periods` | todo | |
| P2.2 | RLS policies for read access | todo | Depends on P2.1. |
| P2.3 | Security-definer functions: create/deactivate plan, ensure-current-period, waive | todo | Depends on P2.1, P2.2. |
| P2.4 | Period status derivation (allocation rule) | todo | Depends on P2.1–P2.3. |
| P2.5 | pgTAP privilege-escalation and status regression suite | todo | Depends on P2.1–P2.4. Gates Stage 2. |
| S3.1 | Parent payment-plan management screen | todo | Depends on Stage 1 complete. |
| S3.2 | Child progress UI | todo | Depends on Stage 1 complete. |
| S3.3 | Parent dashboard plan-status card | todo | Depends on Stage 1 complete. |
| S3.4 | Record Payment: period effect on confirmation | todo | Depends on Stage 1 complete; benefits from S3.1 existing (a plan to test against). |

## Session log

_Newest entries on top._

### 2026-09-05 — Plan created; Stage 1 scaffolded

Branched `feature/phase-2-payment-plans` from `main`. Analysis
(`analysis/02-phase-2-payment-plans.md`) and design spec both went through
explicit user check-ins: one active plan per child decoupled from
individual expenses (a child's many named/categorized expenses all roll up
under a single plan), lazy period generation with no scheduler (defers
`pg_cron` to Phase 5), and waived periods require a reason, audited like
Phase 1's void workflow. Design spec signed off 2026-09-05.

Five Stage-1 tasks planned (P2.1–P2.5), matching this run's
`max_tasks_per_run` budget of 5. All five are floor/widen-tier and will go
through the `verifier` agent, mirroring Phase 1's Stage 1 treatment. Four
Stage-2 UI tasks (S3.1–S3.4) planned to follow once Stage 1 is
gated-green. Starting P2.1 next.
