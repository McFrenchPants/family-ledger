-- Regression tests: P2.5 -- payment plan privilege-escalation and integrity.
--
-- This is the suite that gates Phase 2 Stage 2 (the UI layer): nothing
-- proceeds past Phase 2's Stage 1 until every case here is green. It covers
-- the P2.1 schema (20260905030000_payment_plans_schema.sql), the P2.2 RLS
-- policies (20260905040000_payment_plans_rls_policies.sql), the P2.3
-- write-time RPCs (20260905050000_payment_plans_write_functions.sql), and the
-- P2.4 status derivation (20260905060000_payment_period_status.sql).
--
-- Role-switching within pgTAP's superuser-only constraint follows
-- 003_ledger_privilege_escalation.sql's convention exactly:
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<household_members.user_id>","role":"authenticated"}';
--   ... pgTAP assertions ...
--   reset role;
--
-- Self-contained: creates its own fixtures, depends on nothing in seed.sql,
-- and the whole file runs inside begin/rollback so the database is left
-- exactly as it was found.
--
-- Run with: npm run test:db  (wraps `npx supabase test db --local`)

begin;

create extension if not exists pgtap with schema extensions;
set local search_path to extensions, public, pg_catalog;

select plan(53);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
--
-- Household A: Parent P1, children C1 (has the main plan under test) and C2
-- (sibling, used for the RLS self-vs-sibling case).
-- Household B: Parent P2, child C3. Used only to prove cross-household
-- isolation.

insert into public.households (id, name, timezone, child_expense_scope) values
  ('10000000-0000-0000-0000-00000000000a', 'Household A', 'America/Chicago', 'any_member'),
  ('10000000-0000-0000-0000-00000000000b', 'Household B', 'Europe/Paris', 'any_member');

insert into auth.users (id, email) values
  ('20000000-0000-0000-0000-000000000001', 'p1@example.test'),
  ('20000000-0000-0000-0000-000000000002', 'c1@example.test'),
  ('20000000-0000-0000-0000-000000000003', 'c2@example.test'),
  ('20000000-0000-0000-0000-000000000004', 'p2@example.test'),
  ('20000000-0000-0000-0000-000000000005', 'c3@example.test');

insert into public.household_members (id, household_id, user_id, name, role, status) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000a',
   '20000000-0000-0000-0000-000000000001', 'Parent One',  'parent', 'active'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-00000000000a',
   '20000000-0000-0000-0000-000000000002', 'Child One',   'child',  'active'),
  ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-00000000000a',
   '20000000-0000-0000-0000-000000000003', 'Child Two',   'child',  'active'),
  ('30000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-00000000000b',
   '20000000-0000-0000-0000-000000000004', 'Parent Two',  'parent', 'active'),
  ('30000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-00000000000b',
   '20000000-0000-0000-0000-000000000005', 'Child Three', 'child',  'active');

-- ---------------------------------------------------------------------------
-- Case 1: Child attempts create_payment_plan -- rejected, no row created.
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"20000000-0000-0000-0000-000000000002","role":"authenticated"}';

select throws_ok(
  $$ select public.create_payment_plan('30000000-0000-0000-0000-000000000002', 1000, 1, current_date) $$,
  '42501',
  null,
  'Case 1: Child create_payment_plan against their own member_id is rejected (Parent-only)'
);

reset role;

select is(
  (select count(*) from public.payment_plans),
  0::bigint,
  'Case 1: no payment_plans row exists after the rejected Child create_payment_plan'
);

-- ---------------------------------------------------------------------------
-- Fixture: Parent creates a real plan for C1, used by the remaining cases.
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"20000000-0000-0000-0000-000000000001","role":"authenticated"}';

create temp table tmp_plan_c1 as
select * from public.create_payment_plan(
  '30000000-0000-0000-0000-000000000002', 5000, 15, '2026-01-01'::date
);

reset role;

-- Household B's Parent creates a plan for C3, used by cross-household cases.

set local role authenticated;
set local request.jwt.claims to '{"sub":"20000000-0000-0000-0000-000000000004","role":"authenticated"}';

create temp table tmp_plan_c3 as
select * from public.create_payment_plan(
  '30000000-0000-0000-0000-000000000005', 3000, 10, '2026-01-01'::date
);

reset role;

select ok(
  (select id from tmp_plan_c1) is not null and (select id from tmp_plan_c3) is not null,
  'Fixture: both Parents successfully created a payment plan for their own child'
);

