-- Regression tests: CB4 -- payment plans per tracked balance.
--
-- Covers 20261003160000_plans_per_balance.sql: payment_plans.tracked_balance_id
-- (NOT NULL, same-household FK, Everyday default trigger), the per-(member,
-- balance) active-plan unique index, create_payment_plan's new trailing
-- p_tracked_balance_id (null = Everyday; supersedes only the same balance's
-- plan; Parent-only; foreign / missing / archived balance rejected; audit row),
-- payment_period_status counting only the payment parts allocated to the
-- plan's balance, and the guard that refuses to archive a balance an active
-- plan points at.
--
-- Role-switching idiom matches 003/005/013/014: fixtures run as postgres;
-- persona blocks set `role authenticated` plus `request.jwt.claims`;
-- `reset role` returns to postgres. Self-contained, begin/rollback.
--
-- Run with: npm run test:db  (wraps `npx supabase test db --local`)

begin;

create extension if not exists pgtap with schema extensions;
set local search_path to extensions, public, pg_catalog;

select plan(75);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
--
-- Household A: P1 (Parent), C1, C2 (Children). Balances: Everyday (trigger),
-- Car, College, Old (archived).
-- Household B: P2 (Parent), C3 (Child). Balance B Savings.
-- NOUSER: authenticated, member of nothing.

insert into public.households (id, name, timezone) values
  ('d4000000-0000-0000-0000-00000000000a', 'CB4 Household A', 'America/Chicago'),
  ('d4000000-0000-0000-0000-00000000000b', 'CB4 Household B', 'Europe/Paris');

insert into auth.users (id, email) values
  ('d4100000-0000-0000-0000-000000000001', 'p1-cb4@example.test'),
  ('d4100000-0000-0000-0000-000000000002', 'c1-cb4@example.test'),
  ('d4100000-0000-0000-0000-000000000003', 'c2-cb4@example.test'),
  ('d4100000-0000-0000-0000-000000000005', 'p2-cb4@example.test'),
  ('d4100000-0000-0000-0000-000000000006', 'c3-cb4@example.test'),
  ('d4100000-0000-0000-0000-000000000007', 'nouser-cb4@example.test');

insert into public.household_members (id, household_id, user_id, name, role, status) values
  ('d4200000-0000-0000-0000-000000000001', 'd4000000-0000-0000-0000-00000000000a',
   'd4100000-0000-0000-0000-000000000001', 'P1', 'parent', 'active'),
  ('d4200000-0000-0000-0000-000000000002', 'd4000000-0000-0000-0000-00000000000a',
   'd4100000-0000-0000-0000-000000000002', 'C1', 'child',  'active'),
  ('d4200000-0000-0000-0000-000000000003', 'd4000000-0000-0000-0000-00000000000a',
   'd4100000-0000-0000-0000-000000000003', 'C2', 'child',  'active'),
  ('d4200000-0000-0000-0000-000000000005', 'd4000000-0000-0000-0000-00000000000b',
   'd4100000-0000-0000-0000-000000000005', 'P2', 'parent', 'active'),
  ('d4200000-0000-0000-0000-000000000006', 'd4000000-0000-0000-0000-00000000000b',
   'd4100000-0000-0000-0000-000000000006', 'C3', 'child',  'active');

insert into public.tracked_balances (id, household_id, name, active) values
  ('d4400000-0000-0000-0000-000000000001', 'd4000000-0000-0000-0000-00000000000a', 'Car', true),
  ('d4400000-0000-0000-0000-000000000002', 'd4000000-0000-0000-0000-00000000000a', 'College', true),
  ('d4400000-0000-0000-0000-000000000003', 'd4000000-0000-0000-0000-00000000000a', 'Old', false),
  ('d4400000-0000-0000-0000-00000000000b', 'd4000000-0000-0000-0000-00000000000b', 'B Savings', true);

select set_config('cb4.a_everyday',
  (select id::text from public.tracked_balances
    where household_id = 'd4000000-0000-0000-0000-00000000000a' and is_everyday), true);
select set_config('cb4.b_everyday',
  (select id::text from public.tracked_balances
    where household_id = 'd4000000-0000-0000-0000-00000000000b' and is_everyday), true);

-- ---------------------------------------------------------------------------
-- S: structure and grants
-- ---------------------------------------------------------------------------

