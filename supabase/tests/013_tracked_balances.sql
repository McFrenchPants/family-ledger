-- Regression tests: CB1 -- tracked balances and the per-balance breakdown.
--
-- Covers 20261003130000_tracked_balances.sql: public.tracked_balances (one
-- Everyday per household, guard trigger, new-household trigger), the
-- categories.tracked_balance_id mapping, the Parent-only audited write
-- functions (create_tracked_balance, update_tracked_balance,
-- set_category_balance), and public.household_member_balance_breakdown,
-- whose parts must always sum to public.household_member_balances.
--
-- Role-switching idiom matches 003/005/010: fixtures run as postgres; each
-- persona block sets `role authenticated` (or `anon`) plus
-- `request.jwt.claims` naming that person's auth.users id; `reset role`
-- returns to postgres.
--
-- Audit assertions filter on this file's own household ids, so rows already
-- in a developer's local database cannot disturb the counts.
--
-- Self-contained: creates its own fixtures, depends on nothing in seed.sql,
-- and the whole file runs inside begin/rollback.
--
-- Run with: npm run test:db  (wraps `npx supabase test db --local`)

begin;

create extension if not exists pgtap with schema extensions;
set local search_path to extensions, public, pg_catalog;

select plan(85);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
--
-- Household A: P1 (Parent), C1, C2, C4 (Children; C4 has no transactions).
-- Household B: P2 (Parent), C3 (Child). Cross-household isolation.
-- NOUSER: authenticated, member of nothing.
-- Both households are inserted here, AFTER the migration, so their Everyday
-- rows can only come from the households AFTER INSERT trigger.

insert into public.households (id, name, timezone) values
  ('cb000000-0000-0000-0000-00000000000a', 'CB Household A', 'America/Chicago'),
  ('cb000000-0000-0000-0000-00000000000b', 'CB Household B', 'Europe/Paris');

insert into auth.users (id, email) values
  ('cb100000-0000-0000-0000-000000000001', 'p1-cb1@example.test'),
  ('cb100000-0000-0000-0000-000000000002', 'c1-cb1@example.test'),
  ('cb100000-0000-0000-0000-000000000003', 'c2-cb1@example.test'),
  ('cb100000-0000-0000-0000-000000000004', 'c4-cb1@example.test'),
  ('cb100000-0000-0000-0000-000000000005', 'p2-cb1@example.test'),
  ('cb100000-0000-0000-0000-000000000006', 'c3-cb1@example.test'),
  ('cb100000-0000-0000-0000-000000000007', 'nouser-cb1@example.test');

insert into public.household_members (id, household_id, user_id, name, role, status) values
  ('cb200000-0000-0000-0000-000000000001', 'cb000000-0000-0000-0000-00000000000a',
   'cb100000-0000-0000-0000-000000000001', 'P1', 'parent', 'active'),
  ('cb200000-0000-0000-0000-000000000002', 'cb000000-0000-0000-0000-00000000000a',
   'cb100000-0000-0000-0000-000000000002', 'C1', 'child',  'active'),
  ('cb200000-0000-0000-0000-000000000003', 'cb000000-0000-0000-0000-00000000000a',
   'cb100000-0000-0000-0000-000000000003', 'C2', 'child',  'active'),
  ('cb200000-0000-0000-0000-000000000004', 'cb000000-0000-0000-0000-00000000000a',
   'cb100000-0000-0000-0000-000000000004', 'C4', 'child',  'active'),
  ('cb200000-0000-0000-0000-000000000005', 'cb000000-0000-0000-0000-00000000000b',
   'cb100000-0000-0000-0000-000000000005', 'P2', 'parent', 'active'),
  ('cb200000-0000-0000-0000-000000000006', 'cb000000-0000-0000-0000-00000000000b',
   'cb100000-0000-0000-0000-000000000006', 'C3', 'child',  'active');

-- Household A categories: Auto + Gas will feed Car, School feeds College,
-- Food stays unmapped (Everyday). Household B has one category.
insert into public.categories (id, household_id, name) values
  ('cb300000-0000-0000-0000-000000000001', 'cb000000-0000-0000-0000-00000000000a', 'Auto'),
  ('cb300000-0000-0000-0000-000000000002', 'cb000000-0000-0000-0000-00000000000a', 'Gas'),
  ('cb300000-0000-0000-0000-000000000003', 'cb000000-0000-0000-0000-00000000000a', 'School'),
  ('cb300000-0000-0000-0000-000000000004', 'cb000000-0000-0000-0000-00000000000a', 'Food'),
  ('cb300000-0000-0000-0000-000000000005', 'cb000000-0000-0000-0000-00000000000b', 'B stuff');