-- ---------------------------------------------------------------------------
-- Case 2: Child attempts deactivate_payment_plan on a real plan -- rejected.
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"20000000-0000-0000-0000-000000000002","role":"authenticated"}';

select throws_ok(
  format($$ select public.deactivate_payment_plan('%s') $$, (select id from tmp_plan_c1)),
  '42501',
  null,
  'Case 2: Child deactivate_payment_plan on their own plan is rejected (Parent-only)'
);

reset role;

select ok(
  (select active from public.payment_plans where id = (select id from tmp_plan_c1)),
  'Case 2: the plan remains active after the rejected Child deactivate_payment_plan'
);

-- ---------------------------------------------------------------------------
-- Fixture: materialize C1's and C3's current period, for the waive cases.
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"20000000-0000-0000-0000-000000000001","role":"authenticated"}';

create temp table tmp_period_c1 as
select * from public.ensure_current_payment_period((select id from tmp_plan_c1));

reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"20000000-0000-0000-0000-000000000004","role":"authenticated"}';

create temp table tmp_period_c3 as
select * from public.ensure_current_payment_period((select id from tmp_plan_c3));

reset role;

-- ---------------------------------------------------------------------------
-- Case 3: Child attempts waive_payment_period on a real period -- rejected.
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"20000000-0000-0000-0000-000000000002","role":"authenticated"}';

select throws_ok(
  format($$ select public.waive_payment_period('%s', 'child waive attempt') $$, (select id from tmp_period_c1)),
  '42501',
  null,
  'Case 3: Child waive_payment_period on their own period is rejected (Parent-only)'
);

reset role;

select ok(
  (select waived_at from public.payment_periods where id = (select id from tmp_period_c1)) is null,
  'Case 3: the period remains un-waived after the rejected Child waive_payment_period'
);

-- ---------------------------------------------------------------------------
-- Case 4: Parent of household A targets a household-B member/plan/period --
-- all rejected.
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"20000000-0000-0000-0000-000000000001","role":"authenticated"}';

select throws_ok(
  $$ select public.create_payment_plan('30000000-0000-0000-0000-000000000005', 1000, 1, current_date) $$,
  '42501',
  null,
  'Case 4a: Household A Parent create_payment_plan targeting a household-B member is rejected'
);

select throws_ok(
  format($$ select public.deactivate_payment_plan('%s') $$, (select id from tmp_plan_c3)),
  '42501',
  null,
  'Case 4b: Household A Parent deactivate_payment_plan on a household-B plan is rejected'
);

select throws_ok(
  format($$ select public.waive_payment_period('%s', 'cross household waive attempt') $$, (select id from tmp_period_c3)),
  '42501',
  null,
  'Case 4c: Household A Parent waive_payment_period on a household-B period is rejected'
);

reset role;

select ok(
  (select active from public.payment_plans where id = (select id from tmp_plan_c3)),
  'Case 4b check: household-B plan remains active after the rejected cross-household deactivate'
);

select ok(
  (select waived_at from public.payment_periods where id = (select id from tmp_period_c3)) is null,
  'Case 4c check: household-B period remains un-waived after the rejected cross-household waive'
);

-- ---------------------------------------------------------------------------
-- Case 5: Child SELECT scoping -- sees only their own plan/period rows, not a
-- sibling's, not another household's. C2 has no plan of their own, so this
-- also proves "zero rows visible" is not a fluke of C2 owning nothing.
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"20000000-0000-0000-0000-000000000003","role":"authenticated"}';

select is(
  (select count(*) from public.payment_plans where member_id = '30000000-0000-0000-0000-000000000002'),
  0::bigint,
  'Case 5a: Child (C2) sees zero rows of a sibling''s (C1) payment_plans'
);

select is(
  (select count(*) from public.payment_periods where member_id = '30000000-0000-0000-0000-000000000002'),
  0::bigint,
  'Case 5b: Child (C2) sees zero rows of a sibling''s (C1) payment_periods'
);

select is(
  (select count(*) from public.payment_plans where household_id = '10000000-0000-0000-0000-00000000000b'),
  0::bigint,
  'Case 5c: Child (C2) sees zero rows of another household''s payment_plans'
);

reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"20000000-0000-0000-0000-000000000002","role":"authenticated"}';

