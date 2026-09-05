-- Family Ledger: P2.2 RLS policies for payment_plans and payment_periods.
--
-- Adds Row Level Security SELECT policies on top of the P2.1 schema
-- (20260905030000_payment_plans_schema.sql), which enabled RLS on both
-- tables with zero policies (default-deny).
--
-- Scope for this migration:
--   * payment_plans SELECT: Parents see every plan in their household;
--     Children see only the plan(s) where member_id is their own.
--   * payment_periods SELECT: same shape, scoped by the period's own
--     (denormalized) member_id column -- no join through payment_plans is
--     needed, which is exactly why that column was denormalized in P2.1.
--   * NO INSERT/UPDATE/DELETE policy on either table, for any role.
--     Postgres RLS is default-deny per command: with zero write policies,
--     any insert/update/delete against these tables affects zero rows for
--     every non-superuser role, regardless of household_id/member_id.
--     Creating/editing plans, generating periods, and waiving a period all
--     require checking role/household/plan-state together, which is more
--     than a RLS USING/WITH CHECK clause should try to encode in one place
--     -- security-definer RPC functions are the right shape for that, and
--     are a separate, later task (P2.3). Same reasoning as
--     ledger_transactions in 20260904230000_ledger_rls_policies.sql.
--
-- Reuses the internal.is_household_member / internal.is_household_parent /
-- internal.current_household_member_id SECURITY DEFINER helpers added in
-- 20260904230000_ledger_rls_policies.sql -- see that file's header comment
-- for why household_members needs helper functions rather than direct
-- subqueries in these policies. No new helper functions are added here.

-- ---------------------------------------------------------------------------
-- payment_plans: role-scoped SELECT, no INSERT/UPDATE/DELETE
-- ---------------------------------------------------------------------------
--
-- Two permissive SELECT policies for the same command are combined with OR:
-- a row is visible if EITHER holds. A Parent sees every plan in their
-- household; a Child sees only the plan(s) charged against their own
-- member_id.

create policy payment_plans_select_parent
  on public.payment_plans
  for select
  to authenticated
  using (internal.is_household_parent(household_id));

create policy payment_plans_select_self
  on public.payment_plans
  for select
  to authenticated
  using (member_id = internal.current_household_member_id(household_id));

-- ---------------------------------------------------------------------------
-- payment_periods: role-scoped SELECT, no INSERT/UPDATE/DELETE
-- ---------------------------------------------------------------------------
--
-- Same shape as payment_plans above, but scoped by payment_periods' own
-- member_id column (denormalized from payment_plans in P2.1 specifically so
-- this policy does not need to join through payment_plans).

create policy payment_periods_select_parent
  on public.payment_periods
  for select
  to authenticated
  using (internal.is_household_parent(household_id));

create policy payment_periods_select_self
  on public.payment_periods
  for select
  to authenticated
  using (member_id = internal.current_household_member_id(household_id));
