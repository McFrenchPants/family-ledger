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
| H1 | Payment-period allocation: whole period month | done | Migration `20261003090000`; pgTAP 005 now 64 assertions (suite 316), mutation-proofed. Verifier: pass. Needs `npx supabase db push --linked` by the owner before/at promotion. Verifier notes (not fixed): no test that another household's Parent/Child gets zero rows from the function (pre-existing gap); if a plan is replaced mid-month a payment could count toward a period in both plans (old periods only, Home unaffected). Pre-existing quirk: plan starting on the 29th-31st with an earlier due day gets due_date before period_start. |
| H2 | Home page tidy (compact rows, labels, status line, hide voided) | done | All children in one card, one row each (chip + thin bar, + and check icon buttons, row opens `/family/:id`); due date only in the chip (a part-paid row shows "$x of $y paid" instead, no date); status line under the total on both widths; shared subtitle helper drops a repeated type word; voided rows filtered in the query (`excludeVoided` opt-in on `useRecentActivity`, household hook always). 803 tests. Browser: Parent 375 px light (agent) and dark (orchestrator), Child 375 px light; desktop by element positions only; Child desktop not seen. |

## Session log

_Newest entries on top._

### 2026-10-03 — H1 and H2 done

H1 (payment rule) verifier pass; H2 (Home tidy) orchestrator spot-check, typecheck/lint/803 tests clean, seen on Parent Home at 375 px dark with Sam now reading "October paid". Follow-up spotted by H1 agent, not done: Record payment's confirmation always shows the current period's effect even for a backdated payment. Next: owner promotes; the hosted DB needs the new migration pushed (`npx supabase db push --linked`, owner step) at the same time.

### 2026-10-03 — Scaffolded

Owner chose to publish UI10 and then look at Home. Review of the UI10
screenshots found the payment-period gap (see plan). Owner picked the
"whole calendar month" rule and all four Home changes.
