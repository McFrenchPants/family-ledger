-- Regression tests: M6.2 -- public.add_household_member SQL groundwork.
--
-- Covers 20260905080000_add_household_member_function.sql.
--
-- Role-switching idiom matches 003_ledger_privilege_escalation.sql and
-- 006_household_members_update_policy.sql: fixtures run as this file's
-- default role (postgres); each Child/Parent-scoped block sets
-- `role authenticated` plus `request.jwt.claims` naming that member's own
-- auth.users id, then `reset role` returns to postgres before the next block
-- or before a postgres-only read of the true (RLS-unfiltered) table state.
--
-- Self-contained: creates its own fixtures, depends on nothing in seed.sql,
-- and the whole file runs inside begin/rollback so the database is left
-- exactly as it was found.
--
-- Run with: npm run test:db  (wraps `npx supabase test db --local`)

begin;

create extension if not exists pgtap with schema extensions;
set local search_path to extensions, public, pg_catalog;

select plan(14);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
--
-- Household A: one active Parent (P1) and one active Child (C1).
-- Household B: one active Parent (P2) -- used for the cross-household
-- rejection case.
-- A spare, not-yet-a-member auth.users row (NEWUSER) is the target for the
-- successful add + the duplicate-user_id rejection.

insert into public.households (id, name, timezone, child_expense_scope) values
  ('90000000-0000-0000-0000-0000000000a1', 'Household A', 'America/Chicago', 'any_member'),
  ('90000000-0000-0000-0000-0000000000b1', 'Household B', 'Europe/Paris', 'any_member');

insert into auth.users (id, email) values
  ('91000000-0000-0000-0000-00000000a001', 'p1-m62@example.test'),
  ('91000000-0000-0000-0000-00000000a002', 'c1-m62@example.test'),
  ('91000000-0000-0000-0000-00000000b001', 'p2-m62@example.test'),
  ('91000000-0000-0000-0000-00000000c001', 'newuser-m62@example.test');

insert into public.household_members (id, household_id, user_id, name, role, status) values
  ('92000000-0000-0000-0000-00000000a001', '90000000-0000-0000-0000-0000000000a1',
   '91000000-0000-0000-0000-00000000a001', 'Parent One', 'parent', 'active'),
  ('92000000-0000-0000-0000-00000000a002', '90000000-0000-0000-0000-0000000000a1',
   '91000000-0000-0000-0000-00000000a002', 'Child One',  'child',  'active'),
  ('92000000-0000-0000-0000-00000000b001', '90000000-0000-0000-0000-0000000000b1',
   '91000000-0000-0000-0000-00000000b001', 'Parent Two', 'parent', 'active');

-- ---------------------------------------------------------------------------
-- Criterion 1: an active Parent can add a new member to their own household.
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"91000000-0000-0000-0000-00000000a001","role":"authenticated"}';

create temp table tmp_c1 as
select * from public.add_household_member(
  '90000000-0000-0000-0000-0000000000a1',
  '91000000-0000-0000-0000-00000000c001',
  'New Member',
  'child'
);

reset role;

select is(
  (select status from tmp_c1),
  'active',
  'Criterion 1a: the new row is created with status = ''active'''
);

select is(
  (select role from tmp_c1),
  'child',
  'Criterion 1b: the new row carries the given role'
);

select is(
  (select name from tmp_c1),
  'New Member',
  'Criterion 1c: the new row carries the given name'
);

select is(
  (select user_id from tmp_c1),
  '91000000-0000-0000-0000-00000000c001'::uuid,
  'Criterion 1d: the new row carries the given user_id'
);

select is(
  (select count(*) from public.household_members
    where household_id = '90000000-0000-0000-0000-0000000000a1'
      and user_id = '91000000-0000-0000-0000-00000000c001'),
  1::bigint,
  'Criterion 1e: exactly one household_members row was created'
);

-- ---------------------------------------------------------------------------
-- Criterion 6 (checked alongside 1, same call): exactly one audit_log
-- 'created' row for the successful add.
-- ---------------------------------------------------------------------------