select col_not_null('public', 'payment_plans', 'tracked_balance_id',
  'S1: payment_plans.tracked_balance_id is NOT NULL');

select ok(
  to_regclass('public.payment_plans_member_balance_active_key') is not null
  and to_regclass('public.payment_plans_member_id_active_key') is null,
  'S2: the per-(member, balance) active index exists; the old per-member one is gone'
);

select ok(
  (select indisunique and indpred is not null
     from pg_catalog.pg_index
    where indexrelid = to_regclass('public.payment_plans_member_balance_active_key')),
  'S3: the new index is a partial UNIQUE index'
);

select ok(
  to_regprocedure('public.create_payment_plan(uuid,bigint,integer,date,date,uuid)') is not null
  and to_regprocedure('public.create_payment_plan(uuid,bigint,integer,date,date)') is null,
  'S4: create_payment_plan has the six-argument signature only (old overload dropped)'
);

select ok(
  has_function_privilege('authenticated', 'public.create_payment_plan(uuid,bigint,integer,date,date,uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.create_payment_plan(uuid,bigint,integer,date,date,uuid)', 'EXECUTE'),
  'S5: authenticated (not anon) can EXECUTE create_payment_plan'
);

select ok(
  not has_function_privilege('authenticated', 'internal.payment_plans_default_balance()', 'EXECUTE')
  and not has_function_privilege('anon', 'internal.payment_plans_default_balance()', 'EXECUTE'),
  'S6: the default-balance trigger function is not executable by app roles'
);

select ok(
  exists (select 1 from pg_catalog.pg_constraint
           where conname = 'payment_plans_tracked_balance_household_fk' and contype = 'f'),
  'S7: the same-household composite foreign key exists'
);

select is_empty(
  $$ select pl.id from public.payment_plans pl
      where not exists (select 1 from public.tracked_balances tb
                         where tb.id = pl.tracked_balance_id and tb.household_id = pl.household_id) $$,
  'S8: every plan in the database points at a balance of its own household'
);

-- ---------------------------------------------------------------------------
-- P: old-shape call = Everyday plan; coexisting plans on different balances
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"d4100000-0000-0000-0000-000000000001","role":"authenticated"}';

-- Exactly the five-argument call shape the front end sends today.
select isnt(
  set_config('cb4.plan_ev', (select id::text from public.create_payment_plan(
    'd4200000-0000-0000-0000-000000000002', 1000, 15, '2020-01-10'::date)), true),
  null,
  'P1: an old-shape (no balance) create_payment_plan call succeeds'
);

select is(
  (select tracked_balance_id::text from public.payment_plans where id = current_setting('cb4.plan_ev')::uuid),
  current_setting('cb4.a_everyday'),
  'P2: an old-shape plan lands on the household''s Everyday balance'
);

select isnt(
  set_config('cb4.plan_car', (select id::text from public.create_payment_plan(
    'd4200000-0000-0000-0000-000000000002', 1500, 15, '2020-01-10'::date, null,
    'd4400000-0000-0000-0000-000000000001')), true),
  null,
  'P3: a Car plan for the same child succeeds'
);

select isnt(
  set_config('cb4.plan_col', (select id::text from public.create_payment_plan(
    p_member_id => 'd4200000-0000-0000-0000-000000000002',
    p_minimum_cents => 1500, p_due_day => 15, p_starts_on => '2020-01-10'::date,
    p_tracked_balance_id => 'd4400000-0000-0000-0000-000000000002')), true),
  null,
  'P4: a College plan (named parameters) for the same child succeeds'
);

select is(
  (select string_agg(tb.name, ',' order by tb.name)
     from public.payment_plans pl
     join public.tracked_balances tb on tb.id = pl.tracked_balance_id
    where pl.member_id = 'd4200000-0000-0000-0000-000000000002' and pl.active),
  'Car,College,Everyday',
  'P5: three plans for one child, one per balance, are all active together'
);

reset role;

