-- Regression tests: account management follow-ups (defense in depth).
--
-- Complements 010_account_management_privilege_escalation.sql with three
-- things the first suite did not pin down:
--
--   (a) The BEFORE UPDATE trigger on household_members still rejects a changed
--       household_id / user_id for a writer that DOES hold the column
--       privileges (postgres). Since the column-privilege layer now stops
--       every app role first, only a privileged writer can reach the trigger,
--       so this is the only way to prove the second layer is still there.
--   (b) An archived member whose access token is still valid reads ZERO rows
--       from every household-scoped table beyond the ledger: payment_plans,
--       payment_periods, categories, expense_presets, push_subscriptions and
--       households -- for an archived Child and an archived Parent alike --
--       with positive controls proving the rows exist and were readable
--       before archiving.
--   (c) A Child of one household cannot call change_household_member_role or
--       set_household_member_status on members of ANOTHER household
--       (010 covers Parents of another household and same-household Children,
--       but not a Child of another household).
--
-- Role-switching idiom matches 003 and 010 (set local role authenticated +
-- request.jwt.claims; `reset role` back to postgres between blocks).
--
-- Self-contained: creates its own fixtures and runs inside begin/rollback.
-- Every row-count assertion is scoped to this file's own households/members
-- so committed leftover rows in a developer database cannot affect it.
--
-- Run with: npm run test:db  (wraps `npx supabase test db --local`)

begin;

create extension if not exists pgtap with schema extensions;
set local search_path to extensions, public, pg_catalog;

select plan(24);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
--
-- Household E: PE1 and PE2 (active Parents), CE (Child, archived later),
--              CE2 (Child, stays active).
-- Household F: FC (a Child) -- the "Child of another household" persona and
--              the row used for the postgres-level trigger tests.
-- NOUSER: a real auth user with no membership anywhere.

insert into public.households (id, name, timezone, child_expense_scope) values
  ('b0000000-0000-0000-0000-00000000000e', 'Household E', 'America/Chicago', 'any_member'),
  ('b0000000-0000-0000-0000-00000000000f', 'Household F', 'Europe/Paris', 'any_member');

insert into auth.users (id, email) values
  ('b1000000-0000-0000-0000-000000000001', 'pe1-am7@example.test'),
  ('b1000000-0000-0000-0000-000000000002', 'pe2-am7@example.test'),
  ('b1000000-0000-0000-0000-000000000003', 'ce-am7@example.test'),
  ('b1000000-0000-0000-0000-000000000004', 'ce2-am7@example.test'),
  ('b1000000-0000-0000-0000-000000000005', 'fc-am7@example.test'),
  ('b1000000-0000-0000-0000-000000000006', 'nouser-am7@example.test');

insert into public.household_members (id, household_id, user_id, name, role, status) values
  ('b2000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000e',
   'b1000000-0000-0000-0000-000000000001', 'PE1', 'parent', 'active'),
  ('b2000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000e',
   'b1000000-0000-0000-0000-000000000002', 'PE2', 'parent', 'active'),
  ('b2000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000e',
   'b1000000-0000-0000-0000-000000000003', 'CE',  'child',  'active'),
  ('b2000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000e',
   'b1000000-0000-0000-0000-000000000004', 'CE2', 'child',  'active'),
  ('b2000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000f',
   'b1000000-0000-0000-0000-000000000005', 'FC',  'child',  'active');

insert into public.categories (id, household_id, name) values
  ('b3000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000e', 'cat E');

insert into public.expense_presets (id, household_id, label, amount_cents) values
  ('b4000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000e', 'preset E', 500);

-- One plan + one period for each of CE and CE2 (so the archived Parent faces
-- a household with plans/periods that are not just "their own").
insert into public.payment_plans (id, household_id, member_id, minimum_cents, due_day, starts_on, created_by) values
  ('b5000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000e',
   'b2000000-0000-0000-0000-000000000003', 1000, 1, current_date, 'b2000000-0000-0000-0000-000000000001'),
  ('b5000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000e',
   'b2000000-0000-0000-0000-000000000004', 1000, 1, current_date, 'b2000000-0000-0000-0000-000000000001');

insert into public.payment_periods (id, payment_plan_id, household_id, member_id, period_start, due_date, minimum_cents) values
  ('b6000000-0000-0000-0000-000000000001', 'b5000000-0000-0000-0000-000000000001',
   'b0000000-0000-0000-0000-00000000000e', 'b2000000-0000-0000-0000-000000000003',
   date_trunc('month', current_date)::date, date_trunc('month', current_date)::date, 1000),
  ('b6000000-0000-0000-0000-000000000002', 'b5000000-0000-0000-0000-000000000002',
   'b0000000-0000-0000-0000-00000000000e', 'b2000000-0000-0000-0000-000000000004',
   date_trunc('month', current_date)::date, date_trunc('month', current_date)::date, 1000);

