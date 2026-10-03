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
| CB5 | Child payment suggestions | done | Migration `20261003170000`; pgTAP 017 (163, suite 827), 36 mutations red (verifier re-confirmed one: guard trigger). Verifier pass. Tables `payment_suggestions` + `payment_suggestion_parts` (SELECT-only for app roles; guard trigger lets only pending->terminal change). Functions `create_payment_suggestion(member, amount, date, note, parts)` (Child, self only; null parts = all Everyday), `withdraw_payment_suggestion(id)`, `dismiss_payment_suggestion(id, reason)`; `record_payment` gains trailing `p_suggestion_id` (record_adjustment does not; old 7-arg signature dropped, 014 edited 3 lines to name the new one). Conversion locks the suggestion, single-use, same member, rolls back the payment on failure. Archived-later balance does not invalidate a pending suggestion. Front end reads `payment_suggestions?select=*,payment_suggestion_parts(*)`. **Phase A complete.** |
| CB6 | Settings: tracked balances | done | Phase B, front end only. Categories settings page gains a Balances section (add, rename, reorder by renumbering 1..n, archive/restore; Everyday labelled default, rename-only) and a per-category "Counts toward" picker with a plain-English note that remapping moves past expenses and totals never change. Calls the CB1 RPCs; DB errors shown inline. Vitest 9 in that file, typecheck, lint clean. **Not looked at in a browser** (local Supabase not running); unit tests mock supabase. New balances get a blank sort order, so they list last. |
| CB7 | Record payment split editor + move money | done | Phase B, front end only. Verifier pass; vitest 835, typecheck, lint clean. Split editor on Record payment (suggested split: plan minimums by due date, remainder to last-used balance (localStorage) else Everyday; sum gate; credit confirmation; hidden when only Everyday exists); same editor for adjustments; Move money as a second switch on the same page (hidden with <2 balances); `?suggestion=<id>` prefill and `p_suggestion_id` (CB9 builds the link). **Not run in a browser or against a real database** (unit tests mock supabase). Known gap for CB8: `useHouseholdPaymentProgress` still reads one plan per child, so the child-list status chip and Catch up/Minimum shortcuts are ambiguous when a child has several plans. Credit-confirmation is skipped if the per-balance read fails (server still authoritative). |
| CB8 | Home, Family, Activity with balances | done | Phase B, front end only. Verifier pass (conditional on a local-stack smoke check); vitest 861, typecheck, lint clean. Per-balance plan reads everywhere (`usePaymentPlans`, progress hooks return lists; `headlineProgress` picks most pressing plan for single chips); breakdown on Parent Home/Family/Child Home with hide rule (0 owed and no plan) and credit wording; plan controls per balance; Activity shows multi-part splits and read-only transfers (only under All/no category; capped at 200, merged by date while paging). **Never run in a browser or against a real database** — PostgREST selects on `balance_transfers`, `payment_allocations`, `payment_plans.tracked_balance_id` and `.in()` are unproven. Known minor: `needsAttention` skips a plan only when the child's *total* is <= 0, not when that plan's balance owes 0; breakdown and total come from separate reads with no sum check (falls back to total-only only on read failure); 'Showing N' counts transfers. |
| CB9 | Child suggestions UI, export, requirements doc | todo | Depends CB5, CB7. |

## Session log

_Newest entries on top._

### 2026-10-03 — CB8 done

Verifier pass. Two minor verifier findings left open (see CB8 row) pending a real-database smoke check. Next: CB9.

### 2026-10-03 — CB7 done

Verifier pass (monetary logic). One verifier finding fixed inline: a suggestion id is no longer sent if the Parent switched to a different child after opening it. Next: CB8 (Home, Family, Activity with balances), which must also make the per-child plan queries per-balance.

### 2026-10-03 — CB6 done

Default tier (no verifier: UI only, no new money or security logic). Next: CB7 (record payment split editor + move money), verifier tier.

### 2026-10-03 — CB5 done; Phase A (database) complete

Verifier pass, test:db 827, unit 816. All database rules for category balances are in; nothing on this branch is merged or pushed and the front end is unaffected. Next: Phase B, starting CB6 (Settings: tracked balances).

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