-- A tracked balance in household B, inserted directly as postgres with a
-- fixed id so household-A personas can name it.
insert into public.tracked_balances (id, household_id, name) values
  ('cb400000-0000-0000-0000-00000000000b', 'cb000000-0000-0000-0000-00000000000b', 'B Savings');

-- Ledger. C1: Auto 10000, Gas 2000, School 5000, Food 300, uncategorized
-- 700, payment -4000, adjustment -500, a payment of -100 that carries the
-- Auto category (payments must still land in Everyday in CB1), plus a voided
-- Auto expense (9999) and a voided payment (-1000) that must count for
-- nothing. Expected C1 total = 13400.
-- C2: Food 1500, payment -200 -> 1300. C4: nothing -> 0. C3 (B): 800.
insert into public.ledger_transactions
  (household_id, member_id, amount_cents, type, category_id, description, occurred_on, created_by,
   voided_at, voided_by, void_reason) values
  ('cb000000-0000-0000-0000-00000000000a', 'cb200000-0000-0000-0000-000000000002', 10000, 'expense',
   'cb300000-0000-0000-0000-000000000001', 'car repair', current_date, 'cb200000-0000-0000-0000-000000000001', null, null, null),
  ('cb000000-0000-0000-0000-00000000000a', 'cb200000-0000-0000-0000-000000000002', 2000, 'expense',
   'cb300000-0000-0000-0000-000000000002', 'gas', current_date, 'cb200000-0000-0000-0000-000000000001', null, null, null),
  ('cb000000-0000-0000-0000-00000000000a', 'cb200000-0000-0000-0000-000000000002', 5000, 'expense',
   'cb300000-0000-0000-0000-000000000003', 'tuition', current_date, 'cb200000-0000-0000-0000-000000000001', null, null, null),
  ('cb000000-0000-0000-0000-00000000000a', 'cb200000-0000-0000-0000-000000000002', 300, 'expense',
   'cb300000-0000-0000-0000-000000000004', 'lunch', current_date, 'cb200000-0000-0000-0000-000000000001', null, null, null),
  ('cb000000-0000-0000-0000-00000000000a', 'cb200000-0000-0000-0000-000000000002', 700, 'expense',
   null, 'misc', current_date, 'cb200000-0000-0000-0000-000000000001', null, null, null),
  ('cb000000-0000-0000-0000-00000000000a', 'cb200000-0000-0000-0000-000000000002', -4000, 'payment',
   null, 'paid', current_date, 'cb200000-0000-0000-0000-000000000001', null, null, null),
  ('cb000000-0000-0000-0000-00000000000a', 'cb200000-0000-0000-0000-000000000002', -500, 'adjustment',
   null, 'waived', current_date, 'cb200000-0000-0000-0000-000000000001', null, null, null),
  ('cb000000-0000-0000-0000-00000000000a', 'cb200000-0000-0000-0000-000000000002', -100, 'payment',
   'cb300000-0000-0000-0000-000000000001', 'paid, tagged Auto', current_date, 'cb200000-0000-0000-0000-000000000001', null, null, null),
  ('cb000000-0000-0000-0000-00000000000a', 'cb200000-0000-0000-0000-000000000002', 9999, 'expense',
   'cb300000-0000-0000-0000-000000000001', 'voided repair', current_date, 'cb200000-0000-0000-0000-000000000001',
   now(), 'cb200000-0000-0000-0000-000000000001', 'mistake'),
  ('cb000000-0000-0000-0000-00000000000a', 'cb200000-0000-0000-0000-000000000002', -1000, 'payment',
   null, 'voided payment', current_date, 'cb200000-0000-0000-0000-000000000001',
   now(), 'cb200000-0000-0000-0000-000000000001', 'mistake'),
  ('cb000000-0000-0000-0000-00000000000a', 'cb200000-0000-0000-0000-000000000003', 1500, 'expense',
   'cb300000-0000-0000-0000-000000000004', 'snacks', current_date, 'cb200000-0000-0000-0000-000000000001', null, null, null),
  ('cb000000-0000-0000-0000-00000000000a', 'cb200000-0000-0000-0000-000000000003', -200, 'payment',
   null, 'paid', current_date, 'cb200000-0000-0000-0000-000000000001', null, null, null),
  ('cb000000-0000-0000-0000-00000000000b', 'cb200000-0000-0000-0000-000000000006', 800, 'expense',
   'cb300000-0000-0000-0000-000000000005', 'b thing', current_date, 'cb200000-0000-0000-0000-000000000005', null, null, null);

