-- Regression tests: PF1 -- a payment period's due date never falls before
-- the period starts (20261003120000_payment_period_due_date_after_start.sql).
--
-- Rule under test: due_date = the first date on or after period_start whose
-- day-of-month is the plan's due_day (same month if due_day >=
-- day(period_start), else the following month), clamped to the day before
-- the next period start (smallest starts_on + k months after period_start).
--
-- Covers:
--   (a) the helper internal.payment_period_due_date exists and no
--       application role can execute it;
--   (b) the helper directly: same-month case unchanged, next-month case,
--       the Jan 31 / due 28 month-end collision clamp, plus an exhaustive
--       sweep (every start day of a year x every due_day x 14 periods)
--       proving period_start <= due_date < next_period_start always, and
--       that plans with day(starts_on) <= due_day keep the old rule's dates;
--   (c) end-to-end through public.ensure_current_payment_period, called as
--       the Child: same-month, next-month and collision plans (fixed future
--       starts_on, so the result does not depend on the wall clock);
--   (d) a plan created "today" (household time zone) with a due day earlier
--       than today's day-of-month reads 'due', not 'overdue';
--   (e) the migration's repair: no stored payment_periods row anywhere has
--       due_date < period_start.
--
-- Role-switching idiom matches 003/005 (set local role authenticated +
-- request.jwt.claims; `reset role` back to postgres between blocks).
-- Self-contained: own fixtures, everything inside begin/rollback.
--
-- Run with: npm run test:db  (wraps `npx supabase test db --local`)

begin;

create extension if not exists pgtap with schema extensions;
set local search_path to extensions, public, pg_catalog;

select plan(20);

-- ---------------------------------------------------------------------------
-- (a) Helper exists; not executable by application roles.
-- ---------------------------------------------------------------------------

select ok(
  to_regprocedure('internal.payment_period_due_date(date, date, integer)') is not null,
  'Case 1a: internal.payment_period_due_date(date, date, integer) exists'
);

select ok(
  not has_function_privilege('authenticated', 'internal.payment_period_due_date(date, date, integer)', 'execute')
  and not has_function_privilege('anon', 'internal.payment_period_due_date(date, date, integer)', 'execute'),
  'Case 1b: neither authenticated nor anon can execute internal.payment_period_due_date'
);

-- ---------------------------------------------------------------------------
-- (b) The rule itself.
-- ---------------------------------------------------------------------------

select is(
  internal.payment_period_due_date('2026-01-10', '2026-01-10', 15),
  '2026-01-15'::date,
  'Case 2a: same-month -- starts Jan 10, due day 15 -> due Jan 15 (unchanged from old rule)'
);

select is(
  internal.payment_period_due_date('2026-01-10', '2026-03-10', 15),
  '2026-03-15'::date,
  'Case 2b: same-month, later period -- Mar 10 period of the same plan -> due Mar 15'
);

select is(
  internal.payment_period_due_date('2026-10-03', '2026-10-03', 1),
  '2026-11-01'::date,
  'Case 3a: next-month -- starts Oct 3, due day 1 -> due Nov 1 (old rule gave Oct 1, before the start)'
);

select is(
  internal.payment_period_due_date('2026-10-03', '2026-12-03', 1),
  '2027-01-01'::date,
  'Case 3b: next-month across a year boundary -- Dec 3 period -> due Jan 1'
);

select is(
  internal.payment_period_due_date('2026-01-31', '2026-01-31', 28),
  '2026-02-27'::date,
  'Case 4a: collision -- starts Jan 31, due day 28: candidate Feb 28 IS the next period start, so clamps to Feb 27'
);

select is(
  internal.payment_period_due_date('2026-01-31', '2026-02-28', 28),
  '2026-02-28'::date,
  'Case 4b: the following (clamped) Feb 28 period of the same plan -> due Feb 28 (same month, no clamp)'
);