select is(
  (select count(*) from public.audit_log
    where entity_type = 'household_members'
      and entity_id = (select id from tmp_c1)
      and action = 'created'),
  1::bigint,
  'Criterion 6: the successful add produced exactly one audit_log ''created'' row'
);

-- ---------------------------------------------------------------------------
-- Criterion 2: a non-Parent (Child, or no membership at all) is rejected.
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"91000000-0000-0000-0000-00000000a002","role":"authenticated"}';

select throws_ok(
  $$ select public.add_household_member(
       '90000000-0000-0000-0000-0000000000a1', gen_random_uuid(), 'Should Fail', 'child'
     ) $$,
  '42501',
  null,
  'Criterion 2a: a Child caller is rejected'
);

reset role;

-- No membership at all (a real auth.users row with zero household_members
-- rows anywhere).
insert into auth.users (id, email) values
  ('91000000-0000-0000-0000-00000000d001', 'nomember-m62@example.test');

set local role authenticated;
set local request.jwt.claims to '{"sub":"91000000-0000-0000-0000-00000000d001","role":"authenticated"}';

select throws_ok(
  $$ select public.add_household_member(
       '90000000-0000-0000-0000-0000000000a1', gen_random_uuid(), 'Should Fail', 'child'
     ) $$,
  '42501',
  null,
  'Criterion 2b: a caller with no household membership at all is rejected'
);

reset role;

-- ---------------------------------------------------------------------------
-- Criterion 3: a Parent of a DIFFERENT household is rejected.
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"91000000-0000-0000-0000-00000000b001","role":"authenticated"}';

select throws_ok(
  $$ select public.add_household_member(
       '90000000-0000-0000-0000-0000000000a1', gen_random_uuid(), 'Should Fail', 'child'
     ) $$,
  '42501',
  null,
  'Criterion 3: a Parent of a different household is rejected'
);

reset role;

-- ---------------------------------------------------------------------------
-- Criterion 4: adding a user_id already linked in the SAME household is
-- rejected with a clean error, and the underlying unique index is still the
-- real backstop (a raw INSERT bypassing the function is also rejected).
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"91000000-0000-0000-0000-00000000a001","role":"authenticated"}';

select throws_ok(
  $$ select public.add_household_member(
       '90000000-0000-0000-0000-0000000000a1',
       '91000000-0000-0000-0000-00000000c001',
       'Duplicate Attempt', 'child'
     ) $$,
  '23505',
  'this user is already a member of this household',
  'Criterion 4a: adding an already-linked user_id in the same household is rejected with a clean error'
);

reset role;

-- Confirm the raw constraint is still the backstop -- a direct INSERT (as
-- postgres, bypassing the function and RLS entirely) hits the partial unique
-- index, not just the function's pre-check.
select throws_ok(
  $$ insert into public.household_members (household_id, user_id, name, role, status)
     values ('90000000-0000-0000-0000-0000000000a1', '91000000-0000-0000-0000-00000000c001', 'Raw Insert', 'child', 'active') $$,
  '23505',
  null,
  'Criterion 4b: the underlying partial unique index still rejects a raw duplicate INSERT, independent of the function''s own pre-check'
);

-- ---------------------------------------------------------------------------
-- Criterion 5: an invalid role value is rejected with a clear error.
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"91000000-0000-0000-0000-00000000a001","role":"authenticated"}';

select throws_ok(
  $$ select public.add_household_member(
       '90000000-0000-0000-0000-0000000000a1', gen_random_uuid(), 'Bad Role', 'grandparent'
     ) $$,
  '23514',
  null,
  'Criterion 5: an invalid role value is rejected with a clear error'
);

reset role;

-- ---------------------------------------------------------------------------
-- Structural assertions
-- ---------------------------------------------------------------------------

select is(
  (select count(*) from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'household_members' and cmd = 'INSERT'),
  0::bigint,
  'Structural: household_members still carries no INSERT policy -- add_household_member is the only INSERT path'
);

select ok(
  exists (
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'add_household_member'
  ),
  'Structural: public.add_household_member exists'
);

select * from finish();

rollback;