-- ---------------------------------------------------------------------------
-- S: structure, Everyday invariant, grants
-- ---------------------------------------------------------------------------

select ok(to_regclass('public.tracked_balances') is not null, 'S1: public.tracked_balances exists');

select ok(
  to_regclass('public.tracked_balances_one_everyday_per_household_key') is not null,
  'S2: one-Everyday-per-household partial unique index exists'
);

select is(
  (select count(*) from public.households h
    where (select count(*) from public.tracked_balances t
            where t.household_id = h.id and t.is_everyday) <> 1),
  0::bigint,
  'S3: every household (pre-existing and new) has exactly one Everyday row'
);

select is(
  (select name from public.tracked_balances
    where household_id = 'cb000000-0000-0000-0000-00000000000a' and is_everyday),
  'Everyday',
  'S4: a household created after the migration got its Everyday row from the trigger'
);

select throws_ok(
  $$ insert into public.tracked_balances (household_id, name, is_everyday)
     values ('cb000000-0000-0000-0000-00000000000a', 'Second Everyday', true) $$,
  '23505', null,
  'S5: a second Everyday row in the same household is rejected'
);

select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = to_regclass('public.tracked_balances')),
  'S6: RLS is enabled on tracked_balances'
);

select ok(
  not has_table_privilege('authenticated', 'public.tracked_balances', 'INSERT')
  and not has_table_privilege('authenticated', 'public.tracked_balances', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.tracked_balances', 'DELETE')
  and has_table_privilege('authenticated', 'public.tracked_balances', 'SELECT'),
  'S7: authenticated may only SELECT tracked_balances'
);

select ok(
  not has_table_privilege('anon', 'public.tracked_balances', 'SELECT')
  and not has_table_privilege('anon', 'public.tracked_balances', 'INSERT'),
  'S8: anon has no privileges on tracked_balances'
);

select ok(
  not has_column_privilege('authenticated', 'public.categories', 'tracked_balance_id', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.categories', 'tracked_balance_id', 'INSERT')
  and not has_column_privilege('anon', 'public.categories', 'tracked_balance_id', 'UPDATE'),
  'S9: no app role can write categories.tracked_balance_id directly'
);

select ok(
  has_column_privilege('authenticated', 'public.categories', 'name', 'UPDATE')
  and has_column_privilege('authenticated', 'public.categories', 'active', 'UPDATE')
  and has_column_privilege('authenticated', 'public.categories', 'name', 'INSERT'),
  'S10: authenticated keeps the category column grants the front end uses'
);

select ok(
  to_regprocedure('public.create_tracked_balance(uuid,text,integer)') is not null
  and to_regprocedure('public.update_tracked_balance(uuid,text,integer,boolean)') is not null
  and to_regprocedure('public.set_category_balance(uuid,uuid)') is not null
  and to_regprocedure('public.household_member_balance_breakdown(uuid)') is not null,
  'S11: all four CB1 functions exist'
);

select ok(
  not has_function_privilege('anon', 'public.create_tracked_balance(uuid,text,integer)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.update_tracked_balance(uuid,text,integer,boolean)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.set_category_balance(uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.household_member_balance_breakdown(uuid)', 'EXECUTE'),
  'S12: anon cannot EXECUTE any CB1 function'
);

select ok(
  has_function_privilege('authenticated', 'public.create_tracked_balance(uuid,text,integer)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.update_tracked_balance(uuid,text,integer,boolean)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.set_category_balance(uuid,uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.household_member_balance_breakdown(uuid)', 'EXECUTE'),
  'S13: authenticated can EXECUTE every CB1 function'
);

select ok(
  not has_function_privilege('authenticated', 'internal.create_everyday_balance()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'internal.tracked_balances_guard()', 'EXECUTE'),
  'S14: the internal trigger functions are not executable by authenticated'
);

-- ---------------------------------------------------------------------------
-- G: guard trigger, even for postgres
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ update public.tracked_balances set active = false
      where household_id = 'cb000000-0000-0000-0000-00000000000a' and is_everyday $$,
  '23514', null,
  'G1: Everyday cannot be archived, even by a direct postgres UPDATE'
);

select throws_ok(
  $$ delete from public.tracked_balances
      where household_id = 'cb000000-0000-0000-0000-00000000000a' and is_everyday $$,
  '23514', 'the Everyday balance cannot be deleted',
  'G2: Everyday cannot be deleted while its household exists'
);

select throws_ok(
  $$ update public.tracked_balances set is_everyday = false
      where household_id = 'cb000000-0000-0000-0000-00000000000a' and is_everyday $$,
  '23514', 'is_everyday cannot be changed',
  'G3: is_everyday cannot be flipped'
);

select throws_ok(
  $$ update public.tracked_balances set household_id = 'cb000000-0000-0000-0000-00000000000a'
      where id = 'cb400000-0000-0000-0000-00000000000b' $$,
  '23514', 'a balance cannot move to another household',
  'G4: a balance cannot be moved to another household'
);

insert into public.households (id, name, timezone) values
  ('cb000000-0000-0000-0000-00000000000e', 'CB Household E (deleted)', 'Europe/Paris');

select lives_ok(
  $$ delete from public.households where id = 'cb000000-0000-0000-0000-00000000000e' $$,
  'G5: deleting a household still cascades through its Everyday row'
);

select is(
  (select count(*) from public.tracked_balances where household_id = 'cb000000-0000-0000-0000-00000000000e'),
  0::bigint,
  'G6: the deleted household left no tracked_balances behind'
);

-- ---------------------------------------------------------------------------
-- P: Parent P1 writes through the functions
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"cb100000-0000-0000-0000-000000000001","role":"authenticated"}';

select is(
  (select name from public.create_tracked_balance('cb000000-0000-0000-0000-00000000000a', '  Car  ', 1)),
  'Car',
  'P1: a Parent creates "Car" (name stored trimmed)'
);

select lives_ok(
  $$ select public.create_tracked_balance('cb000000-0000-0000-0000-00000000000a', 'College', 2) $$,
  'P2: a Parent creates "College"'
);

select lives_ok(
  $$ select public.create_tracked_balance('cb000000-0000-0000-0000-00000000000a', 'Spare') $$,
  'P3: a Parent creates "Spare" with no sort order'
);

select throws_ok(
  $$ select public.create_tracked_balance('cb000000-0000-0000-0000-00000000000a', 'cAR') $$,
  '23505', 'a balance named "cAR" already exists',
  'P4: names are unique per household, case-insensitively'
);

select throws_ok(
  $$ select public.create_tracked_balance('cb000000-0000-0000-0000-00000000000a', 'everyday') $$,
  '23505', null,
  'P5: a balance cannot be named like Everyday'
);

select throws_ok(
  $$ select public.create_tracked_balance('cb000000-0000-0000-0000-00000000000a', '   ') $$,
  '23514', 'a balance name is required',
  'P6: a blank name is rejected'
);

select throws_ok(
  $$ select public.create_tracked_balance('cb000000-0000-0000-0000-00000000000a', repeat('x', 61)) $$,
  '23514', null,
  'P7: a name over 60 characters is rejected'
);

select throws_ok(
  $$ select public.create_tracked_balance('cb000000-0000-0000-0000-00000000000b', 'Sneaky') $$,
  '42501', null,
  'P8: a Parent of A cannot create a balance in household B'
);

select lives_ok(
  $$ select public.set_category_balance('cb300000-0000-0000-0000-000000000001',
       (select id from public.tracked_balances where household_id = 'cb000000-0000-0000-0000-00000000000a' and name = 'Car'));
     select public.set_category_balance('cb300000-0000-0000-0000-000000000002',
       (select id from public.tracked_balances where household_id = 'cb000000-0000-0000-0000-00000000000a' and name = 'Car'));
     select public.set_category_balance('cb300000-0000-0000-0000-000000000003',
       (select id from public.tracked_balances where household_id = 'cb000000-0000-0000-0000-00000000000a' and name = 'College')) $$,
  'P9: a Parent maps Auto and Gas to Car, School to College'
);

select is(
  (select tracked_balance_id from public.set_category_balance('cb300000-0000-0000-0000-000000000004',
     (select id from public.tracked_balances where household_id = 'cb000000-0000-0000-0000-00000000000a' and is_everyday))),
  null::uuid,
  'P10: mapping a category to the Everyday id is stored as NULL'
);

select throws_ok(
  $$ select public.set_category_balance('cb300000-0000-0000-0000-000000000004', 'cb400000-0000-0000-0000-00000000000b') $$,
  'P0002', null,
  'P11: a category cannot be mapped to another household''s balance'
);

select throws_ok(
  $$ select public.update_tracked_balance(
       (select id from public.tracked_balances where household_id = 'cb000000-0000-0000-0000-00000000000a' and is_everyday),
       null, null, false) $$,
  '23514', 'the Everyday balance cannot be archived',
  'P12: the Everyday balance cannot be archived through the function'
);

select throws_ok(
  $$ select public.update_tracked_balance(
       (select id from public.tracked_balances where household_id = 'cb000000-0000-0000-0000-00000000000a' and name = 'Car'),
       null, null, false) $$,
  '23514', 'balance "Car" still has categories feeding it; move those categories to another balance first',
  'P13: a balance with categories still feeding it cannot be archived'
);

select is(
  (select name || '/' || sort_order::text from public.update_tracked_balance(
     (select id from public.tracked_balances where household_id = 'cb000000-0000-0000-0000-00000000000a' and name = 'Spare'),
     ' Spare Two ', 9, null)),
  'Spare Two/9',
  'P14: a Parent renames and reorders a balance'
);

select is(
  (select active from public.update_tracked_balance(
     (select id from public.tracked_balances where household_id = 'cb000000-0000-0000-0000-00000000000a' and name = 'Spare Two'),
     null, null, false)),
  false,
  'P15: a Parent archives an unmapped balance'
);

select throws_ok(
  $$ select public.set_category_balance('cb300000-0000-0000-0000-000000000004',
       (select id from public.tracked_balances where household_id = 'cb000000-0000-0000-0000-00000000000a' and name = 'Spare Two')) $$,
  '23514', null,
  'P16: a category cannot be mapped to an archived balance'
);

select is(
  (select active from public.update_tracked_balance(
     (select id from public.tracked_balances where household_id = 'cb000000-0000-0000-0000-00000000000a' and name = 'Spare Two'),
     null, null, true)),
  true,
  'P17: a Parent restores an archived balance'
);

select throws_ok(
  $$ select public.update_tracked_balance(
       (select id from public.tracked_balances where household_id = 'cb000000-0000-0000-0000-00000000000a' and name = 'Car'),
       'college') $$,
  '23505', null,
  'P18: renaming onto an existing name (any case) is rejected'
);

select throws_ok(
  $$ select public.update_tracked_balance(
       (select id from public.tracked_balances where household_id = 'cb000000-0000-0000-0000-00000000000a' and name = 'Car')) $$,
  '23514', 'nothing to update',
  'P19: an all-NULL update is rejected'
);

-- Direct writes are blocked even for a Parent.
select throws_ok(
  $$ insert into public.tracked_balances (household_id, name)
     values ('cb000000-0000-0000-0000-00000000000a', 'Direct') $$,
  '42501', null,
  'P20: a Parent cannot INSERT into tracked_balances directly'
);

select throws_ok(
  $$ update public.tracked_balances set name = 'Direct'
      where household_id = 'cb000000-0000-0000-0000-00000000000a' and name = 'Car' $$,
  '42501', null,
  'P21: a Parent cannot UPDATE tracked_balances directly'
);

select throws_ok(
  $$ update public.categories set tracked_balance_id = null
      where id = 'cb300000-0000-0000-0000-000000000001' $$,
  '42501', null,
  'P22: a Parent cannot UPDATE categories.tracked_balance_id directly (unaudited path closed)'
);

select throws_ok(
  $$ insert into public.categories (household_id, name, tracked_balance_id)
     values ('cb000000-0000-0000-0000-00000000000a', 'Direct cat',
       (select id from public.tracked_balances where household_id = 'cb000000-0000-0000-0000-00000000000a' and name = 'Car')) $$,
  '42501', null,
  'P23: a Parent cannot INSERT a category with tracked_balance_id set'
);

select lives_ok(
  $$ update public.categories set name = 'Auto & Repairs', active = true
      where id = 'cb300000-0000-0000-0000-000000000001';
     insert into public.categories (household_id, name, sort_order)
     values ('cb000000-0000-0000-0000-00000000000a', 'New cat', 5) $$,
  'P24: a Parent can still rename / toggle / create categories the way the front end does'
);

-- ---------------------------------------------------------------------------
-- B: breakdown as the Parent -- values and totals
-- ---------------------------------------------------------------------------

select is(
  (select balance_cents from public.household_member_balance_breakdown('cb000000-0000-0000-0000-00000000000a')
    where member_id = 'cb200000-0000-0000-0000-000000000002'
      and tracked_balance_id = (select id from public.tracked_balances
                                 where household_id = 'cb000000-0000-0000-0000-00000000000a' and name = 'Car')),
  12000::bigint,
  'B1: C1 Car = Auto + Gas, voided expense excluded'
);

select is(
  (select balance_cents from public.household_member_balance_breakdown('cb000000-0000-0000-0000-00000000000a')
    where member_id = 'cb200000-0000-0000-0000-000000000002'
      and tracked_balance_id = (select id from public.tracked_balances
                                 where household_id = 'cb000000-0000-0000-0000-00000000000a' and name = 'College')),
  5000::bigint,
  'B2: C1 College = School'
);

select is(
  (select balance_cents from public.household_member_balance_breakdown('cb000000-0000-0000-0000-00000000000a')
    where member_id = 'cb200000-0000-0000-0000-000000000002'
      and tracked_balance_id = (select id from public.tracked_balances
                                 where household_id = 'cb000000-0000-0000-0000-00000000000a' and is_everyday)),
  (-3600)::bigint,
  'B3: C1 Everyday = unmapped + uncategorized expenses minus both payments (even the Auto-tagged one) and the adjustment; voided payment excluded'
);

select is(
  (select count(*) from public.household_member_balance_breakdown('cb000000-0000-0000-0000-00000000000a')
    where member_id = 'cb200000-0000-0000-0000-000000000002'),
  3::bigint,
  'B4: C1 has exactly Everyday, Car and College rows (no row for the activity-less Spare Two)'
);

select is(
  (select tracked_balance_id::text || '=' || balance_cents::text
     from public.household_member_balance_breakdown('cb000000-0000-0000-0000-00000000000a')
    where member_id = 'cb200000-0000-0000-0000-000000000004'),
  (select id::text || '=0' from public.tracked_balances
    where household_id = 'cb000000-0000-0000-0000-00000000000a' and is_everyday),
  'B5: a member with no transactions gets a single Everyday row at 0'
);

select set_eq(
  $$ select member_id from public.household_member_balance_breakdown('cb000000-0000-0000-0000-00000000000a') $$,
  $$ select member_id from public.household_member_balances('cb000000-0000-0000-0000-00000000000a') $$,
  'B6: the breakdown covers exactly the members the total covers (Parent: every active member)'
);

select is_empty(
  $$ select t.member_id
       from public.household_member_balances('cb000000-0000-0000-0000-00000000000a') t
       left join (select member_id, sum(balance_cents) as s
                    from public.household_member_balance_breakdown('cb000000-0000-0000-0000-00000000000a')
                   group by member_id) d using (member_id)
      where d.s is distinct from t.balance_cents $$,
  'B7: per member, the breakdown sums exactly to household_member_balances'
);

select is(
  (select balance_cents from public.household_member_balances('cb000000-0000-0000-0000-00000000000a')
    where member_id = 'cb200000-0000-0000-0000-000000000002'),
  13400::bigint,
  'B8: C1 total is unchanged at 13400'
);

-- R: remapping moves expenses, never the total.
select lives_ok(
  $$ select public.set_category_balance('cb300000-0000-0000-0000-000000000002',
       (select id from public.tracked_balances where household_id = 'cb000000-0000-0000-0000-00000000000a' and name = 'College')) $$,
  'R1: a Parent remaps Gas from Car to College'
);

select is(
  (select string_agg(tb.name || '=' || b.balance_cents::text, ',' order by tb.name)
     from public.household_member_balance_breakdown('cb000000-0000-0000-0000-00000000000a') b
     join public.tracked_balances tb on tb.id = b.tracked_balance_id
    where b.member_id = 'cb200000-0000-0000-0000-000000000002'),
  'Car=10000,College=7000,Everyday=-3600',
  'R2: Gas''s 2000 moved from Car to College'
);

select lives_ok(
  $$ select public.set_category_balance('cb300000-0000-0000-0000-000000000001', null) $$,
  'R3: a Parent maps Auto back to Everyday (NULL)'
);

select is(
  (select string_agg(tb.name || '=' || b.balance_cents::text, ',' order by tb.name)
     from public.household_member_balance_breakdown('cb000000-0000-0000-0000-00000000000a') b
     join public.tracked_balances tb on tb.id = b.tracked_balance_id
    where b.member_id = 'cb200000-0000-0000-0000-000000000002'),
  'College=7000,Everyday=6400',
  'R4: Auto''s 10000 moved to Everyday and the now-empty Car row disappears'
);

select is_empty(
  $$ select t.member_id
       from public.household_member_balances('cb000000-0000-0000-0000-00000000000a') t
       left join (select member_id, sum(balance_cents) as s
                    from public.household_member_balance_breakdown('cb000000-0000-0000-0000-00000000000a')
                   group by member_id) d using (member_id)
      where d.s is distinct from t.balance_cents $$,
  'R5: after remapping, every member''s breakdown still sums to the unchanged total'
);

select is(
  (select balance_cents from public.household_member_balances('cb000000-0000-0000-0000-00000000000a')
    where member_id = 'cb200000-0000-0000-0000-000000000002'),
  13400::bigint,
  'R6: C1 total still 13400 after two remaps'
);

-- Car is now unmapped, so archiving it is allowed.
select is(
  (select active from public.update_tracked_balance(
     (select id from public.tracked_balances where household_id = 'cb000000-0000-0000-0000-00000000000a' and name = 'Car'),
     null, null, false)),
  false,
  'R7: once no category feeds Car, a Parent can archive it'
);

reset role;

-- Breakdown treats a stored Everyday id like NULL (decision 3's backstop):
-- write the Everyday id directly as postgres, bypassing normalization.
update public.categories
   set tracked_balance_id = (select id from public.tracked_balances
                              where household_id = 'cb000000-0000-0000-0000-00000000000a' and is_everyday)
 where id = 'cb300000-0000-0000-0000-000000000004';

set local role authenticated;
set local request.jwt.claims to '{"sub":"cb100000-0000-0000-0000-000000000001","role":"authenticated"}';

select is(
  (select string_agg(tb.name || '=' || b.balance_cents::text, ',' order by tb.name)
     from public.household_member_balance_breakdown('cb000000-0000-0000-0000-00000000000a') b
     join public.tracked_balances tb on tb.id = b.tracked_balance_id
    where b.member_id = 'cb200000-0000-0000-0000-000000000002'),
  'College=7000,Everyday=6400',
  'R8: a category whose mapping is stored as the Everyday id lands in the same single Everyday row'
);

reset role;

-- ---------------------------------------------------------------------------
-- A: audit rows for every Parent write
-- ---------------------------------------------------------------------------

select is(
  (select count(*) from public.audit_log
    where household_id = 'cb000000-0000-0000-0000-00000000000a'
      and entity_type = 'tracked_balances' and action = 'create'),
  3::bigint,
  'A1: one audit row per successful create (Car, College, Spare)'
);

select is(
  (select string_agg(action, ',' order by created_at, action) from public.audit_log
    where household_id = 'cb000000-0000-0000-0000-00000000000a'
      and entity_type = 'tracked_balances' and action <> 'create'),
  'archive,archive,restore,update',
  'A2: rename, archive, restore and archive each wrote one audit row (rejected calls wrote none)'
);

select is(
  (select count(*) from public.audit_log
    where household_id = 'cb000000-0000-0000-0000-00000000000a'
      and entity_type = 'categories' and action = 'set_tracked_balance'),
  6::bigint,
  'A3: one audit row per successful category remap (4 initial + 2 remaps)'
);

select is(
  (select count(*) from public.audit_log
    where household_id = 'cb000000-0000-0000-0000-00000000000a'
      and entity_type = 'categories' and entity_id = 'cb300000-0000-0000-0000-000000000002'
      and old_values ->> 'tracked_balance_id' = (select id::text from public.tracked_balances
                                                  where household_id = 'cb000000-0000-0000-0000-00000000000a' and name = 'Car')
      and new_values ->> 'tracked_balance_id' = (select id::text from public.tracked_balances
                                                  where household_id = 'cb000000-0000-0000-0000-00000000000a' and name = 'College')),
  1::bigint,
  'A4: the Gas remap audit row records old (Car) and new (College) balances'
);

-- Stash household A's Everyday id for personas who cannot read it via RLS.
select set_config('cb1.a_everyday_id',
  (select id::text from public.tracked_balances
    where household_id = 'cb000000-0000-0000-0000-00000000000a' and is_everyday), true);

-- ---------------------------------------------------------------------------
-- C: Child C1 -- no writes, own breakdown only
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"cb100000-0000-0000-0000-000000000002","role":"authenticated"}';

select throws_ok(
  $$ select public.create_tracked_balance('cb000000-0000-0000-0000-00000000000a', 'Child balance') $$,
  '42501', null,
  'C1: a Child cannot create a balance'
);

select throws_ok(
  $$ select public.update_tracked_balance(
       (select id from public.tracked_balances where household_id = 'cb000000-0000-0000-0000-00000000000a' and name = 'College'),
       'Renamed') $$,
  '42501', null,
  'C2: a Child cannot rename a balance'
);

select throws_ok(
  $$ select public.update_tracked_balance(
       (select id from public.tracked_balances where household_id = 'cb000000-0000-0000-0000-00000000000a' and name = 'Spare Two'),
       null, null, false) $$,
  '42501', null,
  'C3: a Child cannot archive a balance'
);

select throws_ok(
  $$ select public.set_category_balance('cb300000-0000-0000-0000-000000000003', null) $$,
  '42501', null,
  'C4: a Child cannot remap a category'
);

select throws_ok(
  $$ insert into public.tracked_balances (household_id, name)
     values ('cb000000-0000-0000-0000-00000000000a', 'Child direct') $$,
  '42501', null,
  'C5: a Child cannot INSERT into tracked_balances directly'
);

select throws_ok(
  $$ delete from public.tracked_balances where household_id = 'cb000000-0000-0000-0000-00000000000a' $$,
  '42501', null,
  'C6: a Child cannot DELETE tracked_balances directly'
);

select throws_ok(
  $$ update public.categories set tracked_balance_id = null
      where id = 'cb300000-0000-0000-0000-000000000003' $$,
  '42501', null,
  'C7: a Child cannot UPDATE categories.tracked_balance_id directly'
);

select throws_ok(
  $$ insert into public.categories (household_id, name)
     values ('cb000000-0000-0000-0000-00000000000a', 'Child made') $$,
  '42501', null,
  'C7b: a Child cannot INSERT a category (the Add expense form offers new categories to Parents only)'
);

select is(
  (select count(*) from public.tracked_balances where household_id = 'cb000000-0000-0000-0000-00000000000a'),
  4::bigint,
  'C8: a Child can read their household''s balances (Everyday, Car, College, Spare Two)'
);

select is(
  (select array_agg(distinct member_id)
     from public.household_member_balance_breakdown('cb000000-0000-0000-0000-00000000000a')),
  array['cb200000-0000-0000-0000-000000000002'::uuid],
  'C9: a Child sees only their own breakdown rows'
);

select is(
  (select sum(balance_cents) from public.household_member_balance_breakdown('cb000000-0000-0000-0000-00000000000a')),
  (select sum(balance_cents) from public.household_member_balances('cb000000-0000-0000-0000-00000000000a')),
  'C10: the Child''s own breakdown sums to their own total'
);

select is(
  (select count(*) from public.household_member_balance_breakdown('cb000000-0000-0000-0000-00000000000b')),
  0::bigint,
  'C11: a Child of A reads nothing for household B'
);

reset role;

select is(
  (select tracked_balance_id from public.categories where id = 'cb300000-0000-0000-0000-000000000003'),
  (select id from public.tracked_balances where household_id = 'cb000000-0000-0000-0000-00000000000a' and name = 'College'),
  'C12: after every Child attempt, School still feeds College'
);

-- ---------------------------------------------------------------------------
-- X: cross-household, outsider, anon
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"cb100000-0000-0000-0000-000000000005","role":"authenticated"}';