select ok(
  (select count(*) from public.payment_plans where id = (select id from tmp_plan_c1)) = 1,
  'Case 5 (positive control): Child (C1) DOES see their own payment_plans row'
);

select ok(
  (select count(*) from public.payment_periods where id = (select id from tmp_period_c1)) = 1,
  'Case 5 (positive control): Child (C1) DOES see their own payment_periods row'
);

reset role;

-- ---------------------------------------------------------------------------
-- Case 6: raw INSERT/UPDATE/DELETE against payment_plans/payment_periods,
-- bypassing the RPCs, rejected for both anon and authenticated regardless of
-- role -- no write policy exists on either table (P2.2).
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"20000000-0000-0000-0000-000000000001","role":"authenticated"}';

-- Unlike UPDATE/DELETE (which silently match zero rows when no policy exists
-- for that command), an INSERT with no WITH CHECK policy for the role is
-- rejected by Postgres RLS as an error (42501), not a silent zero-row
-- affect -- confirmed via throws_ok rather than a temp-table row count.
select throws_ok(
  $$
    insert into public.payment_plans
      (household_id, member_id, minimum_cents, due_day, starts_on, active, created_by)
    values
      ('10000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-000000000003',
       100, 1, current_date, true, '30000000-0000-0000-0000-000000000001')
  $$,
  '42501',
  null,
  'Case 6a: authenticated direct INSERT into payment_plans is rejected by RLS (no INSERT policy), even as a Parent'
);

create temp table tmp_case6b as
with upd as (
  update public.payment_plans
     set minimum_cents = 999999
   where id = (select id from tmp_plan_c1)
   returning 1
)
select count(*) as affected from upd;

select is(
  (select affected from tmp_case6b),
  0::bigint,
  'Case 6b: authenticated direct UPDATE of payment_plans affects zero rows (no UPDATE policy), even as a Parent'
);

create temp table tmp_case6c as
with del as (
  delete from public.payment_periods
   where id = (select id from tmp_period_c1)
   returning 1
)
select count(*) as affected from del;

select is(
  (select affected from tmp_case6c),
  0::bigint,
  'Case 6c: authenticated direct DELETE of payment_periods affects zero rows (no DELETE policy), even as a Parent'
);

reset role;

set local role anon;

select throws_ok(
  $$
    insert into public.payment_plans
      (household_id, member_id, minimum_cents, due_day, starts_on, active, created_by)
    values
      ('10000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-000000000003',
       100, 1, current_date, true, '30000000-0000-0000-0000-000000000001')
  $$,
  '42501',
  null,
  'Case 6d: anon direct INSERT into payment_plans is rejected'
);

reset role;

-- ---------------------------------------------------------------------------
-- Case 7: anon cannot execute any of the five payment-plan functions.
-- P1.3's documented history: `revoke ... from public` alone is not
-- sufficient against Supabase's default-privilege grant of EXECUTE to anon.
-- ---------------------------------------------------------------------------

select is(
  has_function_privilege('anon', 'public.create_payment_plan(uuid, bigint, integer, date, date)', 'execute'),
  false,
  'Case 7a: anon cannot execute create_payment_plan'
);

select is(
  has_function_privilege('anon', 'public.deactivate_payment_plan(uuid)', 'execute'),
  false,
  'Case 7b: anon cannot execute deactivate_payment_plan'
);

select is(
  has_function_privilege('anon', 'public.ensure_current_payment_period(uuid)', 'execute'),
  false,
  'Case 7c: anon cannot execute ensure_current_payment_period'
);

select is(
  has_function_privilege('anon', 'public.waive_payment_period(uuid, text)', 'execute'),
  false,
  'Case 7d: anon cannot execute waive_payment_period'
);

select is(
  has_function_privilege('anon', 'public.payment_period_status(uuid)', 'execute'),
  false,
  'Case 7e: anon cannot execute payment_period_status'
);

-- ---------------------------------------------------------------------------
-- Case 8: at most one active plan per member, enforced at the schema level
-- (raw second active-plan insert, as an elevated role) AND via
-- create_payment_plan's atomic supersede behavior.
-- ---------------------------------------------------------------------------

select throws_ok(
  $$
    insert into public.payment_plans
      (household_id, member_id, minimum_cents, due_day, starts_on, active, created_by)
    values
      ('10000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-000000000002',
       200, 5, current_date, true, '30000000-0000-0000-0000-000000000001')
  $$,
  '23505',
  null,
  'Case 8a: a raw second active-plan insert for the same member is rejected by the partial unique index'
);