-- Periods for the three plans (window Jan 10 -> Feb 10 2020), inserted as
-- the owner like test 005 does.
insert into public.payment_periods
  (id, payment_plan_id, household_id, member_id, period_start, due_date, minimum_cents) values
  ('d4600000-0000-0000-0000-000000000001', current_setting('cb4.plan_ev')::uuid,
   'd4000000-0000-0000-0000-00000000000a', 'd4200000-0000-0000-0000-000000000002',
   '2020-01-10', '2020-01-15', 1000),
  ('d4600000-0000-0000-0000-000000000002', current_setting('cb4.plan_car')::uuid,
   'd4000000-0000-0000-0000-00000000000a', 'd4200000-0000-0000-0000-000000000002',
   '2020-01-10', '2020-01-15', 1500),
  ('d4600000-0000-0000-0000-000000000003', current_setting('cb4.plan_col')::uuid,
   'd4000000-0000-0000-0000-00000000000a', 'd4200000-0000-0000-0000-000000000002',
   '2020-01-10', '2020-01-15', 1500);

-- ---------------------------------------------------------------------------
-- SP: split payments count each part only toward its own balance's plan
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"d4100000-0000-0000-0000-000000000001","role":"authenticated"}';

select lives_ok(
  $$ select public.record_payment('d4200000-0000-0000-0000-000000000002', -3000, 'split', '2020-01-12', null, null,
       '[{"tracked_balance_id":"d4400000-0000-0000-0000-000000000001","amount_cents":2000},
         {"tracked_balance_id":"d4400000-0000-0000-0000-000000000002","amount_cents":1000}]') $$,
  'SP1: a split payment (Car 2000 + College 1000) is recorded'
);

select is(
  (select status || '/' || paid_cents || '/' || remaining_cents
     from public.payment_period_status('d4600000-0000-0000-0000-000000000002')),
  'satisfied/2000/-500',
  'SP2: the Car plan counts only its 2000 part'
);

select is(
  (select status || '/' || paid_cents || '/' || remaining_cents
     from public.payment_period_status('d4600000-0000-0000-0000-000000000003')),
  'overdue/1000/500',
  'SP3: the College plan counts only its 1000 part (overdue: past the 15th)'
);

select is(
  (select status || '/' || paid_cents || '/' || remaining_cents
     from public.payment_period_status('d4600000-0000-0000-0000-000000000001')),
  'overdue/0/1000',
  'SP4: the Everyday plan counts neither part'
);

select lives_ok(
  $$ select public.record_payment('d4200000-0000-0000-0000-000000000002', -1000, 'plain', '2020-01-13') $$,
  'SP5: an old-shape payment (whole amount to Everyday) is recorded'
);

select is(
  (select status || '/' || paid_cents from public.payment_period_status('d4600000-0000-0000-0000-000000000001')),
  'satisfied/1000',
  'SP6: the Everyday plan counts the plain payment (Everyday behaviour unchanged)'
);

select is(
  (select paid_cents from public.payment_period_status('d4600000-0000-0000-0000-000000000002')),
  2000::bigint,
  'SP7: the plain Everyday payment does not count toward the Car plan'
);

select lives_ok(
  $$ select public.record_adjustment('d4200000-0000-0000-0000-000000000002', -400, 'adj', '2020-01-14', null, null,
       '[{"tracked_balance_id":"d4400000-0000-0000-0000-000000000001","amount_cents":400}]') $$,
  'SP8: an adjustment allocated to Car is recorded'
);

select is(
  (select paid_cents from public.payment_period_status('d4600000-0000-0000-0000-000000000002')),
  2000::bigint,
  'SP9: an adjustment on the plan''s balance never counts'
);

select lives_ok(
  $$ select set_config('cb4.void_me', (select id::text from public.record_payment(
       'd4200000-0000-0000-0000-000000000002', -5000, 'to void', '2020-01-20', null, null,
       '[{"tracked_balance_id":"d4400000-0000-0000-0000-000000000001","amount_cents":5000}]')), true) $$,
  'SP10: a further Car payment inside the window is recorded'
);

select is(
  (select paid_cents from public.payment_period_status('d4600000-0000-0000-0000-000000000002')),
  7000::bigint,
  'SP11: the Car plan now counts 2000 + 5000'
);

select lives_ok(
  $$ select public.void_ledger_transaction(current_setting('cb4.void_me')::uuid, 'entered in error') $$,
  'SP12: a Parent voids that payment'
);

select is(
  (select paid_cents from public.payment_period_status('d4600000-0000-0000-0000-000000000002')),
  2000::bigint,
  'SP13: the voided payment''s part no longer counts'
);

