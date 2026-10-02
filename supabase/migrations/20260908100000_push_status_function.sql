-- Family Ledger: replace the household_member_push_status VIEW with a
-- SECURITY DEFINER FUNCTION.
--
-- Why: Supabase's security advisor flags public.household_member_push_status
-- (created in 20260907090000_push_subscriptions.sql) as a CRITICAL
-- "security definer view", because it is a plain (non-security_invoker) view
-- that reads push_subscriptions as its owner. That was deliberate: a Parent
-- must be able to see whether a CHILD has a subscription, but
-- push_subscriptions' RLS is owner-only, so a security_invoker view would
-- always report false to a Parent.
--
-- The project already solved the identical visibility rule for balances with
-- a SECURITY DEFINER function (20260905010000_ledger_member_balances.sql).
-- This migration does the same here. The advisor does not flag explicit
-- functions, and the access boundary is stated in the function body and
-- argument list rather than being implicit view-owner semantics.
--
-- Security reasoning (unchanged from the view):
--   * The function reads push_subscriptions / household_members as its owner,
--     but the result set is filtered by the caller's own re-derived role via
--     internal.is_household_parent / internal.current_household_member_id
--     (both keyed on auth.uid(), never on client-supplied role or member id).
--   * A Parent of p_household_id sees every active member of that household;
--     any other active member sees only their own row; anyone else (another
--     household's Parent, an archived member, anon) gets zero rows.
--   * Only household_member_id and has_subscription are returned. p256dh and
--     auth are never selected, so relaxing the predicate alone cannot leak
--     key material.
--   * search_path is empty and every name is schema-qualified.
--   * EXECUTE is revoked from public and anon (explicitly, because Supabase's
--     default privileges grant it separately) and granted to authenticated.
--
-- The view had no application callers (nothing under src/ uses it), so
-- dropping it breaks nothing.

drop view if exists public.household_member_push_status;

create or replace function public.household_member_push_status(p_household_id uuid)
returns table (
  household_member_id uuid,
  has_subscription boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    hm.id as household_member_id,
    exists (
      select 1
      from public.push_subscriptions ps
      where ps.household_member_id = hm.id
    ) as has_subscription
  from public.household_members hm
  where hm.household_id = p_household_id
    and hm.status = 'active'
    and (
      internal.is_household_parent(p_household_id)
      or hm.id = internal.current_household_member_id(p_household_id)
    );
$$;

comment on function public.household_member_push_status(uuid) is
  'For each active member of p_household_id the caller may see (Parent: every active member; any other active member: only themselves), whether they have at least one push_subscriptions row. Never returns p256dh/auth. SECURITY DEFINER only so a Parent can see a Child''s existence-of-subscription despite push_subscriptions'' owner-only RLS; visibility is re-derived from auth.uid() via internal.is_household_parent / internal.current_household_member_id, mirroring public.household_member_balances. A p_household_id the caller does not actively belong to yields zero rows.';

revoke execute on function public.household_member_push_status(uuid) from public, anon;
grant execute on function public.household_member_push_status(uuid) to authenticated;