-- Push subscriptions: one each for CE (Child) and PE2 (Parent).
insert into public.push_subscriptions (id, household_member_id, endpoint, p256dh, auth) values
  ('b7000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-000000000003',
   'https://push.example.test/am7-ce', 'k', 'a'),
  ('b7000000-0000-0000-0000-000000000002', 'b2000000-0000-0000-0000-000000000002',
   'https://push.example.test/am7-pe2', 'k', 'a');

-- ---------------------------------------------------------------------------
-- (a) Trigger backstop, exercised as postgres (which HAS column privileges)
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ update public.household_members
        set household_id = 'b0000000-0000-0000-0000-00000000000e'
      where id = 'b2000000-0000-0000-0000-000000000005' $$,
  '42501',
  'household_members.household_id cannot be changed by UPDATE',
  'X1: even a column-privileged writer cannot move a member to another household (trigger backstop)'
);

select throws_ok(
  $$ update public.household_members
        set user_id = 'b1000000-0000-0000-0000-000000000006'
      where id = 'b2000000-0000-0000-0000-000000000005' $$,
  '42501',
  'household_members.user_id cannot be changed by UPDATE',
  'X2: even a column-privileged writer cannot re-point a member at a different login (trigger backstop)'
);

select is(
  (select household_id::text || '/' || user_id::text from public.household_members
    where id = 'b2000000-0000-0000-0000-000000000005'),
  'b0000000-0000-0000-0000-00000000000f/b1000000-0000-0000-0000-000000000005',
  'X3: FC''s household_id and user_id are unchanged after the refused updates'
);

-- ---------------------------------------------------------------------------
-- (b) Controls: before archiving, the same personas DO see the rows
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"b1000000-0000-0000-0000-000000000003","role":"authenticated"}';

select is(
  (select (select count(*) from public.payment_plans where household_id = 'b0000000-0000-0000-0000-00000000000e')::text
     || '/' || (select count(*) from public.payment_periods where household_id = 'b0000000-0000-0000-0000-00000000000e')::text
     || '/' || (select count(*) from public.categories where household_id = 'b0000000-0000-0000-0000-00000000000e')::text
     || '/' || (select count(*) from public.expense_presets where household_id = 'b0000000-0000-0000-0000-00000000000e')::text
     || '/' || (select count(*) from public.push_subscriptions
                 where household_member_id in ('b2000000-0000-0000-0000-000000000002', 'b2000000-0000-0000-0000-000000000003'))::text
     || '/' || (select count(*) from public.households where id = 'b0000000-0000-0000-0000-00000000000e')::text),
  '1/1/1/1/1/1',
  'B0a: (control) an active Child sees own plan/period, household category/preset, own push subscription and household'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"b1000000-0000-0000-0000-000000000002","role":"authenticated"}';

select is(
  (select (select count(*) from public.payment_plans where household_id = 'b0000000-0000-0000-0000-00000000000e')::text
     || '/' || (select count(*) from public.payment_periods where household_id = 'b0000000-0000-0000-0000-00000000000e')::text
     || '/' || (select count(*) from public.categories where household_id = 'b0000000-0000-0000-0000-00000000000e')::text
     || '/' || (select count(*) from public.expense_presets where household_id = 'b0000000-0000-0000-0000-00000000000e')::text
     || '/' || (select count(*) from public.push_subscriptions
                 where household_member_id in ('b2000000-0000-0000-0000-000000000002', 'b2000000-0000-0000-0000-000000000003'))::text
     || '/' || (select count(*) from public.households where id = 'b0000000-0000-0000-0000-00000000000e')::text),
  '2/2/1/1/1/1',
  'B0b: (control) an active Parent sees all household plans/periods, category/preset, own push subscription and household'
);

reset role;

-- Archive CE and PE2 as postgres (PE1 remains an active Parent, so the
-- last-active-Parent rule is satisfied).
update public.household_members set status = 'archived', archived_at = now()
 where id in ('b2000000-0000-0000-0000-000000000002', 'b2000000-0000-0000-0000-000000000003');

-- ---------------------------------------------------------------------------
-- (b) Archived Child with a still-valid token
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"b1000000-0000-0000-0000-000000000003","role":"authenticated"}';

select is(
  (select count(*) from public.payment_plans where household_id = 'b0000000-0000-0000-0000-00000000000e'),
  0::bigint,
  'B1: an archived Child reads zero payment_plans'
);

select is(
  (select count(*) from public.payment_periods where household_id = 'b0000000-0000-0000-0000-00000000000e'),
  0::bigint,
  'B2: an archived Child reads zero payment_periods'
);

select is(
  (select count(*) from public.categories where household_id = 'b0000000-0000-0000-0000-00000000000e'),
  0::bigint,
  'B3: an archived Child reads zero categories'
);

select is(
  (select count(*) from public.expense_presets where household_id = 'b0000000-0000-0000-0000-00000000000e'),
  0::bigint,
  'B4: an archived Child reads zero expense_presets'
);