set local role authenticated;
set local request.jwt.claims to '{"sub":"20000000-0000-0000-0000-000000000001","role":"authenticated"}';

create temp table tmp_plan_c1_v2 as
select * from public.create_payment_plan(
  '30000000-0000-0000-0000-000000000002', 6000, 20, '2026-02-01'::date
);

reset role;

select ok(
  not (select active from public.payment_plans where id = (select id from tmp_plan_c1)),
  'Case 8b: create_payment_plan''s supersede flips the OLD plan to inactive'
);

select ok(
  (select active from tmp_plan_c1_v2),
  'Case 8c: create_payment_plan''s supersede leaves the NEW plan active'
);

select is(
  (select count(*) from public.payment_plans
    where member_id = '30000000-0000-0000-0000-000000000002' and active),
  1::bigint,
  'Case 8d: exactly one active plan exists for the member after supersede -- never zero, never two'
);

-- ---------------------------------------------------------------------------
-- Case 9: waive all-or-nothing constraint -- a raw partial-waive insert is
-- rejected.
-- ---------------------------------------------------------------------------

select throws_ok(
  $$
    insert into public.payment_periods
      (payment_plan_id, household_id, member_id, period_start, due_date, minimum_cents, waived_at)
    select id, household_id, member_id, '2099-01-01'::date, '2099-01-15'::date, minimum_cents, now()
    from public.payment_plans
    where id = (select id from tmp_plan_c1_v2)
  $$,
  '23514',
  null,
  'Case 9: a raw insert with waived_at set but waived_by/waive_reason null is rejected (all-or-nothing check)'
);

-- ---------------------------------------------------------------------------
-- Case 10: waive_payment_period rejects null/empty/whitespace-only reasons,
-- and rejects an already-waived period.
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"20000000-0000-0000-0000-000000000001","role":"authenticated"}';

select throws_ok(
  format($$ select public.waive_payment_period('%s', null) $$, (select id from tmp_period_c1)),
  '23514',
  null,
  'Case 10a: waive_payment_period rejects a null reason'
);

select throws_ok(
  format($$ select public.waive_payment_period('%s', '') $$, (select id from tmp_period_c1)),
  '23514',
  null,
  'Case 10b: waive_payment_period rejects an empty-string reason'
);

select throws_ok(
  format($$ select public.waive_payment_period('%s', '   ') $$, (select id from tmp_period_c1)),
  '23514',
  null,
  'Case 10c: waive_payment_period rejects a whitespace-only reason'
);

create temp table tmp_period_c1_waived as
select * from public.waive_payment_period((select id from tmp_period_c1), 'family emergency');

select ok(
  (select waived_at from tmp_period_c1_waived) is not null,
  'Case 10d: waive_payment_period succeeds with a real reason'
);

select throws_ok(
  format($$ select public.waive_payment_period('%s', 'second waive attempt') $$, (select id from tmp_period_c1)),
  '23514',
  null,
  'Case 10e: waive_payment_period rejects an already-waived period'
);

reset role;

-- ---------------------------------------------------------------------------
-- Case 11: ensure_current_payment_period is idempotent -- two calls, one row.
-- Uses C3's plan/period (still un-waived), called by C3's own Parent twice.
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"20000000-0000-0000-0000-000000000004","role":"authenticated"}';

create temp table tmp_period_c3_again as
select * from public.ensure_current_payment_period((select id from tmp_plan_c3));

reset role;

select is(
  (select id from tmp_period_c3_again),
  (select id from tmp_period_c3),
  'Case 11a: a second ensure_current_payment_period call returns the SAME period row'
);

select is(
  (select count(*) from public.payment_periods where payment_plan_id = (select id from tmp_plan_c3)),
  1::bigint,
  'Case 11b: only one payment_periods row exists for the plan after two ensure_current_payment_period calls'
);

-- ---------------------------------------------------------------------------
-- Cases 12-18: payment_period_status derivation and allocation-window edges.
--
-- Built on a fresh plan for C2 (untouched by any of the above), with a
-- period whose window is entirely in the past relative to real "today", so
-- every status can be driven deterministically by inserting payments dated
-- within/outside that fixed window -- no dependency on the wall-clock date
-- this suite happens to run on.
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"20000000-0000-0000-0000-000000000001","role":"authenticated"}';

