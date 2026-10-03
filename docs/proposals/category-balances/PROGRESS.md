# Progress: Separate balances by category, with payment splitting

Branch `feature/category-balances`. See `DESIGN_SPEC.md` and
`IMPLEMENTATION_PLAN.md`.

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
| CB1 | Tracked balances and per-balance read path | done | Migration `20261003130000`; pgTAP 013 (84, suite 420), 18 mutations all red. Verifier pass. Everyday identified by `is_everyday` (renamable, never archivable); archiving a balance still fed by categories is rejected; Everyday id normalizes to NULL in `categories.tracked_balance_id`; that column writable only via `set_category_balance` (categories INSERT/UPDATE grants narrowed to column lists). Breakdown is SECURITY DEFINER mirroring `household_member_balances`; relies on the Everyday row existing. |
| CB2 | Payment/adjustment allocation parts | todo | Depends CB1. Verifier. |
| CB3 | Move-money transfers | todo | Depends CB2. Verifier. |
| CB4 | Plans per balance | todo | Depends CB2. Verifier. |
| CB5 | Child payment suggestions | todo | Depends CB2. Verifier. Phase A ends here. |
| CB6 | Settings: tracked balances | todo | Phase B. Depends CB1. |
| CB7 | Record payment split editor + move money | todo | Depends CB2-CB5. Verifier. |
| CB8 | Home, Family, Activity with balances | todo | Depends CB4. |
| CB9 | Child suggestions UI, export, requirements doc | todo | Depends CB5, CB7. |

## Session log

_Newest entries on top._

### 2026-10-03 — CB1 done

Verifier pass, test:db 420, unit 816. Next: CB2 (allocation parts).

### 2026-10-03 — Design signed off, plan written

Owner answered all framing and open questions live: category-level
balances, only Parent-marked categories tracked (rest pooled as Everyday,
several categories may share one balance), per-balance plans, suggested
split the Parent adjusts, Child suggestions shown on Parent Home (no push
yet), old payments fixed with a move-money transfer rather than re-splitting.