-- Exhaustive sweep: every start date in 2027 (non-leap) and 2028 (leap) x
-- every due_day 1-28 x periods k = 0..13, with next_period_start computed
-- independently as starts_on + (k+1) months.
create temp table tmp_sweep as
select
  s::date as starts_on,
  d as due_day,
  (s + make_interval(months => k))::date as period_start,
  (s + make_interval(months => k + 1))::date as next_period_start,
  internal.payment_period_due_date(s::date, (s + make_interval(months => k))::date, d) as due_date
from generate_series('2027-01-01'::date, '2028-12-31'::date, interval '1 day') s
cross join generate_series(1, 28) d
cross join generate_series(0, 13) k;

select is(
  (select count(*) from tmp_sweep
    where not (due_date >= period_start and due_date < next_period_start)),
  0::bigint,
  'Case 5a: sweep -- every due_date satisfies period_start <= due_date < next_period_start'
);

select is(
  (select count(*) from tmp_sweep
    where extract(day from due_date)::int <> due_day
      and due_date <> next_period_start - 1),
  0::bigint,
  'Case 5b: sweep -- every due_date falls on due_day, except where clamped to the day before the next period'
);

select is(
  (select count(*) from tmp_sweep
    where extract(day from starts_on)::int <= due_day
      and due_date <> make_date(extract(year from period_start)::int,
                                extract(month from period_start)::int,
                                due_day)),
  0::bigint,
  'Case 5c: sweep -- plans with day(starts_on) <= due_day get exactly the old same-month due dates'
);

-- ---------------------------------------------------------------------------
-- Fixtures for (c) and (d): one household, a Parent and a Child.
-- ---------------------------------------------------------------------------

insert into public.households (id, name, timezone, child_expense_scope) values
  ('12000000-0000-0000-0000-00000000000a', 'PF1 Household', 'Pacific/Auckland', 'any_member');

insert into auth.users (id, email) values
  ('22000000-0000-0000-0000-000000000001', 'pf1-parent@example.test'),
  ('22000000-0000-0000-0000-000000000002', 'pf1-child@example.test');

insert into public.household_members (id, household_id, user_id, name, role, status) values
  ('32000000-0000-0000-0000-000000000001', '12000000-0000-0000-0000-00000000000a',
   '22000000-0000-0000-0000-000000000001', 'PF1 Parent', 'parent', 'active'),
  ('32000000-0000-0000-0000-000000000002', '12000000-0000-0000-0000-00000000000a',
   '22000000-0000-0000-0000-000000000002', 'PF1 Child',  'child',  'active');

-- Parent creates three future-dated plans in turn (each supersedes the last,
-- so materialize each one's first period as the Child before the next).
-- A future starts_on makes ensure_current_payment_period return the first
-- period, period_start = starts_on, regardless of the real date.

-- (c1) same-month plan
set local role authenticated;
set local request.jwt.claims to '{"sub":"22000000-0000-0000-0000-000000000001","role":"authenticated"}';
create temp table tmp_plan_same as
select * from public.create_payment_plan('32000000-0000-0000-0000-000000000002', 2500, 10, '2099-05-03'::date);
reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"22000000-0000-0000-0000-000000000002","role":"authenticated"}';
create temp table tmp_period_same as
select * from public.ensure_current_payment_period((select id from tmp_plan_same));
reset role;

-- (c2) next-month plan
set local role authenticated;
set local request.jwt.claims to '{"sub":"22000000-0000-0000-0000-000000000001","role":"authenticated"}';
create temp table tmp_plan_next as
select * from public.create_payment_plan('32000000-0000-0000-0000-000000000002', 2500, 5, '2099-05-20'::date);
reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"22000000-0000-0000-0000-000000000002","role":"authenticated"}';
create temp table tmp_period_next as
select * from public.ensure_current_payment_period((select id from tmp_plan_next));
reset role;

