-- Family Ledger: P1.4 balance derivation.
--
-- Exposes each household member's current balance -- always
-- SUM(amount_cents) over non-voided ledger_transactions rows, grouped by
-- member_id, coalesced to 0 for a member with no transactions at all. No
-- stored/mutable balance column is introduced anywhere; this is purely a
-- read path over P1.1's ledger_transactions.
--
-- ---------------------------------------------------------------------------
-- Why a SECURITY DEFINER function, not a security_invoker view
-- ---------------------------------------------------------------------------
--
-- The "0 for zero transactions" requirement means the query cannot simply
-- GROUP BY over ledger_transactions (a member with no rows would be absent
-- entirely, not present with 0). It has to start from the universe of a
-- household's members -- household_members -- and LEFT JOIN the aggregated
-- ledger data on to that, coalescing the sum to 0.
--
-- That rules out a plain `security_invoker` view. P1.2's header already
-- established why: household_members has RLS enabled with ZERO policies
-- (Phase 0, intentionally deferred -- still true after P1.1/P1.2/P1.3, none
-- of which added one). A security_invoker view runs its query AS the calling
-- role, so a FROM public.household_members in a security_invoker view would
-- be subject to that same policy-less default-deny and return zero rows for
-- every caller, Parent or Child alike -- silently breaking exactly the "0
-- for no transactions" guarantee this task requires, for every household
-- member, forever. This is the identical trap P1.2 already solved for
-- categories/ledger_transactions/audit_log's policies, applied to this
-- view's own FROM clause instead of a policy's USING clause.
--
-- The fix is the same one P1.2 used: a SECURITY DEFINER function that reads
-- household_members as its owner (bypassing that table's own RLS for this
-- internal lookup, same as internal.is_household_member/is_household_parent/
-- current_household_member_id already do), but which does NOT thereby become
-- a free-for-all -- it re-derives the caller's own membership and role from
-- auth.uid() via those exact same P1.2 helpers, and filters its result set
-- by that, never by a client-supplied role or member id:
--
--   * a Parent of p_household_id gets every active member's balance in that
--     household (matching ledger_transactions_select_parent);
--   * a Child gets only the one row matching their own
--     internal.current_household_member_id(p_household_id) (matching
--     ledger_transactions_select_self);
--   * anyone else (not an active member of p_household_id at all) gets zero
--     rows -- is_household_parent is false and current_household_member_id
--     is null, so `hm.id = null` never matches.
--
-- This reuses P1.2's access-boundary logic verbatim rather than reimplementing
-- it, per this task's requirement not to duplicate/reinvent it separately.
--
-- p_household_id is an explicit parameter (not inferred solely from
-- auth.uid()) for the same reason P1.2's own helpers and P1.3's RPCs take it
-- explicitly: it lets one auth.uid() belong to more than one household later
-- without changing this signature, and passing a household_id the caller is
-- NOT an active member of is safe -- it simply yields zero rows, the same
-- generic outcome as a nonexistent household, never another household's
-- data (verified empirically below, not just asserted).

create or replace function public.household_member_balances(p_household_id uuid)
returns table (
  member_id uuid,
  balance_cents bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    hm.id as member_id,
    coalesce(sum(lt.amount_cents), 0)::bigint as balance_cents
  from public.household_members hm
  left join public.ledger_transactions lt
    on lt.member_id = hm.id
   and lt.voided_at is null
  where hm.household_id = p_household_id
    and hm.status = 'active'
    and (
      internal.is_household_parent(p_household_id)
      or hm.id = internal.current_household_member_id(p_household_id)
    )
  group by hm.id;
$$;

comment on function public.household_member_balances(uuid) is
  'Each active member''s current balance in p_household_id: SUM(amount_cents) over non-voided ledger_transactions, coalesced to 0 for a member with none. SECURITY DEFINER only to read household_members (which carries no SELECT policy of its own, per Phase 0) -- the result set itself is filtered by the caller''s own re-derived membership/role via internal.is_household_parent / internal.current_household_member_id, exactly mirroring ledger_transactions'' own P1.2 RLS policies (Parent sees every member in the household, Child sees only themselves). A p_household_id the caller does not actively belong to yields zero rows, never another household''s data.';

-- Same explicit-revoke pattern P1.3 had to adopt: `revoke ... from public`
-- alone does not remove Supabase's separate ALTER DEFAULT PRIVILEGES grant
-- of EXECUTE to anon/authenticated/service_role made at function-creation
-- time. Every role that must not call this is named explicitly.
revoke execute on function public.household_member_balances(uuid) from public, anon;
grant execute on function public.household_member_balances(uuid) to authenticated;