create temp table tmp_plan_c2 as
select * from public.create_payment_plan(
  '30000000-0000-0000-0000-000000000003', 10000, 15, '2020-01-01'::date, '2020-02-01'::date
);

reset role;

-- A period entirely in the past: period_start well before today, due_date
-- also before today (so, absent any status override, it would be 'overdue').
insert into public.payment_periods
  (id, payment_plan_id, household_id, member_id, period_start, due_date, minimum_cents)
values
  ('60000000-0000-0000-0000-000000000001', (select id from tmp_plan_c2),
   '10000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-000000000003',
   '2020-01-01'::date, '2020-01-15'::date, 10000);

-- Case 12: upcoming -- a second period whose period_start is in the future.
insert into public.payment_periods
  (id, payment_plan_id, household_id, member_id, period_start, due_date, minimum_cents)
values
  ('60000000-0000-0000-0000-000000000002', (select id from tmp_plan_c2),
   '10000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-000000000003',
   '2099-01-01'::date, '2099-01-15'::date, 10000);

select is(
  (select status from public.payment_period_status('60000000-0000-0000-0000-000000000002')),
  'upcoming',
  'Case 12: a period whose period_start is in the future reads ''upcoming'''
);

-- Case 13: due -- a period whose window has started (period_start in the
-- past, due_date in the future), with nothing paid.
insert into public.payment_periods
  (id, payment_plan_id, household_id, member_id, period_start, due_date, minimum_cents)
values
  ('60000000-0000-0000-0000-000000000003', (select id from tmp_plan_c2),
   '10000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-000000000003',
   '2020-02-01'::date, '2099-01-15'::date, 10000);

select is(
  (select status from public.payment_period_status('60000000-0000-0000-0000-000000000003')),
  'due',
  'Case 13: a started, unpaid, not-yet-due period reads ''due'''
);

-- Case 14: overdue -- period 1 (due_date 2020-01-15, long past), nothing paid.
select is(
  (select status from public.payment_period_status('60000000-0000-0000-0000-000000000001')),
  'overdue',
  'Case 14: a period past its due_date with nothing paid reads ''overdue'''
);

-- Case 15: partially_paid -- record a payment less than minimum_cents against
-- period 3 (still not due), dated inside its allocation window.
set local role authenticated;
set local request.jwt.claims to '{"sub":"20000000-0000-0000-0000-000000000001","role":"authenticated"}';

select public.record_payment('30000000-0000-0000-0000-000000000003', -4000, 'partial payment for case 15', '2020-02-10'::date);

reset role;

select is(
  (select status from public.payment_period_status('60000000-0000-0000-0000-000000000003')),
  'partially_paid',
  'Case 15: a period with 0 < paid < minimum and not overdue reads ''partially_paid'''
);

-- Case 16: satisfied -- top up period 3 (not yet due) to full payment.
set local role authenticated;
set local request.jwt.claims to '{"sub":"20000000-0000-0000-0000-000000000001","role":"authenticated"}';

select public.record_payment('30000000-0000-0000-0000-000000000003', -6000, 'top-up payment for case 16', '2020-02-11'::date);

reset role;

select is(
  (select status from public.payment_period_status('60000000-0000-0000-0000-000000000003')),
  'satisfied',
  'Case 16a: a fully-paid period BEFORE its due_date reads ''satisfied'''
);

-- Fully pay off period 1 (already past due_date) too: satisfied must beat
-- overdue, not just beat partially_paid/due.
set local role authenticated;
set local request.jwt.claims to '{"sub":"20000000-0000-0000-0000-000000000001","role":"authenticated"}';

select public.record_payment('30000000-0000-0000-0000-000000000003', -10000, 'full late payment for case 16b', '2020-01-14'::date);

reset role;

select is(
  (select status from public.payment_period_status('60000000-0000-0000-0000-000000000001')),
  'satisfied',
  'Case 16b: a fully-paid period AFTER its due_date still reads ''satisfied'', not ''overdue'' -- satisfied beats overdue'
);

-- Case 17: waived beats what would otherwise be satisfied or overdue.
set local role authenticated;
set local request.jwt.claims to '{"sub":"20000000-0000-0000-0000-000000000001","role":"authenticated"}';