select is(
  (select count(*) from public.household_member_balance_breakdown('cb000000-0000-0000-0000-00000000000a')),
  0::bigint,
  'X1: the Parent of B gets nothing from household A''s breakdown'
);

select is(
  (select count(*) from public.tracked_balances where household_id = 'cb000000-0000-0000-0000-00000000000a'),
  0::bigint,
  'X2: the Parent of B cannot read household A''s balances'
);

select throws_ok(
  $$ select public.set_category_balance('cb300000-0000-0000-0000-000000000003', null) $$,
  '42501', null,
  'X3: the Parent of B cannot remap household A''s category'
);

select throws_ok(
  $$ select public.set_category_balance('cb300000-0000-0000-0000-000000000005',
       current_setting('cb1.a_everyday_id')::uuid) $$,
  'P0002', null,
  'X4: the Parent of B cannot point their own category at household A''s balance (no such balance in their household)'
);

select is(
  (select string_agg(member_id::text || '=' || balance_cents::text, ',' order by member_id)
     from public.household_member_balance_breakdown('cb000000-0000-0000-0000-00000000000b')),
  'cb200000-0000-0000-0000-000000000005=0,cb200000-0000-0000-0000-000000000006=800',
  'X5: the Parent of B sees their own household''s breakdown (both members, Everyday only)'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"cb100000-0000-0000-0000-000000000007","role":"authenticated"}';

select is(
  (select count(*) from public.household_member_balance_breakdown('cb000000-0000-0000-0000-00000000000a')),
  0::bigint,
  'X6: an authenticated non-member gets nothing'
);

reset role;
set local role anon;
set local request.jwt.claims to '{"role":"anon"}';

select throws_ok(
  $$ select * from public.household_member_balance_breakdown('cb000000-0000-0000-0000-00000000000a') $$,
  '42501', null,
  'X7: anon cannot call the breakdown'
);

select throws_ok(
  $$ select count(*) from public.tracked_balances $$,
  '42501', null,
  'X8: anon cannot read tracked_balances'
);

reset role;

select * from finish();

rollback;
