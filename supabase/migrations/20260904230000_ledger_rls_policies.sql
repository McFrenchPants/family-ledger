-- Family Ledger: P1.2 RLS policies for read access and audit-log protection.
--
-- Adds Row Level Security policies on top of the P1.1 schema
-- (20260904223000_ledger_schema.sql), which enabled RLS on categories,
-- ledger_transactions, and audit_log with zero policies (default-deny).
--
-- Scope for this migration:
--   * Household-boundary isolation on all three tables.
--   * ledger_transactions SELECT: Parents see every member's rows in their
--     household; Children see only their own.
--   * ledger_transactions has NO UPDATE/DELETE policy for anyone -- voiding
--     is a security-definer function in a later task (P1.3), never a raw
--     UPDATE. The absence of a policy is itself the enforcement (default-deny).
--   * ledger_transactions has NO INSERT policy either -- deliberately
--     deferred to P1.3. Recording an expense/payment/adjustment requires
--     checking type/sign/role/household child_expense_scope together, which
--     is more than a RLS USING/WITH CHECK clause should try to encode in one
--     place; a security-definer RPC is the right shape for that, not a raw
--     policy here.
--   * audit_log: table grants narrowed (see rationale below) plus a
--     Parent-only, household-scoped SELECT policy. No INSERT/UPDATE/DELETE
--     policy for ordinary roles.
--   * categories: household-wide SELECT for both roles, INSERT/UPDATE/DELETE
--     restricted to Parents.
--
-- ---------------------------------------------------------------------------
-- Why a private schema of SECURITY DEFINER helper functions
-- ---------------------------------------------------------------------------
--
-- Every policy below needs to answer "is the calling auth.uid() an active
-- member of this household, and with what role?" That requires reading
-- public.household_members. But household_members itself has RLS enabled
-- with ZERO policies (Phase 0, intentionally deferred) -- which means
-- default-deny for the anon/authenticated roles. A policy on categories or
-- ledger_transactions that subqueries household_members directly would run
-- that subquery AS the calling role, RLS would apply to household_members
-- too, and the subquery would see zero rows -- every policy below would
-- silently always evaluate false, for every user, forever.
--
-- The fix is the standard Postgres/Supabase pattern for this exact situation:
-- small SECURITY DEFINER helper functions that look up membership as their
-- OWNER (the migration-applying role, which is not subject to RLS on that
-- table), never as the caller. Each function only ever returns information
-- about the CALLER's own membership (derived from auth.uid() internally --
-- callers cannot pass an arbitrary user id in), so this does not create a
-- privilege-escalation surface: authenticated can learn "am I an active
-- member/parent of household X", nothing about anyone else.
--
-- These live in a new `internal` schema, not `public`, and are NOT granted to
-- PUBLIC. supabase/config.toml's api.schemas is ["public", "graphql_public"]
-- -- `internal` is not in that list, so even though these are SECURITY
-- DEFINER, they are not reachable as a PostgREST RPC endpoint. Policy
-- evaluation happens inside Postgres regardless of schema exposure, so this
-- costs nothing functionally and closes off the "SECURITY DEFINER function in
-- public is a public API endpoint" trap called out in the Supabase security
-- checklist.
--
-- Each function is `stable`, has `set search_path = ''` (fully-qualified
-- names only, so a caller-controlled search_path cannot hijack it), and reads
-- only `status = 'active'` rows -- an invited or archived member is not a
-- household member for authorization purposes.

create schema if not exists internal;

comment on schema internal is
  'Not exposed via the Data API (see supabase/config.toml api.schemas). Holds SECURITY DEFINER helper functions used only inside RLS policies.';

create or replace function internal.is_household_member(p_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.household_members hm
    where hm.household_id = p_household_id
      and hm.user_id = auth.uid()
      and hm.status = 'active'
  );
$$;

comment on function internal.is_household_member(uuid) is
  'True if the calling auth.uid() has an active household_members row in the given household, of either role. SECURITY DEFINER: bypasses household_members'' own (currently policy-less) RLS. Only ever reports the CALLER''s own membership.';

create or replace function internal.is_household_parent(p_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.household_members hm
    where hm.household_id = p_household_id
      and hm.user_id = auth.uid()
      and hm.status = 'active'
      and hm.role = 'parent'
  );
$$;

comment on function internal.is_household_parent(uuid) is
  'True if the calling auth.uid() has an active Parent household_members row in the given household. SECURITY DEFINER: see internal.is_household_member for rationale.';