select lives_ok(
  $$ select public.record_payment('d4200000-0000-0000-0000-000000000002', -700, 'next month', '2020-02-10', null, null,
       '[{"tracked_balance_id":"d4400000-0000-0000-0000-000000000001","amount_cents":700}]');
     select public.record_payment('d4200000-0000-0000-0000-000000000002', -600, 'before window', '2020-01-09', null, null,
       '[{"tracked_balance_id":"d4400000-0000-0000-0000-000000000002","amount_cents":600}]') $$,
  'SP14: payments on the day the next window starts and the day before this one starts are recorded'
);

select is(
  (select paid_cents from public.payment_period_status('d4600000-0000-0000-0000-000000000002')),
  2000::bigint,
  'SP15: the month-window rule is unchanged: a Car part dated Feb 10 is outside the Jan window'
);

select is(
  (select paid_cents from public.payment_period_status('d4600000-0000-0000-0000-000000000003')),
  1000::bigint,
  'SP16: a College part dated Jan 9 is before the Jan window'
);

reset role;

-- The Child sees the same statuses (RLS on payments and parts lets them read
-- their own), and a sibling sees nothing.
set local role authenticated;
set local request.jwt.claims to '{"sub":"d4100000-0000-0000-0000-000000000002","role":"authenticated"}';

select is(
  (select string_agg(s.status || '/' || s.paid_cents, ',' order by s.period_id)
     from (select * from public.payment_period_status('d4600000-0000-0000-0000-000000000001')
           union all select * from public.payment_period_status('d4600000-0000-0000-0000-000000000002')
           union all select * from public.payment_period_status('d4600000-0000-0000-0000-000000000003')) s),
  'satisfied/1000,satisfied/2000,overdue/1000',
  'SP17: the Child reads the same per-balance statuses for their own plans'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"d4100000-0000-0000-0000-000000000003","role":"authenticated"}';

select is_empty(
  $$ select * from public.payment_period_status('d4600000-0000-0000-0000-000000000002') $$,
  'SP18: a sibling Child gets no status rows for another child''s plan'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"d4100000-0000-0000-0000-000000000005","role":"authenticated"}';

select is_empty(
  $$ select * from public.payment_period_status('d4600000-0000-0000-0000-000000000002') $$,
  'SP19: the Parent of another household gets no status rows'
);

reset role;

-- ---------------------------------------------------------------------------
-- SU: superseding is per balance; audit carries the balance
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"d4100000-0000-0000-0000-000000000001","role":"authenticated"}';

select isnt(
  set_config('cb4.plan_car2', (select id::text from public.create_payment_plan(
    'd4200000-0000-0000-0000-000000000002', 1800, 20, '2020-02-10'::date, null,
    'd4400000-0000-0000-0000-000000000001')), true),
  null,
  'SU1: a replacement Car plan is created'
);

reset role;

select is(
  (select active::text from public.payment_plans where id = current_setting('cb4.plan_car')::uuid)
  || '/' ||
  (select active::text from public.payment_plans where id = current_setting('cb4.plan_car2')::uuid),
  'false/true',
  'SU2: only the old Car plan was deactivated; the new one is active'
);

select is(
  (select count(*) from public.payment_plans
    where id in (current_setting('cb4.plan_ev')::uuid, current_setting('cb4.plan_col')::uuid) and active),
  2::bigint,
  'SU3: the Everyday and College plans were left active'
);

select is(
  (select (new_values ->> 'tracked_balance_id') || '/' || (old_values ->> 'id')
     from public.audit_log
    where entity_type = 'payment_plans' and action = 'create'
      and entity_id = current_setting('cb4.plan_car2')::uuid),
  'd4400000-0000-0000-0000-000000000001/' || current_setting('cb4.plan_car'),
  'SU4: the audit row has the new plan''s balance in new_values and the superseded Car plan in old_values'
);

select is(
  (select old_values from public.audit_log
    where entity_type = 'payment_plans' and action = 'create'
      and entity_id = current_setting('cb4.plan_ev')::uuid),
  null,
  'SU5: the first plan''s audit row has no old_values (nothing was superseded)'
);

set local role authenticated;
set local request.jwt.claims to '{"sub":"d4100000-0000-0000-0000-000000000001","role":"authenticated"}';