-- (c3) collision plan
set local role authenticated;
set local request.jwt.claims to '{"sub":"22000000-0000-0000-0000-000000000001","role":"authenticated"}';
create temp table tmp_plan_coll as
select * from public.create_payment_plan('32000000-0000-0000-0000-000000000002', 2500, 28, '2099-01-31'::date);
reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"22000000-0000-0000-0000-000000000002","role":"authenticated"}';
create temp table tmp_period_coll as
select * from public.ensure_current_payment_period((select id from tmp_plan_coll));
reset role;

select is(
  (select (period_start, due_date)::text from tmp_period_same),
  ('2099-05-03'::date, '2099-05-10'::date)::text,
  'Case 6a: ensure_current_payment_period, same-month plan (starts May 3, due day 10) -> due May 10'
);

select is(
  (select (period_start, due_date)::text from tmp_period_next),
  ('2099-05-20'::date, '2099-06-05'::date)::text,
  'Case 6b: ensure_current_payment_period, next-month plan (starts May 20, due day 5) -> due Jun 5'
);

select is(
  (select (period_start, due_date)::text from tmp_period_coll),
  ('2099-01-31'::date, '2099-02-27'::date)::text,
  'Case 6c: ensure_current_payment_period, collision plan (starts Jan 31, due day 28) -> due Feb 27'
);

-- ---------------------------------------------------------------------------
-- (d) Plan created "today" with a due day earlier than today -> 'due'.
-- ---------------------------------------------------------------------------
--
-- "Today" is the household's (Pacific/Auckland, deliberately far from UTC)
-- calendar date. On the 1st of a month there is no earlier due day, so the
-- plan starts yesterday instead (the last day of the previous month, day
-- 28-31): with due_day 1 that is still "a plan whose due day is earlier in
-- the month than its start", and its current period is the one starting
-- yesterday, due today.

create temp table tmp_today as
select
  case
    when extract(day from (now() at time zone 'Pacific/Auckland')::date) > 1
      then (now() at time zone 'Pacific/Auckland')::date
    else (now() at time zone 'Pacific/Auckland')::date - 1
  end as starts_on;

grant select on tmp_today to authenticated;

set local role authenticated;
set local request.jwt.claims to '{"sub":"22000000-0000-0000-0000-000000000001","role":"authenticated"}';
create temp table tmp_plan_today as
select * from public.create_payment_plan(
  '32000000-0000-0000-0000-000000000002', 2500, 1, (select starts_on from tmp_today)
);
reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"22000000-0000-0000-0000-000000000002","role":"authenticated"}';
create temp table tmp_period_today as
select * from public.ensure_current_payment_period((select id from tmp_plan_today));
reset role;

select is(
  (select period_start from tmp_period_today),
  (select starts_on from tmp_today),
  'Case 7a: the current period of a plan created today starts on the plan''s start date'
);

select ok(
  (select due_date >= period_start from tmp_period_today),
  'Case 7b: that period''s due_date is not before its period_start'
);

select is(
  (select due_date from tmp_period_today),
  (select (date_trunc('month', starts_on) + interval '1 month')::date from tmp_today),
  'Case 7c: due day 1 with a later start day -> due on the 1st of the FOLLOWING month'
);

grant select on tmp_period_today to authenticated;

set local role authenticated;
set local request.jwt.claims to '{"sub":"22000000-0000-0000-0000-000000000002","role":"authenticated"}';

select is(
  (select status from public.payment_period_status((select id from tmp_period_today))),
  'due',
  'Case 7d: as the Child, the brand-new period reads ''due'', not ''overdue'''
);

reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"22000000-0000-0000-0000-000000000001","role":"authenticated"}';

select is(
  (select status from public.payment_period_status((select id from tmp_period_today))),
  'due',
  'Case 7e: as the Parent, the brand-new period reads ''due'', not ''overdue'''
);

reset role;

-- ---------------------------------------------------------------------------
-- (e) Repair: no stored row anywhere is due before it starts.
-- ---------------------------------------------------------------------------

select is(
  (select count(*) from public.payment_periods where due_date < period_start),
  0::bigint,
  'Case 8: no payment_periods row in the database has due_date < period_start (migration repair + new rule)'
);

select * from finish();

rollback;
