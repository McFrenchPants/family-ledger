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
| CB2 | Payment/adjustment allocation parts | done | Migration `20261003140000`; pgTAP 014 (89, suite 509), mutations red. Verifier pass. Parts tied to payment/adjustment rows by composite FK (new unique key on ledger_transactions incl. type); deferred SECURITY DEFINER sum triggers; guard blocks update/delete except cascade; validation errors all 23514; audit new_values = row + `allocations`. Breakdown sends any uncovered remainder to Everyday (always 0 when triggers are on). Notes: `service_role` keeps Supabase-default writes on the new tables (server-only key, triggers still bind; accepted); no pgTAP for household-delete cascade with parts (verified by hand); backup export lacks the new tables (CB9). |
| CB3 | Move-money transfers | done | Migration `20261003150000`; pgTAP 015 (80, suite 589), mutations red. Verifier pass. **Direction:** a transfer from X to Y moves *paid credit*: X's balance goes up, Y's goes down ("move $150 from Everyday to Car" = from Everyday, to Car). New unique key `household_members (id, household_id)` for composite FKs. Notes for UI (CB6/CB8): a balance can be archived while it still carries live transfers, and the breakdown keeps showing its amount -- surface it, don't hide it. No test asserts transfers leave `payment_period_status` alone (true by construction). |
| CB4 | Plans per balance | done | Migration `20261003160000`; pgTAP 016 (75, suite 664), 16 mutations red. Verifier pass. `create_payment_plan` gets trailing `p_tracked_balance_id` (null = Everyday), old 5-arg call shape still works; supersedes only same-balance plan; `payment_period_status` counts only parts on the plan's balance. Archiving a balance with an active plan is now refused (extends CB1 guard). 005 edited one line (function signature lookup). **For CB8:** front-end plan queries (`usePaymentPlan`, `useChildPaymentProgress`, `useHouseholdPaymentProgress`, `RecordPaymentPage`) read plans by child with no balance filter; they must become per-balance before a child can have two active plans in the UI. |
| CB5 | Child payment suggestions | todo | Depends CB2. Verifier. Phase A ends here. |
| CB6 | Settings: tracked balances | todo | Phase B. Depends CB1. |
| CB7 | Record payment split editor + move money | todo | Depends CB2-CB5. Verifier. |
| CB8 | Home, Family, Activity with balances | todo | Depends CB4. |
| CB9 | Child suggestions UI, export, requirements doc | todo | Depends CB5, CB7. |

## Session log

_Newest entries on top._

### 2026-10-03 — CB4 done

Verifier pass, test:db 664, unit 816. Next: CB5 (child suggestions), which ends Phase A.

### 2026-10-03 — CB3 done; run stopped at task budget

Verifier pass, test:db 589, unit 816. This run completed 5 tasks (PF1, PF2
on period-fixes; CB1-CB3 here), the configured per-run maximum. Next:
CB4 (plans per balance), then CB5 (suggestions), which ends Phase A.
Nothing on this branch is merged; the front end is unaffected so far.

### 2026-10-03 — CB2 done

Verifier pass, test:db 509, unit 816. Old front-end call shape still works
(all to Everyday). Next: CB3 (move-money transfers).

### 2026-10-03 — CB1 done

Verifier pass, test:db 420, unit 816. Next: CB2 (allocation parts).

### 2026-10-03 — Design signed off, plan written

Owner answered all framing and open questions live: category-level
balances, only Parent-marked categories tracked (rest pooled as Everyday,
several categories may share one balance), per-balance plans, suggested
split the Parent adjusts, Child suggestions shown on Parent Home (no push
yet), old payments fixed with a move-money transfer rather than re-splitting.
