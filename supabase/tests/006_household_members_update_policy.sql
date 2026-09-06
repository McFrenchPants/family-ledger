-- Regression tests: M6.1 -- household_members UPDATE policy, immutability
-- trigger, last-active-Parent invariant, and audit logging.
--
-- Covers 20260905070000_household_members_update_policy.sql.
--
-- Role-switching idiom matches 003_ledger_privilege_escalation.sql: fixtures
-- run as this file's default role (postgres); each Child/Parent-scoped block
-- sets `role authenticated` plus `request.jwt.claims` naming that member's
-- own auth.users id, then `reset role` returns to postgres before the next
-- block or before a postgres-only read of the true (RLS-unfiltered) table
-- state.
--
-- Self-contained: creates its own fixtures, depends on nothing in seed.sql,
-- and the whole file runs inside begin/rollback so the database is left
-- exactly as it was found.
--
-- Run with: npm run test:db  (wraps `npx supabase test db --local`)

begin;

create extension if not exists pgtap with schema extensions;
set local search_path to extensions, public, pg_catalog;

select plan(19);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
--
-- Household A: two active Parents (P1, P1b) and one active Child (C1) -- two
-- Parents so the last-active-Parent invariant has a "succeeds" case to prove
-- alongside its "rejected" case.
-- Household B: one active Parent (P2) and one active Child (C2). Used for
-- cross-household isolation and as the "only active Parent" case.

insert into public.households (id, name, timezone, child_expense_scope) values
  ('90000000-0000-0000-0000-00000000000a', 'Household A', 'America/Chicago', 'any_member'),
  ('90000000-0000-0000-0000-00000000000b', 'Household B', 'Europe/Paris', 'any_member');

insert into auth.users (id, email) values
  ('91000000-0000-0000-0000-000000000001', 'p1-m61@example.test'),
  ('91000000-0000-0000-0000-000000000002', 'p1b-m61@example.test'),
  ('91000000-0000-0000-0000-000000000003', 'c1-m61@example.test'),
  ('91000000-0000-0000-0000-000000000004', 'p2-m61@example.test'),
  ('91000000-0000-0000-0000-000000000005', 'c2-m61@example.test');

insert into public.household_members (id, household_id, user_id, name, role, status) values
  ('92000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-00000000000a',
   '91000000-0000-0000-0000-000000000001', 'Parent One',   'parent', 'active'),
  ('92000000-0000-0000-0000-000000000002', '90000000-0000-0000-0000-00000000000a',
   '91000000-0000-0000-0000-000000000002', 'Parent One B', 'parent', 'active'),
  ('92000000-0000-0000-0000-000000000003', '90000000-0000-0000-0000-00000000000a',
   '91000000-0000-0000-0000-000000000003', 'Child One',    'child',  'active'),
  ('92000000-0000-0000-0000-000000000004', '90000000-0000-0000-0000-00000000000b',
   '91000000-0000-0000-0000-000000000004', 'Parent Two',   'parent', 'active'),
  ('92000000-0000-0000-0000-000000000005', '90000000-0000-0000-0000-00000000000b',
   '91000000-0000-0000-0000-000000000005', 'Child Two',    'child',  'active');

-- ---------------------------------------------------------------------------
-- Criterion 1: Active Parent can update name/status/archived_at on their
-- household's member (renaming the Child), and it produces exactly one
-- audit_log row.
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"91000000-0000-0000-0000-000000000001","role":"authenticated"}';

update public.household_members
   set name = 'Child One Renamed'
 where id = '92000000-0000-0000-0000-000000000003';

reset role;

select is(
  (select name from public.household_members where id = '92000000-0000-0000-0000-000000000003'),
  'Child One Renamed',
  'Criterion 1a: active Parent renaming their household''s member succeeds'
);

select is(
  (select count(*) from public.audit_log
    where entity_type = 'household_members'
      and entity_id = '92000000-0000-0000-0000-000000000003'
      and action = 'renamed'),
  1::bigint,
  'Criterion 1b: the rename produced exactly one audit_log ''renamed'' row'
);

-- ---------------------------------------------------------------------------
-- Criterion 2: attempting to change role, household_id, or user_id via
-- UPDATE is rejected, regardless of who else is also a Parent of the target
-- row's household.
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"91000000-0000-0000-0000-000000000001","role":"authenticated"}';

select throws_ok(
  $$ update public.household_members set role = 'parent' where id = '92000000-0000-0000-0000-000000000003' $$,
  '42501',
  null,
  'Criterion 2a: changing role via UPDATE is rejected'
);

select throws_ok(
  $$ update public.household_members set household_id = '90000000-0000-0000-0000-00000000000b' where id = '92000000-0000-0000-0000-000000000003' $$,
  '42501',
  null,
  'Criterion 2b: changing household_id via UPDATE is rejected'
);

select throws_ok(
  $$ update public.household_members set user_id = '91000000-0000-0000-0000-000000000004' where id = '92000000-0000-0000-0000-000000000003' $$,
  '42501',
  null,
  'Criterion 2c: changing user_id via UPDATE is rejected'
);

reset role;

-- ---------------------------------------------------------------------------
-- Criterion 3: a Child cannot UPDATE any household_members row -- their own,
-- a sibling's, or a Parent's.
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"91000000-0000-0000-0000-000000000003","role":"authenticated"}';

