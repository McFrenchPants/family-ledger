-- Regression tests: the households.timezone validation trigger.
--
-- Every "today" / "due" / "overdue" decision in this product is computed in the
-- household's configured IANA zone. A bad value does not fail loudly at write
-- time -- it silently mis-dates financial obligations weeks later. The BEFORE
-- INSERT OR UPDATE trigger public.household_timezone_is_valid() is the only
-- thing standing between free-text input and that failure mode, and the next
-- phase's date logic is written assuming it holds.
--
-- Note the raised exception uses errcode 'check_violation' -- SQLSTATE 23514 --
-- even though it comes from a trigger rather than a CHECK constraint.
--
-- Run with: npm run test:db  (wraps `npx supabase test db --local`)
--
-- Self-contained; whole file runs inside begin/rollback.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path to extensions, public, pg_catalog;

select plan(10);

-- ---------------------------------------------------------------------------
-- Structural assertions
-- ---------------------------------------------------------------------------

select has_trigger(
  'public', 'households', 'households_timezone_is_valid',
  'households_timezone_is_valid trigger exists on public.households'
);

-- Shape of the trigger, from pg_trigger.tgtype's bit flags:
--   1 = FOR EACH ROW, 2 = BEFORE, 4 = ON INSERT, 16 = ON UPDATE.
-- All four must hold: a statement-level or AFTER trigger could not reject the
-- write, and an insert-only trigger would leave the UPDATE path open.
select ok(
  (select (t.tgtype & 1) = 1 and (t.tgtype & 2) = 2
      and (t.tgtype & 4) = 4 and (t.tgtype & 16) = 16
     from pg_catalog.pg_trigger t
    where t.tgrelid = 'public.households'::regclass
      and t.tgname = 'households_timezone_is_valid'),
  'the trigger is BEFORE INSERT OR UPDATE, FOR EACH ROW'
);

-- An empty search_path is what stops a caller-controlled search_path from
-- hijacking the lookup inside the function. Dropping it would be a silent
-- security regression.
select is(
  (select p.proconfig
     from pg_catalog.pg_proc p
     join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'household_timezone_is_valid'),
  array['search_path=""'],
  'household_timezone_is_valid() is declared with an empty search_path'
);

-- ---------------------------------------------------------------------------
-- Accepted values
-- ---------------------------------------------------------------------------

select lives_ok(
  $$
    insert into public.households (id, name, timezone)
    values ('33333333-3333-3333-3333-333333333333', 'Valid Zone', 'America/Chicago')
  $$,
  'a real IANA zone is accepted'
);

-- ---------------------------------------------------------------------------
-- Rejected values
-- ---------------------------------------------------------------------------

select throws_ok(
  $$
    insert into public.households (name, timezone)
    values ('Bogus', 'Not/AReal_Zone')
  $$,
  '23514',
  null,
  'a nonexistent zone identifier is rejected'
);

-- The single most important case for this project. 'localtime' is Postgres'
-- alias for whatever zone the *server* happens to be in. This project's
-- standing rule is that dates are computed in the household''s configured
-- zone, never the database server's, edge runtime's, or browser's implicit
-- local time -- so 'localtime' must never be storable as a household zone.
select throws_ok(
  $$
    insert into public.households (name, timezone)
    values ('Server Local', 'localtime')
  $$,
  '23514',
  null,
  'the server-local alias ''localtime'' is rejected'
);

select throws_ok(
  $$
    insert into public.households (name, timezone)
    values ('Empty', '')
  $$,
  '23514',
  null,
  'an empty-string timezone is rejected'
);

-- DELIBERATE BEHAVIOUR, NOT A BUG.
--
-- 'america/chicago' is a correct zone spelled in the wrong case. Postgres will
-- happily *interpret* it case-insensitively in `at time zone`, but
-- pg_timezone_names stores canonical identifiers, so the trigger rejects it.
-- That is the behaviour we want: exactly one canonical spelling is ever stored,
-- so household zones compare, group and display identically everywhere.
--
-- The consequence for the next phase: the UI must offer a timezone *picker*
-- populated from canonical identifiers, NOT a free-text field. A future session
-- that hits this rejection should build the picker, not loosen the trigger.
select throws_ok(
  $$
    insert into public.households (name, timezone)
    values ('Wrong Case', 'america/chicago')
  $$,
  '23514',
  null,
  'a correct zone in the wrong case (''america/chicago'') is rejected: canonical storage is deliberate'
);

-- ---------------------------------------------------------------------------
-- The trigger fires on UPDATE, not only INSERT
-- ---------------------------------------------------------------------------

select throws_ok(
  $$
    update public.households
       set timezone = 'Not/AReal_Zone'
     where id = '33333333-3333-3333-3333-333333333333'
  $$,
  '23514',
  null,
  'UPDATE of timezone to an invalid value is rejected (trigger fires on update)'
);

select lives_ok(
  $$
    update public.households
       set timezone = 'Europe/Paris'
     where id = '33333333-3333-3333-3333-333333333333'
  $$,
  'UPDATE of timezone to another valid zone is allowed'
);

select * from finish();

rollback;