create or replace function internal.current_household_member_id(p_household_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select hm.id
  from public.household_members hm
  where hm.household_id = p_household_id
    and hm.user_id = auth.uid()
    and hm.status = 'active'
  limit 1;
$$;

comment on function internal.current_household_member_id(uuid) is
  'The calling auth.uid()''s own household_members.id in the given household (active membership only), or NULL if none. SECURITY DEFINER: see internal.is_household_member for rationale.';

-- Only `authenticated` ever needs to call these (anon has no auth.uid() and
-- would always get false/null back anyway, but there is no reason to grant
-- it). Revoke the default PUBLIC execute grant first so the privilege is
-- exactly and only what is intended.
revoke execute on function internal.is_household_member(uuid) from public;
revoke execute on function internal.is_household_parent(uuid) from public;
revoke execute on function internal.current_household_member_id(uuid) from public;

grant execute on function internal.is_household_member(uuid) to authenticated;
grant execute on function internal.is_household_parent(uuid) to authenticated;
grant execute on function internal.current_household_member_id(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- categories: household-wide read, Parent-only write
-- ---------------------------------------------------------------------------

create policy categories_select_household_members
  on public.categories
  for select
  to authenticated
  using (internal.is_household_member(household_id));

create policy categories_insert_parent_only
  on public.categories
  for insert
  to authenticated
  with check (internal.is_household_parent(household_id));

create policy categories_update_parent_only
  on public.categories
  for update
  to authenticated
  using (internal.is_household_parent(household_id))
  with check (internal.is_household_parent(household_id));

create policy categories_delete_parent_only
  on public.categories
  for delete
  to authenticated
  using (internal.is_household_parent(household_id));

-- ---------------------------------------------------------------------------
-- ledger_transactions: role-scoped SELECT, no UPDATE/DELETE, no INSERT (yet)
-- ---------------------------------------------------------------------------
--
-- Two permissive SELECT policies for the same command are combined with OR:
-- a row is visible if EITHER holds. A Parent sees every row in their
-- household; a Child sees only rows charged against their own member_id.
--
-- Deliberately no UPDATE or DELETE policy at all, for any role. Postgres RLS
-- is default-deny per command: with zero UPDATE policies, `update` against
-- this table always affects zero rows for every non-superuser role,
-- regardless of `household_id`/`member_id`/ownership. That is the entire
-- enforcement of "the ledger is append-oriented, corrections happen through
-- void, never a raw UPDATE" at this layer -- there is nothing more specific
-- to write. Same reasoning for DELETE.
--
-- Deliberately no INSERT policy either -- see the file header. Recording a
-- transaction goes through a security-definer function in P1.3.

create policy ledger_transactions_select_parent
  on public.ledger_transactions
  for select
  to authenticated
  using (internal.is_household_parent(household_id));

create policy ledger_transactions_select_self
  on public.ledger_transactions
  for select
  to authenticated
  using (member_id = internal.current_household_member_id(household_id));

-- ---------------------------------------------------------------------------
-- audit_log: narrowed grants (primary defense) + Parent-only SELECT (RLS)
-- ---------------------------------------------------------------------------
--
-- Two independent layers, deliberately not just one:
--
-- 1. PRIMARY: revoke the table-level grants that make INSERT/UPDATE/DELETE
--    reachable at all for anon/authenticated, leaving only SELECT for
--    authenticated. This is chosen as the primary defense (over "RLS
--    policies alone, permitting no writes") because it is enforced by the
--    Postgres grant system BEFORE RLS is ever evaluated, is trivially
--    verifiable by reading pg_catalog / information_schema rather than
--    reasoning about policy predicates, and cannot be accidentally
--    loosened by a future permissive policy being added to this table --
--    a missing GRANT fails the write outright with `permission denied`,
--    independent of whatever policies exist.
-- 2. SECONDARY (defense in depth): RLS itself carries no INSERT/UPDATE/
--    DELETE policy for any role -- if the grant layer were ever loosened
--    by mistake, row-level default-deny still holds. The one policy that
--    does exist is a Parent-only, household-scoped SELECT, matching the
--    product requirement that Parents can review audit history; Children
--    get no read access to audit_log at all (no policy references them).
--
-- Neither layer touches the *owner* of the security-definer function P1.3
-- will add for writing audit rows. A SECURITY DEFINER function executes
-- with its owner's privileges (the migration-applying role, effectively
-- postgres), which is neither `anon` nor `authenticated` and is not subject
-- to table grants or RLS here at all -- so narrowing anon/authenticated's
-- grants and leaving RLS write-policy-free does not and cannot block that
-- future function's own inserts.

revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;

create policy audit_log_select_parent
  on public.audit_log
  for select
  to authenticated
  using (internal.is_household_parent(household_id));