select public.waive_payment_period('60000000-0000-0000-0000-000000000001', 'waived despite being fully paid, case 17a');

reset role;

select is(
  (select status from public.payment_period_status('60000000-0000-0000-0000-000000000001')),
  'waived',
  'Case 17a: waiving an already-satisfied period reads ''waived'', not ''satisfied'''
);

-- A second, separate period that would otherwise be overdue (unpaid, past
-- due_date), waived instead.
insert into public.payment_periods
  (id, payment_plan_id, household_id, member_id, period_start, due_date, minimum_cents)
values
  ('60000000-0000-0000-0000-000000000004', (select id from tmp_plan_c2),
   '10000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-000000000003',
   '2019-01-01'::date, '2019-01-15'::date, 10000);

set local role authenticated;
set local request.jwt.claims to '{"sub":"20000000-0000-0000-0000-000000000001","role":"authenticated"}';

select public.waive_payment_period('60000000-0000-0000-0000-000000000004', 'waived despite being overdue, case 17b');

reset role;

select is(
  (select status from public.payment_period_status('60000000-0000-0000-0000-000000000004')),
  'waived',
  'Case 17b: waiving an unpaid, past-due period reads ''waived'', not ''overdue'' -- waived beats overdue'
);

-- ---------------------------------------------------------------------------
-- Case 18: allocation window boundary and voided-payment exclusion, using
-- period 2 ('upcoming', unpaid, minimum_cents 10000, window
-- (2099-01-01, 2099-01-15]).
-- ---------------------------------------------------------------------------

-- A payment dated exactly on period_start is EXCLUDED (window is
-- exclusive-start): pay in full ON period_start and the period should NOT
-- read 'satisfied'.
set local role authenticated;
set local request.jwt.claims to '{"sub":"20000000-0000-0000-0000-000000000001","role":"authenticated"}';

select public.record_payment('30000000-0000-0000-0000-000000000003', -10000, 'on period_start, case 18a', '2099-01-01'::date);

reset role;

select is(
  (select paid_cents from public.payment_period_status('60000000-0000-0000-0000-000000000002')),
  0::bigint,
  'Case 18a: a payment dated exactly on period_start is excluded from the allocation window (paid_cents stays 0)'
);

select is(
  (select status from public.payment_period_status('60000000-0000-0000-0000-000000000002')),
  'upcoming',
  'Case 18a (status): period 2 still reads ''upcoming'' since the on-period_start payment did not count'
);

-- A payment dated exactly on due_date IS included (window is inclusive-end).
set local role authenticated;
set local request.jwt.claims to '{"sub":"20000000-0000-0000-0000-000000000001","role":"authenticated"}';

select public.record_payment('30000000-0000-0000-0000-000000000003', -10000, 'on due_date, case 18b', '2099-01-15'::date);

reset role;

select is(
  (select paid_cents from public.payment_period_status('60000000-0000-0000-0000-000000000002')),
  10000::bigint,
  'Case 18b: a payment dated exactly on due_date IS included in the allocation window'
);

select is(
  (select status from public.payment_period_status('60000000-0000-0000-0000-000000000002')),
  'satisfied',
  'Case 18b (status): period 2 now reads ''satisfied'' once the on-due_date payment counted'
);

-- A voided payment does not count toward paid_cents. Void the case-18b
-- payment and confirm paid_cents drops back to 0.
set local role authenticated;
set local request.jwt.claims to '{"sub":"20000000-0000-0000-0000-000000000001","role":"authenticated"}';

create temp table tmp_case18c_void as
select * from public.void_ledger_transaction(
  (select id from public.ledger_transactions
    where member_id = '30000000-0000-0000-0000-000000000003'
      and description = 'on due_date, case 18b'),
  'voiding the case 18c payment'
);

reset role;

select ok(
  (select voided_at from tmp_case18c_void) is not null,
  'Case 18c: the Parent''s void of the case-18b payment succeeds'
);

select is(
  (select paid_cents from public.payment_period_status('60000000-0000-0000-0000-000000000002')),
  0::bigint,
  'Case 18c: a voided payment no longer counts toward paid_cents (drops back to 0)'
);

select is(
  (select status from public.payment_period_status('60000000-0000-0000-0000-000000000002')),
  'upcoming',
  'Case 18c (status): period 2 reverts to ''upcoming'' once its only payment is voided'
);

select * from finish();

rollback;