select isnt(
  set_config('cb4.plan_ev2', (select id::text from public.create_payment_plan(
    'd4200000-0000-0000-0000-000000000002', 1100, 15, '2020-02-10'::date, null,
    current_setting('cb4.a_everyday')::uuid)), true),
  null,
  'SU6: an explicit Everyday balance id is accepted'
);

reset role;

select is(
  (select active from public.payment_plans where id = current_setting('cb4.plan_ev')::uuid),
  false,
  'SU7: an explicit-Everyday plan supersedes the old-shape (null) Everyday plan: same balance'
);

select is(
  (select count(*) from public.payment_plans
    where member_id = 'd4200000-0000-0000-0000-000000000002' and active),
  3::bigint,
  'SU8: the child still has exactly three active plans (Everyday, College, Car)'
);

-- ---------------------------------------------------------------------------
-- R: rejections as the Parent (nothing written)
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"d4100000-0000-0000-0000-000000000001","role":"authenticated"}';

select throws_ok(
  $$ select public.create_payment_plan('d4200000-0000-0000-0000-000000000003', 1000, 15, '2020-01-10', null,
       'd4400000-0000-0000-0000-00000000000b') $$,
  '23514', 'no such balance in this household: d4400000-0000-0000-0000-00000000000b',
  'R1: another household''s balance is rejected'
);

select throws_ok(
  $$ select public.create_payment_plan('d4200000-0000-0000-0000-000000000003', 1000, 15, '2020-01-10', null,
       'd4400000-0000-0000-0000-0000000000ff') $$,
  '23514', 'no such balance in this household: d4400000-0000-0000-0000-0000000000ff',
  'R2: a nonexistent balance gets the same rejection as a foreign one'
);

select throws_ok(
  $$ select public.create_payment_plan('d4200000-0000-0000-0000-000000000003', 1000, 15, '2020-01-10', null,
       'd4400000-0000-0000-0000-000000000003') $$,
  '23514', 'balance "Old" is archived and cannot have a payment plan',
  'R3: an archived balance is rejected'
);

select throws_ok(
  $$ select public.create_payment_plan('d4200000-0000-0000-0000-000000000006', 1000, 15, '2020-01-10', null,
       'd4400000-0000-0000-0000-000000000001') $$,
  '42501', 'only an active Parent may create a payment plan',
  'R4: a Parent of A cannot create a plan for B''s child, even on A''s own balance'
);

select throws_ok(
  $$ select public.create_payment_plan('d4200000-0000-0000-0000-000000000001', 1000, 15, '2020-01-10', null,
       'd4400000-0000-0000-0000-000000000001') $$,
  '42501', 'payment plans may only be created for a child member',
  'R5: a plan cannot be created for a Parent member on any balance'
);

select throws_ok(
  $$ select public.create_payment_plan('d4200000-0000-0000-0000-000000000003', 0, 15, '2020-01-10', null,
       'd4400000-0000-0000-0000-000000000001') $$,
  '23514', null,
  'R6: the existing positive-minimum check still applies on a Car plan'
);

reset role;

select is(
  (select count(*) from public.payment_plans where member_id = 'd4200000-0000-0000-0000-000000000003'),
  0::bigint,
  'R7: no plan row exists for C2 after every rejected call'
);

-- ---------------------------------------------------------------------------
-- CH: Child cannot create or alter plans on any balance
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"d4100000-0000-0000-0000-000000000002","role":"authenticated"}';

select throws_ok(
  $$ select public.create_payment_plan('d4200000-0000-0000-0000-000000000002', 1, 1, '2020-01-10') $$,
  '42501', 'only an active Parent may create a payment plan',
  'CH1: a Child cannot create an Everyday plan for themselves'
);

select throws_ok(
  $$ select public.create_payment_plan('d4200000-0000-0000-0000-000000000002', 1, 1, '2020-01-10', null,
       'd4400000-0000-0000-0000-000000000001') $$,
  '42501', 'only an active Parent may create a payment plan',
  'CH2: a Child cannot create a Car plan for themselves'
);

select throws_ok(
  $$ select public.create_payment_plan('d4200000-0000-0000-0000-000000000002', 1, 1, '2020-01-10', null,
       'd4400000-0000-0000-0000-00000000000b') $$,
  '42501', 'only an active Parent may create a payment plan',
  'CH3: authorization is checked before the balance (a Child learns nothing about balances)'
);