select is(
  (select count(*) from public.push_subscriptions
    where household_member_id in ('b2000000-0000-0000-0000-000000000002', 'b2000000-0000-0000-0000-000000000003')),
  0::bigint,
  'B5: an archived Child reads zero push_subscriptions (not even their own)'
);

select is(
  (select count(*) from public.households where id = 'b0000000-0000-0000-0000-00000000000e'),
  0::bigint,
  'B6: an archived Child reads zero households rows'
);

-- ---------------------------------------------------------------------------
-- (b) Archived Parent with a still-valid token
-- ---------------------------------------------------------------------------

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"b1000000-0000-0000-0000-000000000002","role":"authenticated"}';

select is(
  (select count(*) from public.payment_plans where household_id = 'b0000000-0000-0000-0000-00000000000e'),
  0::bigint,
  'B7: an archived Parent reads zero payment_plans (loses the Parent-wide view)'
);

select is(
  (select count(*) from public.payment_periods where household_id = 'b0000000-0000-0000-0000-00000000000e'),
  0::bigint,
  'B8: an archived Parent reads zero payment_periods'
);

select is(
  (select count(*) from public.categories where household_id = 'b0000000-0000-0000-0000-00000000000e'),
  0::bigint,
  'B9: an archived Parent reads zero categories'
);

select is(
  (select count(*) from public.expense_presets where household_id = 'b0000000-0000-0000-0000-00000000000e'),
  0::bigint,
  'B10: an archived Parent reads zero expense_presets'
);

select is(
  (select count(*) from public.push_subscriptions
    where household_member_id in ('b2000000-0000-0000-0000-000000000002', 'b2000000-0000-0000-0000-000000000003')),
  0::bigint,
  'B11: an archived Parent reads zero push_subscriptions (not even their own)'
);

select is(
  (select count(*) from public.households where id = 'b0000000-0000-0000-0000-00000000000e'),
  0::bigint,
  'B12: an archived Parent reads zero households rows'
);

-- Control that the zeros above are about the archived users, not empty tables.
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"b1000000-0000-0000-0000-000000000001","role":"authenticated"}';

select is(
  (select (select count(*) from public.payment_plans where household_id = 'b0000000-0000-0000-0000-00000000000e')::text
     || '/' || (select count(*) from public.payment_periods where household_id = 'b0000000-0000-0000-0000-00000000000e')::text
     || '/' || (select count(*) from public.categories where household_id = 'b0000000-0000-0000-0000-00000000000e')::text
     || '/' || (select count(*) from public.expense_presets where household_id = 'b0000000-0000-0000-0000-00000000000e')::text),
  '2/2/1/1',
  'B13: (control) the still-active Parent PE1 sees all of that data'
);

-- ---------------------------------------------------------------------------
-- (c) A Child of ANOTHER household cannot use either function
-- ---------------------------------------------------------------------------

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"b1000000-0000-0000-0000-000000000005","role":"authenticated"}';

select throws_ok(
  $$ select public.change_household_member_role('b2000000-0000-0000-0000-000000000004', 'parent') $$,
  '42501',
  'only an active Parent of this member''s household may change member roles',
  'C1: a Child of household F cannot promote a household E Child'
);

select throws_ok(
  $$ select public.change_household_member_role('b2000000-0000-0000-0000-000000000001', 'child') $$,
  '42501',
  'only an active Parent of this member''s household may change member roles',
  'C2: a Child of household F cannot demote a household E Parent'
);

select throws_ok(
  $$ select public.set_household_member_status('b2000000-0000-0000-0000-000000000004', 'archived') $$,
  '42501',
  'only an active Parent of this member''s household may archive or restore members',
  'C3: a Child of household F cannot archive a household E member'
);

select throws_ok(
  $$ select public.set_household_member_status('b2000000-0000-0000-0000-000000000003', 'active') $$,
  '42501',
  'only an active Parent of this member''s household may archive or restore members',
  'C4: a Child of household F cannot restore an archived household E member'
);

reset role;

select is(
  (select string_agg(id::text || '=' || role || '/' || status, ',' order by id) from public.household_members
    where household_id = 'b0000000-0000-0000-0000-00000000000e'),
  'b2000000-0000-0000-0000-000000000001=parent/active,b2000000-0000-0000-0000-000000000002=parent/archived,b2000000-0000-0000-0000-000000000003=child/archived,b2000000-0000-0000-0000-000000000004=child/active',
  'C5: household E''s roles and statuses are exactly as fixtured after the refused cross-household calls'
);

select is(
  (select count(*) from public.audit_log
    where action in ('role_changed', 'archived', 'restored')
      and entity_id = 'b2000000-0000-0000-0000-000000000004'
      and actor_user_id = 'b1000000-0000-0000-0000-000000000005'),
  0::bigint,
  'C6: the refused cross-household calls wrote no audit row'
);

select * from finish();

rollback;