create temp table tmp_c3a as
with upd as (
  update public.household_members
     set name = 'Hacked By Child'
   where id = '92000000-0000-0000-0000-000000000003'
   returning 1
)
select count(*) as affected from upd;

select is(
  (select affected from tmp_c3a),
  0::bigint,
  'Criterion 3a: Child UPDATE of their OWN row affects zero rows (no UPDATE policy grants a Child anything)'
);

create temp table tmp_c3b as
with upd as (
  update public.household_members
     set name = 'Hacked By Child'
   where id = '92000000-0000-0000-0000-000000000001'
   returning 1
)
select count(*) as affected from upd;

select is(
  (select affected from tmp_c3b),
  0::bigint,
  'Criterion 3b: Child UPDATE of a Parent''s row affects zero rows'
);

reset role;

select is(
  (select name from public.household_members where id = '92000000-0000-0000-0000-000000000003'),
  'Child One Renamed',
  'Criterion 3c: the Child''s own row name is unchanged after both rejected attempts (confirmed as postgres, unfiltered)'
);

-- ---------------------------------------------------------------------------
-- Criterion 4: a Parent from a DIFFERENT household cannot update this
-- household's row.
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"91000000-0000-0000-0000-000000000004","role":"authenticated"}';

create temp table tmp_c4 as
with upd as (
  update public.household_members
     set name = 'Cross-Household Hack'
   where id = '92000000-0000-0000-0000-000000000003'
   returning 1
)
select count(*) as affected from upd;

select is(
  (select affected from tmp_c4),
  0::bigint,
  'Criterion 4: Parent of household B updating household A''s member affects zero rows'
);

reset role;

-- ---------------------------------------------------------------------------
-- Criterion 5: archiving the household's ONLY active Parent is rejected;
-- archiving a Parent when another active Parent exists succeeds.
-- ---------------------------------------------------------------------------

-- 5a: household B has exactly one active Parent (P2) -- archiving them must
-- be rejected by the trigger, not merely by RLS.
set local role authenticated;
set local request.jwt.claims to '{"sub":"91000000-0000-0000-0000-000000000004","role":"authenticated"}';

select throws_ok(
  $$ update public.household_members set status = 'archived' where id = '92000000-0000-0000-0000-000000000004' $$,
  '42501',
  null,
  'Criterion 5a: archiving a household''s only active Parent is rejected'
);

reset role;

select is(
  (select status from public.household_members where id = '92000000-0000-0000-0000-000000000004'),
  'active',
  'Criterion 5b: the sole Parent''s status is still active after the rejected archive attempt'
);

-- 5c: household A has TWO active Parents -- archiving one succeeds.
set local role authenticated;
set local request.jwt.claims to '{"sub":"91000000-0000-0000-0000-000000000001","role":"authenticated"}';

update public.household_members
   set status = 'archived', archived_at = now()
 where id = '92000000-0000-0000-0000-000000000002';

reset role;

select is(
  (select status from public.household_members where id = '92000000-0000-0000-0000-000000000002'),
  'archived',
  'Criterion 5c: archiving a Parent succeeds when another active Parent remains in the household'
);

select is(
  (select count(*) from public.audit_log
    where entity_type = 'household_members'
      and entity_id = '92000000-0000-0000-0000-000000000002'
      and action = 'archived'),
  1::bigint,
  'Criterion 5d: the successful archive produced exactly one audit_log ''archived'' row'
);

-- 5e: with household A now down to exactly one active Parent, archiving that
-- remaining Parent must ALSO be rejected -- proves the invariant is
-- evaluated live against current state, not just "more than one row ever
-- existed".
set local role authenticated;
set local request.jwt.claims to '{"sub":"91000000-0000-0000-0000-000000000001","role":"authenticated"}';

select throws_ok(
  $$ update public.household_members set status = 'archived' where id = '92000000-0000-0000-0000-000000000001' $$,
  '42501',
  null,
  'Criterion 5e: archiving the LAST remaining active Parent is rejected, after the household dropped to one'
);

reset role;

-- ---------------------------------------------------------------------------
-- Criterion 6: restoring an archived member succeeds.
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"91000000-0000-0000-0000-000000000001","role":"authenticated"}';

update public.household_members
   set status = 'active', archived_at = null
 where id = '92000000-0000-0000-0000-000000000002';

reset role;

select is(
  (select status from public.household_members where id = '92000000-0000-0000-0000-000000000002'),
  'active',
  'Criterion 6a: restoring an archived member succeeds'
);

select is(
  (select count(*) from public.audit_log
    where entity_type = 'household_members'
      and entity_id = '92000000-0000-0000-0000-000000000002'
      and action = 'restored'),
  1::bigint,
  'Criterion 6b: the restore produced exactly one audit_log ''restored'' row'
);

-- ---------------------------------------------------------------------------
-- Structural assertions
-- ---------------------------------------------------------------------------

select is(
  (select count(*) from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'household_members' and cmd = 'UPDATE'),
  1::bigint,
  'Structural: household_members carries exactly 1 UPDATE policy'
);

select is(
  (select count(*) from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'household_members' and cmd = 'INSERT'),
  0::bigint,
  'Structural: household_members still carries no INSERT policy (deferred to the invite Edge Function)'
);

select ok(
  exists (
    select 1 from pg_catalog.pg_trigger
     where tgrelid = 'public.household_members'::regclass
       and tgname = 'household_members_before_update'
       and not tgisinternal
  ),
  'Structural: the household_members_before_update trigger exists on household_members'
);

select * from finish();

rollback;