select throws_ok(
  $$ select public.deactivate_payment_plan(current_setting('cb4.plan_car2')::uuid) $$,
  '42501', null,
  'CH4: a Child cannot deactivate a per-balance plan'
);

select throws_ok(
  $$ insert into public.payment_plans (household_id, member_id, tracked_balance_id, minimum_cents, due_day, starts_on, created_by)
     values ('d4000000-0000-0000-0000-00000000000a', 'd4200000-0000-0000-0000-000000000002',
             'd4400000-0000-0000-0000-000000000003', 1, 1, '2020-01-10', 'd4200000-0000-0000-0000-000000000002') $$,
  '42501', null,
  'CH5: a Child cannot INSERT a plan row directly'
);

-- No write policy exists, so RLS hides every row from UPDATE/DELETE: zero
-- rows affected rather than an error.
select is_empty(
  $$ with u as (
       update public.payment_plans set tracked_balance_id = current_setting('cb4.a_everyday')::uuid,
                                       minimum_cents = 1
        where id = current_setting('cb4.plan_car2')::uuid
        returning 1)
     select * from u $$,
  'CH6: a Child cannot UPDATE (move to another balance, shrink) a plan directly'
);

select is_empty(
  $$ with d as (
       delete from public.payment_plans where id = current_setting('cb4.plan_car2')::uuid
       returning 1)
     select * from d $$,
  'CH7: a Child cannot DELETE a plan directly'
);

select is(
  (select count(*) from public.payment_plans),
  5::bigint,
  'CH8: the Child reads exactly their own five plans (three active + two superseded)'
);

reset role;

select is(
  (select minimum_cents from public.payment_plans where id = current_setting('cb4.plan_car2')::uuid),
  1800::bigint,
  'CH9: the Car plan is unchanged after every Child attempt'
);

-- ---------------------------------------------------------------------------
-- X: cross-household, outsider, anon
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"d4100000-0000-0000-0000-000000000005","role":"authenticated"}';

select is(
  (select count(*) from public.payment_plans where household_id = 'd4000000-0000-0000-0000-00000000000a'),
  0::bigint,
  'X1: the Parent of B reads none of A''s plans'
);

select throws_ok(
  $$ select public.create_payment_plan('d4200000-0000-0000-0000-000000000002', 1000, 15, '2020-01-10', null,
       'd4400000-0000-0000-0000-00000000000b') $$,
  '42501', 'only an active Parent may create a payment plan',
  'X2: the Parent of B cannot create a plan for A''s child, even on B''s own balance'
);

select throws_ok(
  $$ select public.create_payment_plan('d4200000-0000-0000-0000-000000000006', 1000, 15, '2020-01-10', null,
       'd4400000-0000-0000-0000-000000000001') $$,
  '23514', 'no such balance in this household: d4400000-0000-0000-0000-000000000001',
  'X3: the Parent of B cannot put their own child''s plan on A''s balance'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"d4100000-0000-0000-0000-000000000007","role":"authenticated"}';

select is(
  (select count(*) from public.payment_plans),
  0::bigint,
  'X4: an authenticated non-member reads no plans'
);

select throws_ok(
  $$ select public.create_payment_plan('d4200000-0000-0000-0000-000000000002', 1000, 15, '2020-01-10') $$,
  '42501', null,
  'X5: an authenticated non-member cannot create a plan'
);

reset role;
set local role anon;
set local request.jwt.claims to '{"role":"anon"}';

select throws_ok(
  $$ select public.create_payment_plan('d4200000-0000-0000-0000-000000000002', 1000, 15, '2020-01-10', null,
       'd4400000-0000-0000-0000-000000000001') $$,
  '42501', null,
  'X6: anon cannot call create_payment_plan'
);

reset role;

-- ---------------------------------------------------------------------------
-- D: database-level enforcement, even for postgres
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ insert into public.payment_plans (household_id, member_id, tracked_balance_id, minimum_cents, due_day, starts_on, created_by)
     values ('d4000000-0000-0000-0000-00000000000a', 'd4200000-0000-0000-0000-000000000002',
             'd4400000-0000-0000-0000-000000000001', 1, 1, '2020-01-10', 'd4200000-0000-0000-0000-000000000001') $$,
  '23505', null,
  'D1: a second active plan for the same (member, balance) violates the unique index'
);

select throws_ok(
  $$ insert into public.payment_plans (household_id, member_id, tracked_balance_id, minimum_cents, due_day, starts_on, created_by)
     values ('d4000000-0000-0000-0000-00000000000a', 'd4200000-0000-0000-0000-000000000003',
             'd4400000-0000-0000-0000-00000000000b', 1, 1, '2020-01-10', 'd4200000-0000-0000-0000-000000000001') $$,
  '23503', null,
  'D2: a plan cannot point at another household''s balance (composite FK)'
);

select lives_ok(
  $$ insert into public.payment_plans (id, household_id, member_id, minimum_cents, due_day, starts_on, active, created_by)
     values ('d4700000-0000-0000-0000-000000000001', 'd4000000-0000-0000-0000-00000000000a',
             'd4200000-0000-0000-0000-000000000003', 1, 1, '2020-01-10', false, 'd4200000-0000-0000-0000-000000000001') $$,
  'D3: a plan inserted without a balance is accepted (older fixtures and owner repairs)'
);

select is(
  (select tracked_balance_id::text from public.payment_plans where id = 'd4700000-0000-0000-0000-000000000001'),
  current_setting('cb4.a_everyday'),
  'D4: ... and the trigger put it on its household''s Everyday balance'
);

select throws_ok(
  $$ update public.payment_plans set tracked_balance_id = null
      where id = 'd4700000-0000-0000-0000-000000000001' $$,
  '23502', null,
  'D5: a plan can never be left without a balance'
);

-- ---------------------------------------------------------------------------
-- AR: archiving a balance an active plan points at
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"d4100000-0000-0000-0000-000000000001","role":"authenticated"}';

select throws_ok(
  $$ select public.update_tracked_balance('d4400000-0000-0000-0000-000000000002', null, null, false) $$,
  '23514', 'balance "College" still has an active payment plan; deactivate or replace that plan first',
  'AR1: a balance with an active plan cannot be archived'
);

select lives_ok(
  $$ select public.deactivate_payment_plan(current_setting('cb4.plan_col')::uuid) $$,
  'AR2: the Parent deactivates the College plan'
);

select lives_ok(
  $$ select public.update_tracked_balance('d4400000-0000-0000-0000-000000000002', null, null, false) $$,
  'AR3: with only an inactive plan left, the balance can be archived'
);

select throws_ok(
  $$ select public.create_payment_plan('d4200000-0000-0000-0000-000000000003', 1000, 15, '2020-01-10', null,
       'd4400000-0000-0000-0000-000000000002') $$,
  '23514', 'balance "College" is archived and cannot have a payment plan',
  'AR4: ... and then a new plan on it is refused'
);

reset role;

select is(
  (select tracked_balance_id::text from public.payment_plans where id = current_setting('cb4.plan_col')::uuid),
  'd4400000-0000-0000-0000-000000000002',
  'AR5: the deactivated plan keeps its balance as history'
);

-- ---------------------------------------------------------------------------
-- E: periods and the rest of the plan machinery still work per plan
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"d4100000-0000-0000-0000-000000000001","role":"authenticated"}';

select isnt(
  set_config('cb4.plan_c2car', (select id::text from public.create_payment_plan(
    'd4200000-0000-0000-0000-000000000003', 900, 5, '2099-01-03'::date, null,
    'd4400000-0000-0000-0000-000000000001')), true),
  null,
  'E1: a Car plan for the second child is created'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"d4100000-0000-0000-0000-000000000003","role":"authenticated"}';

select is(
  (select (period_start, due_date, minimum_cents)::text
     from public.ensure_current_payment_period(current_setting('cb4.plan_c2car')::uuid)),
  ('2099-01-03'::date, '2099-01-05'::date, 900::bigint)::text,
  'E2: ensure_current_payment_period works unchanged for a Car plan, called as the Child'
);

select is(
  (select status || '/' || paid_cents from public.payment_period_status(
     (select id from public.payment_periods where payment_plan_id = current_setting('cb4.plan_c2car')::uuid))),
  'upcoming/0',
  'E3: a not-yet-started Car plan reads upcoming with nothing paid'
);

reset role;

select * from finish();

rollback;
