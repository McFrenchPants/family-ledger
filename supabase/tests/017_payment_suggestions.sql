-- Regression tests: CB5 -- Child payment suggestions.
--
-- Covers 20261003170000_payment_suggestions.sql: public.payment_suggestions /
-- public.payment_suggestion_parts (composite FKs, CHECKs, immutability
-- guards, deferred sum constraint triggers, RLS/grants),
-- create_/withdraw_/dismiss_payment_suggestion, and record_payment's trailing
-- p_suggestion_id (atomic, single-use conversion).
--
-- Role-switching idiom matches 013/014: fixtures run as postgres; each
-- persona block sets `role authenticated` (or `anon`) plus
-- `request.jwt.claims`; `reset role` returns to postgres.
--
-- Personas (auth user ...):  P1 = ...01 (Parent A), C1 = ...02, C2 = ...03
-- (Children A), P2 = ...05 (Parent B), C3 = ...06 (Child B), NOUSER = ...07.
--
-- "A suggestion never moves a balance": pg_temp.snap() below is taken as P1
-- and holds both read functions (household_member_balances and the
-- per-balance breakdown) plus household A's ledger row count.
--
-- The sum check is DEFERRABLE INITIALLY DEFERRED and this file rolls back
-- instead of committing, so the D-block forces it with
-- `set constraints ... immediate` inside each throws_ok, then restores
-- `deferred` explicitly.
--
-- Self-contained, runs inside begin/rollback.
--
-- Run with: npm run test:db  (wraps `npx supabase test db --local`)

begin;

create extension if not exists pgtap with schema extensions;
set local search_path to extensions, public, pg_catalog;

select plan(163);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

insert into public.households (id, name, timezone) values
  ('cd000000-0000-0000-0000-00000000000a', 'CB5 Household A', 'America/Chicago'),
  ('cd000000-0000-0000-0000-00000000000b', 'CB5 Household B', 'Europe/Paris');

insert into auth.users (id, email) values
  ('cd100000-0000-0000-0000-000000000001', 'p1-cb5@example.test'),
  ('cd100000-0000-0000-0000-000000000002', 'c1-cb5@example.test'),
  ('cd100000-0000-0000-0000-000000000003', 'c2-cb5@example.test'),
  ('cd100000-0000-0000-0000-000000000005', 'p2-cb5@example.test'),
  ('cd100000-0000-0000-0000-000000000006', 'c3-cb5@example.test'),
  ('cd100000-0000-0000-0000-000000000007', 'nouser-cb5@example.test');

insert into public.household_members (id, household_id, user_id, name, role, status) values
  ('cd200000-0000-0000-0000-000000000001', 'cd000000-0000-0000-0000-00000000000a',
   'cd100000-0000-0000-0000-000000000001', 'P1', 'parent', 'active'),
  ('cd200000-0000-0000-0000-000000000002', 'cd000000-0000-0000-0000-00000000000a',
   'cd100000-0000-0000-0000-000000000002', 'C1', 'child',  'active'),
  ('cd200000-0000-0000-0000-000000000003', 'cd000000-0000-0000-0000-00000000000a',
   'cd100000-0000-0000-0000-000000000003', 'C2', 'child',  'active'),
  ('cd200000-0000-0000-0000-000000000005', 'cd000000-0000-0000-0000-00000000000b',
   'cd100000-0000-0000-0000-000000000005', 'P2', 'parent', 'active'),
  ('cd200000-0000-0000-0000-000000000006', 'cd000000-0000-0000-0000-00000000000b',
   'cd100000-0000-0000-0000-000000000006', 'C3', 'child',  'active');

insert into public.tracked_balances (id, household_id, name, active) values
  ('cd400000-0000-0000-0000-000000000001', 'cd000000-0000-0000-0000-00000000000a', 'Car', true),
  ('cd400000-0000-0000-0000-000000000002', 'cd000000-0000-0000-0000-00000000000a', 'College', true),
  ('cd400000-0000-0000-0000-000000000003', 'cd000000-0000-0000-0000-00000000000a', 'Old', false),
  ('cd400000-0000-0000-0000-00000000000b', 'cd000000-0000-0000-0000-00000000000b', 'B Savings', true);

insert into public.categories (id, household_id, name, tracked_balance_id) values
  ('cd300000-0000-0000-0000-000000000001', 'cd000000-0000-0000-0000-00000000000a', 'Auto',
   'cd400000-0000-0000-0000-000000000001');

-- Expenses: C1 owes 10000 on Car + 5000 Everyday; C2 owes 3000; C3 owes 800.
insert into public.ledger_transactions
  (id, household_id, member_id, amount_cents, type, category_id, description, occurred_on, created_by) values
  ('cd500000-0000-0000-0000-000000000001', 'cd000000-0000-0000-0000-00000000000a',
   'cd200000-0000-0000-0000-000000000002', 10000, 'expense', 'cd300000-0000-0000-0000-000000000001',
   'car repair', '2026-10-01', 'cd200000-0000-0000-0000-000000000001'),
  ('cd500000-0000-0000-0000-000000000002', 'cd000000-0000-0000-0000-00000000000a',
   'cd200000-0000-0000-0000-000000000002', 5000, 'expense', null,
   'misc', '2026-10-01', 'cd200000-0000-0000-0000-000000000001'),
  ('cd500000-0000-0000-0000-000000000003', 'cd000000-0000-0000-0000-00000000000a',
   'cd200000-0000-0000-0000-000000000003', 3000, 'expense', null,
   'misc', '2026-10-01', 'cd200000-0000-0000-0000-000000000001'),
  ('cd500000-0000-0000-0000-000000000004', 'cd000000-0000-0000-0000-00000000000b',
   'cd200000-0000-0000-0000-000000000006', 800, 'expense', null,
   'b thing', '2026-10-01', 'cd200000-0000-0000-0000-000000000005');

select set_config('cb5.a_everyday',
  (select id::text from public.tracked_balances
    where household_id = 'cd000000-0000-0000-0000-00000000000a' and is_everyday), true);

-- Everything a suggestion must never move: both read functions for household
-- A plus A's ledger row count. Take it as P1 for the full (Parent) view.
create function pg_temp.snap() returns text language sql as $$
  select coalesce((select string_agg(member_id::text || '=' || balance_cents::text, ',' order by member_id)
           from public.household_member_balances('cd000000-0000-0000-0000-00000000000a')), '')
      || '|' ||
         coalesce((select string_agg(member_id::text || '/' || tracked_balance_id::text || '=' || balance_cents::text,
                                     ',' order by member_id, tracked_balance_id)
           from public.household_member_balance_breakdown('cd000000-0000-0000-0000-00000000000a')), '')
      || '|' ||
         (select count(*) from public.ledger_transactions
           where household_id = 'cd000000-0000-0000-0000-00000000000a')::text
$$;
grant all on function pg_temp.snap() to public;

-- ---------------------------------------------------------------------------
-- S: structure and grants
-- ---------------------------------------------------------------------------

select ok(
  to_regclass('public.payment_suggestions') is not null
  and to_regclass('public.payment_suggestion_parts') is not null,
  'S1: both tables exist'
);

select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = to_regclass('public.payment_suggestions'))
  and (select relrowsecurity from pg_catalog.pg_class where oid = to_regclass('public.payment_suggestion_parts')),
  'S2: RLS is enabled on both tables'
);

select ok(
  not has_table_privilege('authenticated', 'public.payment_suggestions', 'INSERT')
  and not has_table_privilege('authenticated', 'public.payment_suggestions', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.payment_suggestions', 'DELETE')
  and not has_table_privilege('authenticated', 'public.payment_suggestions', 'TRUNCATE')
  and has_table_privilege('authenticated', 'public.payment_suggestions', 'SELECT')
  and not has_table_privilege('authenticated', 'public.payment_suggestion_parts', 'INSERT')
  and not has_table_privilege('authenticated', 'public.payment_suggestion_parts', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.payment_suggestion_parts', 'DELETE')
  and not has_table_privilege('authenticated', 'public.payment_suggestion_parts', 'TRUNCATE')
  and has_table_privilege('authenticated', 'public.payment_suggestion_parts', 'SELECT'),
  'S3: authenticated may only SELECT both tables'
);

select ok(
  not has_table_privilege('anon', 'public.payment_suggestions', 'SELECT')
  and not has_table_privilege('anon', 'public.payment_suggestions', 'INSERT')
  and not has_table_privilege('anon', 'public.payment_suggestions', 'UPDATE')
  and not has_table_privilege('anon', 'public.payment_suggestions', 'DELETE')
  and not has_table_privilege('anon', 'public.payment_suggestion_parts', 'SELECT')
  and not has_table_privilege('anon', 'public.payment_suggestion_parts', 'INSERT')
  and not has_table_privilege('anon', 'public.payment_suggestion_parts', 'UPDATE')
  and not has_table_privilege('anon', 'public.payment_suggestion_parts', 'DELETE'),
  'S4: anon has no privileges on either table'
);

select ok(
  has_function_privilege('authenticated', 'public.create_payment_suggestion(uuid,bigint,date,text,jsonb)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.withdraw_payment_suggestion(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.dismiss_payment_suggestion(uuid,text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.record_payment(uuid,bigint,text,date,uuid,text,jsonb,uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.create_payment_suggestion(uuid,bigint,date,text,jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.withdraw_payment_suggestion(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.dismiss_payment_suggestion(uuid,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.record_payment(uuid,bigint,text,date,uuid,text,jsonb,uuid)', 'EXECUTE'),
  'S5: authenticated (not anon) can EXECUTE the suggestion functions and the new record_payment'
);

select ok(
  not has_function_privilege('authenticated', 'internal.parse_suggestion_parts(uuid,bigint,jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'internal.payment_suggestions_guard()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'internal.payment_suggestion_parts_guard()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'internal.payment_suggestion_parts_check_sum()', 'EXECUTE')
  and not has_function_privilege('anon', 'internal.parse_suggestion_parts(uuid,bigint,jsonb)', 'EXECUTE'),
  'S6: internal helper and trigger functions are not executable by app roles'
);

select ok(
  to_regprocedure('public.record_payment(uuid,bigint,text,date,uuid,text,jsonb)') is null
  and to_regprocedure('public.record_adjustment(uuid,bigint,text,date,uuid,text,jsonb)') is not null
  and to_regprocedure('public.record_adjustment(uuid,bigint,text,date,uuid,text,jsonb,uuid)') is null,
  'S7: record_payment was replaced (no overload); record_adjustment is unchanged and takes no suggestion'
);

select is(
  (select count(*) from pg_catalog.pg_trigger
    where tgname in ('payment_suggestion_parts_sum_check', 'payment_suggestions_parts_sum_check')
      and tgdeferrable and tginitdeferred),
  2::bigint,
  'S8: both sum-check constraint triggers exist and are DEFERRABLE INITIALLY DEFERRED'
);

select is(
  (select count(*) from pg_catalog.pg_policies
    where schemaname = 'public' and tablename in ('payment_suggestions', 'payment_suggestion_parts')
      and cmd = 'SELECT'),
  4::bigint,
  'S9: exactly the four SELECT policies exist (parent + self on each table)'
);

select is(
  (select count(*) from pg_catalog.pg_policies
    where schemaname = 'public' and tablename in ('payment_suggestions', 'payment_suggestion_parts')
      and cmd <> 'SELECT'),
  0::bigint,
  'S10: there is no write policy on either table'
);

-- ---------------------------------------------------------------------------
-- CR: Child creates a suggestion; nothing else moves
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"cd100000-0000-0000-0000-000000000001","role":"authenticated"}';
select set_config('cb5.snap0', pg_temp.snap(), true);

select is(
  (select balance_cents from public.household_member_balances('cd000000-0000-0000-0000-00000000000a')
    where member_id = 'cd200000-0000-0000-0000-000000000002'),
  15000::bigint,
  'CR0: baseline, C1 owes 15000'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"cd100000-0000-0000-0000-000000000002","role":"authenticated"}';

select isnt(
  set_config('cb5.s_split', (select id::text from public.create_payment_suggestion(
    p_member_id => 'cd200000-0000-0000-0000-000000000002',
    p_amount_cents => 3000,
    p_suggested_on => '2026-10-05',
    p_note => '  for the car  ',
    p_parts => '[{"tracked_balance_id":"cd400000-0000-0000-0000-000000000001","amount_cents":2000},
                 {"tracked_balance_id":"cd400000-0000-0000-0000-000000000002","amount_cents":1000}]')), true),
  null,
  'CR1: a Child creates a split suggestion for themselves'
);

select is(
  (select status || '/' || amount_cents || '/' || suggested_on || '/' || note || '/' ||
          created_by || '/' || (resolved_at is null) || '/' || (converted_transaction_id is null)
     from public.payment_suggestions where id = current_setting('cb5.s_split')::uuid),
  'pending/3000/2026-10-05/for the car/cd200000-0000-0000-0000-000000000002/true/true',
  'CR2: stored pending, positive cents, trimmed note, created_by = the Child, no resolution'
);

select is(
  (select string_agg(tb.name || '=' || p.amount_cents, ',' order by tb.name)
     from public.payment_suggestion_parts p
     join public.tracked_balances tb on tb.id = p.tracked_balance_id
    where p.suggestion_id = current_setting('cb5.s_split')::uuid),
  'Car=2000,College=1000',
  'CR3: the Child can read back exactly the two parts'
);

select isnt(
  set_config('cb5.s_null', (select id::text from public.create_payment_suggestion(
    'cd200000-0000-0000-0000-000000000002', 700, '2026-10-06', '   ')), true),
  null,
  'CR4: a suggestion with NULL parts and a blank note succeeds (positional call)'
);

select is(
  (select coalesce(note, '<null>') || '/' ||
          (select string_agg(p.tracked_balance_id::text || '=' || p.amount_cents, ',')
             from public.payment_suggestion_parts p where p.suggestion_id = s.id)
     from public.payment_suggestions s where s.id = current_setting('cb5.s_null')::uuid),
  '<null>/' || current_setting('cb5.a_everyday') || '=700',
  'CR5: blank note stored as NULL; NULL parts means the whole amount on Everyday'
);

reset role;

select is(
  (select count(*) from public.ledger_transactions
    where household_id = 'cd000000-0000-0000-0000-00000000000a' and type <> 'expense'),
  0::bigint,
  'CR6: no payment/adjustment ledger row was created by any suggestion'
);

set local role authenticated;
set local request.jwt.claims to '{"sub":"cd100000-0000-0000-0000-000000000001","role":"authenticated"}';

select is(
  pg_temp.snap(), current_setting('cb5.snap0'),
  'CR7: balances (totals + breakdown) and ledger row count are unchanged after creates'
);

reset role;

select is(
  (select new_values -> 'parts' from public.audit_log
    where entity_type = 'payment_suggestions' and action = 'insert'
      and entity_id = current_setting('cb5.s_split')::uuid),
  '[{"tracked_balance_id":"cd400000-0000-0000-0000-000000000001","amount_cents":2000},
    {"tracked_balance_id":"cd400000-0000-0000-0000-000000000002","amount_cents":1000}]'::jsonb,
  'CR8: the create audit row lists the parts in new_values.parts'
);

select is(
  (select (new_values ->> 'amount_cents') || '/' || (new_values ->> 'status') || '/' || actor_user_id
     from public.audit_log
    where entity_type = 'payment_suggestions' and action = 'insert'
      and entity_id = current_setting('cb5.s_split')::uuid),
  '3000/pending/cd100000-0000-0000-0000-000000000002',
  'CR9: the audit row carries the row itself and the acting user'
);

select is(
  (select count(*) from public.audit_log
    where entity_type = 'payment_suggestions' and action = 'insert'
      and household_id = 'cd000000-0000-0000-0000-00000000000a'),
  2::bigint,
  'CR10: exactly one audit row per successful create'
);

-- ---------------------------------------------------------------------------
-- RJ: rejected creates -- nothing written
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"cd100000-0000-0000-0000-000000000002","role":"authenticated"}';

select throws_ok(
  $$ select public.create_payment_suggestion('cd200000-0000-0000-0000-000000000002', 0, '2026-10-05') $$,
  '23514', 'suggested amount_cents must be positive, got 0',
  'RJ1: a zero amount is rejected'
);

select throws_ok(
  $$ select public.create_payment_suggestion('cd200000-0000-0000-0000-000000000002', -500, '2026-10-05') $$,
  '23514', 'suggested amount_cents must be positive, got -500',
  'RJ2: a negative amount is rejected'
);

select throws_ok(
  $$ select public.create_payment_suggestion('cd200000-0000-0000-0000-000000000002', null, '2026-10-05') $$,
  '23514', null,
  'RJ3: a NULL amount is rejected'
);

select throws_ok(
  $$ select public.create_payment_suggestion('cd200000-0000-0000-0000-000000000002', 500, null) $$,
  '23514', 'a suggested date is required',
  'RJ4: a NULL date is rejected'
);

select throws_ok(
  $$ select public.create_payment_suggestion('cd200000-0000-0000-0000-000000000003', 500, '2026-10-05') $$,
  '42501', 'only an active Child may suggest a payment, and only for themselves',
  'RJ5: a Child cannot create a suggestion for a sibling'
);

select throws_ok(
  $$ select public.create_payment_suggestion('cd200000-0000-0000-0000-000000000001', 500, '2026-10-05') $$,
  '42501', 'only an active Child may suggest a payment, and only for themselves',
  'RJ6: a Child cannot create a suggestion for a Parent'
);

select throws_ok(
  $$ select public.create_payment_suggestion('cd200000-0000-0000-0000-000000000006', 500, '2026-10-05') $$,
  '42501', 'only an active Child may suggest a payment, and only for themselves',
  'RJ7: a Child cannot create a suggestion for a child of another household'
);

select throws_ok(
  $$ select public.create_payment_suggestion('cd200000-0000-0000-0000-0000000000ff', 500, '2026-10-05') $$,
  '42501', null,
  'RJ8: a nonexistent member is indistinguishable from a forbidden one'
);

select throws_ok(
  $$ select public.create_payment_suggestion('cd200000-0000-0000-0000-000000000002', 1000, '2026-10-05', null,
       '[{"tracked_balance_id":"cd400000-0000-0000-0000-000000000001","amount_cents":600},
         {"tracked_balance_id":"cd400000-0000-0000-0000-000000000002","amount_cents":300}]') $$,
  '23514', 'parts sum to 900, but the suggested payment is 1000',
  'RJ9: parts that do not sum to the amount are rejected'
);

select throws_ok(
  $$ select public.create_payment_suggestion('cd200000-0000-0000-0000-000000000002', 1000, '2026-10-05', null,
       '[{"tracked_balance_id":"cd400000-0000-0000-0000-000000000001","amount_cents":0},
         {"tracked_balance_id":"cd400000-0000-0000-0000-000000000002","amount_cents":1000}]') $$,
  '23514', 'part amount_cents must be a positive whole number of cents, got 0',
  'RJ10: a zero part is rejected'
);

select throws_ok(
  $$ select public.create_payment_suggestion('cd200000-0000-0000-0000-000000000002', 1000, '2026-10-05', null,
       '[{"tracked_balance_id":"cd400000-0000-0000-0000-000000000001","amount_cents":-100},
         {"tracked_balance_id":"cd400000-0000-0000-0000-000000000002","amount_cents":1100}]') $$,
  '23514', 'part amount_cents must be a positive whole number of cents, got -100',
  'RJ11: a negative part is rejected'
);

select throws_ok(
  $$ select public.create_payment_suggestion('cd200000-0000-0000-0000-000000000002', 1000, '2026-10-05', null,
       '[{"tracked_balance_id":"cd400000-0000-0000-0000-000000000001","amount_cents":500.5},
         {"tracked_balance_id":"cd400000-0000-0000-0000-000000000002","amount_cents":499.5}]') $$,
  '23514', 'part amount_cents must be a positive whole number of cents, got 500.5',
  'RJ12: a fractional part is rejected even when the parts sum correctly'
);

select throws_ok(
  $$ select public.create_payment_suggestion('cd200000-0000-0000-0000-000000000002', 1000, '2026-10-05', null,
       '[{"tracked_balance_id":"cd400000-0000-0000-0000-00000000000b","amount_cents":1000}]') $$,
  '23514', 'no such balance in this household: cd400000-0000-0000-0000-00000000000b',
  'RJ13: a balance of another household is rejected'
);

select throws_ok(
  $$ select public.create_payment_suggestion('cd200000-0000-0000-0000-000000000002', 1000, '2026-10-05', null,
       '[{"tracked_balance_id":"cd400000-0000-0000-0000-000000000003","amount_cents":1000}]') $$,
  '23514', 'balance "Old" is archived and cannot be suggested',
  'RJ14: an archived balance is rejected'
);

select throws_ok(
  $$ select public.create_payment_suggestion('cd200000-0000-0000-0000-000000000002', 1000, '2026-10-05', null,
       '[{"tracked_balance_id":"cd400000-0000-0000-0000-000000000001","amount_cents":400},
         {"tracked_balance_id":"cd400000-0000-0000-0000-000000000001","amount_cents":600}]') $$,
  '23514', 'balance "Car" appears more than once in the parts',
  'RJ15: the same balance twice is rejected'
);

select throws_ok(
  $$ select public.create_payment_suggestion('cd200000-0000-0000-0000-000000000002', 1000, '2026-10-05', null, '[]') $$,
  '23514', 'parts must be a non-empty JSON array',
  'RJ16: an empty parts array is rejected'
);

select throws_ok(
  $$ select public.create_payment_suggestion('cd200000-0000-0000-0000-000000000002', 1000, '2026-10-05', null,
       '[{"tracked_balance_id":"cd400000-0000-0000-0000-000000000001","amount_cents":"1000"}]') $$,
  '23514', 'part amount_cents must be a JSON number',
  'RJ17: a string amount is rejected'
);

select throws_ok(
  $$ select public.create_payment_suggestion('cd200000-0000-0000-0000-000000000002', 1000, '2026-10-05', null,
       '[{"tracked_balance_id":"cd400000-0000-0000-0000-000000000001","amount_cents":1000,"status":"converted"}]') $$,
  '23514', 'each part must have exactly the keys tracked_balance_id and amount_cents',
  'RJ18: extra keys in a part are rejected'
);

select throws_ok(
  $$ select public.create_payment_suggestion('cd200000-0000-0000-0000-000000000002', 1000, '2026-10-05', repeat('x', 501)) $$,
  '23514', 'note is too long (at most 500 characters)',
  'RJ19: an over-long note is rejected'
);

select throws_ok(
  $$ select public.create_payment_suggestion(p_member_id => 'cd200000-0000-0000-0000-000000000002',
       p_amount_cents => 100, p_suggested_on => '2026-10-05', p_status => 'converted') $$,
  '42883', null,
  'RJ20: a Child cannot pass a status (no such parameter)'
);

reset role;

select is(
  (select count(*) from public.payment_suggestions where household_id = 'cd000000-0000-0000-0000-00000000000a'),
  2::bigint,
  'RJ21: after every rejected create, household A still has exactly 2 suggestions'
);

select is(
  (select count(*) from public.payment_suggestion_parts where household_id = 'cd000000-0000-0000-0000-00000000000a'),
  3::bigint,
  'RJ22: ... and exactly 3 parts'
);

select is(
  (select count(*) from public.audit_log
    where entity_type = 'payment_suggestions' and household_id = 'cd000000-0000-0000-0000-00000000000a'),
  2::bigint,
  'RJ23: ... and no audit row was written for any rejected create'
);

-- ---------------------------------------------------------------------------
-- PA: a Parent cannot create or withdraw; outsiders and anon
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"cd100000-0000-0000-0000-000000000001","role":"authenticated"}';

select throws_ok(
  $$ select public.create_payment_suggestion('cd200000-0000-0000-0000-000000000002', 500, '2026-10-05') $$,
  '42501', 'only an active Child may suggest a payment, and only for themselves',
  'PA1: a Parent cannot create a suggestion on a Child''s behalf'
);

select throws_ok(
  $$ select public.create_payment_suggestion('cd200000-0000-0000-0000-000000000001', 500, '2026-10-05') $$,
  '42501', 'only an active Child may suggest a payment, and only for themselves',
  'PA2: a Parent cannot create a suggestion for themselves either'
);

select throws_ok(
  $$ select public.withdraw_payment_suggestion(current_setting('cb5.s_split')::uuid) $$,
  '42501', 'only the Child who made a payment suggestion may withdraw it',
  'PA3: a Parent cannot withdraw a Child''s suggestion'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"cd100000-0000-0000-0000-000000000003","role":"authenticated"}';

select throws_ok(
  $$ select public.withdraw_payment_suggestion(current_setting('cb5.s_split')::uuid) $$,
  '42501', 'only the Child who made a payment suggestion may withdraw it',
  'PA4: a sibling cannot withdraw another Child''s suggestion'
);

select throws_ok(
  $$ select public.dismiss_payment_suggestion(current_setting('cb5.s_split')::uuid, 'no') $$,
  '42501', 'only an active Parent of this household may dismiss a payment suggestion',
  'PA5: a Child cannot dismiss a suggestion (even a sibling''s)'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"cd100000-0000-0000-0000-000000000002","role":"authenticated"}';

select throws_ok(
  $$ select public.dismiss_payment_suggestion(current_setting('cb5.s_split')::uuid) $$,
  '42501', 'only an active Parent of this household may dismiss a payment suggestion',
  'PA6: a Child cannot dismiss their own suggestion'
);

select throws_ok(
  $$ select public.record_payment('cd200000-0000-0000-0000-000000000002', -3000, 'x', '2026-10-05', null, null, null,
       current_setting('cb5.s_split')::uuid) $$,
  '42501', 'only an active Parent may record a payment',
  'PA7: a Child cannot record a payment (so cannot convert a suggestion)'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"cd100000-0000-0000-0000-000000000005","role":"authenticated"}';

select throws_ok(
  $$ select public.dismiss_payment_suggestion(current_setting('cb5.s_split')::uuid) $$,
  '42501', 'only an active Parent of this household may dismiss a payment suggestion',
  'PA8: a Parent of another household cannot dismiss it'
);

select throws_ok(
  $$ select public.withdraw_payment_suggestion(current_setting('cb5.s_split')::uuid) $$,
  '42501', null,
  'PA9: a Parent of another household cannot withdraw it'
);

select throws_ok(
  $$ select public.dismiss_payment_suggestion('cd600000-0000-0000-0000-0000000000ff') $$,
  '42501', null,
  'PA10: dismissing a nonexistent suggestion looks like a forbidden one'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"cd100000-0000-0000-0000-000000000007","role":"authenticated"}';

select throws_ok(
  $$ select public.create_payment_suggestion('cd200000-0000-0000-0000-000000000002', 500, '2026-10-05') $$,
  '42501', null,
  'PA11: an authenticated user who belongs to no household cannot create'
);

select throws_ok(
  $$ select public.withdraw_payment_suggestion(current_setting('cb5.s_split')::uuid) $$,
  '42501', null,
  'PA12: ... nor withdraw'
);

reset role;
set local role anon;

select throws_ok(
  $$ select public.create_payment_suggestion('cd200000-0000-0000-0000-000000000002', 500, '2026-10-05') $$,
  '42501', null,
  'PA13: anon cannot call create_payment_suggestion'
);

select throws_ok(
  $$ select public.withdraw_payment_suggestion(current_setting('cb5.s_split')::uuid) $$,
  '42501', null,
  'PA14: anon cannot call withdraw_payment_suggestion'
);

select throws_ok(
  $$ select public.dismiss_payment_suggestion(current_setting('cb5.s_split')::uuid) $$,
  '42501', null,
  'PA15: anon cannot call dismiss_payment_suggestion'
);

select throws_ok(
  $$ select count(*) from public.payment_suggestions $$,
  '42501', null,
  'PA16: anon cannot read the table'
);

reset role;

select is(
  (select count(*) || '/' || count(*) filter (where status = 'pending') from public.payment_suggestions
    where household_id = 'cd000000-0000-0000-0000-00000000000a'),
  '2/2',
  'PA17: after all of that, both suggestions are untouched and pending'
);

-- ---------------------------------------------------------------------------
-- W: direct table writes by app roles
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"cd100000-0000-0000-0000-000000000002","role":"authenticated"}';

select throws_ok(
  $$ insert into public.payment_suggestions
       (household_id, member_id, amount_cents, suggested_on, created_by)
     values ('cd000000-0000-0000-0000-00000000000a', 'cd200000-0000-0000-0000-000000000002',
             100, '2026-10-05', 'cd200000-0000-0000-0000-000000000002') $$,
  '42501', null,
  'W1: a Child cannot INSERT a suggestion directly'
);

select throws_ok(
  $$ insert into public.payment_suggestions
       (household_id, member_id, amount_cents, suggested_on, created_by, status, resolved_at, resolved_by,
        converted_transaction_id, converted_transaction_type)
     values ('cd000000-0000-0000-0000-00000000000a', 'cd200000-0000-0000-0000-000000000002',
             100, '2026-10-05', 'cd200000-0000-0000-0000-000000000002', 'converted', now(),
             'cd200000-0000-0000-0000-000000000002', 'cd500000-0000-0000-0000-000000000001', 'payment') $$,
  '42501', null,
  'W2: a Child cannot INSERT a pre-converted suggestion directly'
);

select throws_ok(
  $$ update public.payment_suggestions set status = 'converted'
      where id = current_setting('cb5.s_split')::uuid $$,
  '42501', null,
  'W3: a Child cannot UPDATE a suggestion (cannot set status)'
);

select throws_ok(
  $$ update public.payment_suggestions set amount_cents = 1
      where id = current_setting('cb5.s_split')::uuid $$,
  '42501', null,
  'W4: a Child cannot UPDATE a suggestion''s amount'
);

select throws_ok(
  $$ delete from public.payment_suggestions where id = current_setting('cb5.s_split')::uuid $$,
  '42501', null,
  'W5: a Child cannot DELETE a suggestion'
);

select throws_ok(
  $$ insert into public.payment_suggestion_parts
       (household_id, member_id, suggestion_id, tracked_balance_id, amount_cents)
     values ('cd000000-0000-0000-0000-00000000000a', 'cd200000-0000-0000-0000-000000000002',
             current_setting('cb5.s_split')::uuid, current_setting('cb5.a_everyday')::uuid, 1) $$,
  '42501', null,
  'W6: a Child cannot INSERT a part directly'
);

select throws_ok(
  $$ update public.payment_suggestion_parts set amount_cents = 1
      where suggestion_id = current_setting('cb5.s_split')::uuid $$,
  '42501', null,
  'W7: a Child cannot UPDATE a part directly'
);

select throws_ok(
  $$ delete from public.payment_suggestion_parts
      where suggestion_id = current_setting('cb5.s_split')::uuid $$,
  '42501', null,
  'W8: a Child cannot DELETE a part directly'
);

select throws_ok(
  $$ insert into public.audit_log (household_id, actor_user_id, entity_type, entity_id, action, new_values)
     values ('cd000000-0000-0000-0000-00000000000a', 'cd100000-0000-0000-0000-000000000002',
             'payment_suggestions', current_setting('cb5.s_split')::uuid, 'insert', '{}'::jsonb) $$,
  '42501', null,
  'W9: a Child cannot write audit_log directly'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"cd100000-0000-0000-0000-000000000001","role":"authenticated"}';

select throws_ok(
  $$ insert into public.payment_suggestions
       (household_id, member_id, amount_cents, suggested_on, created_by)
     values ('cd000000-0000-0000-0000-00000000000a', 'cd200000-0000-0000-0000-000000000002',
             100, '2026-10-05', 'cd200000-0000-0000-0000-000000000001') $$,
  '42501', null,
  'W10: a Parent cannot INSERT a suggestion directly either'
);

select throws_ok(
  $$ update public.payment_suggestions set status = 'dismissed'
      where id = current_setting('cb5.s_split')::uuid $$,
  '42501', null,
  'W11: a Parent cannot UPDATE a suggestion directly (only via the functions)'
);

select throws_ok(
  $$ insert into public.audit_log (household_id, actor_user_id, entity_type, entity_id, action, new_values)
     values ('cd000000-0000-0000-0000-00000000000a', 'cd100000-0000-0000-0000-000000000001',
             'payment_suggestions', current_setting('cb5.s_split')::uuid, 'insert', '{}'::jsonb) $$,
  '42501', null,
  'W12: a Parent cannot write audit_log directly'
);

reset role;
set local role anon;

select throws_ok(
  $$ insert into public.payment_suggestions
       (household_id, member_id, amount_cents, suggested_on, created_by)
     values ('cd000000-0000-0000-0000-00000000000a', 'cd200000-0000-0000-0000-000000000002',
             100, '2026-10-05', 'cd200000-0000-0000-0000-000000000002') $$,
  '42501', null,
  'W13: anon cannot INSERT a suggestion'
);

reset role;

-- ---------------------------------------------------------------------------
-- V: visibility
-- ---------------------------------------------------------------------------

-- C2 also makes one, so there is a sibling's row to hide.
set local role authenticated;
set local request.jwt.claims to '{"sub":"cd100000-0000-0000-0000-000000000003","role":"authenticated"}';

select isnt(
  set_config('cb5.s_c2', (select id::text from public.create_payment_suggestion(
    'cd200000-0000-0000-0000-000000000003', 400, '2026-10-07', 'c2 plan',
    '[{"tracked_balance_id":"cd400000-0000-0000-0000-000000000002","amount_cents":400}]')), true),
  null,
  'V0: C2 creates a suggestion of their own'
);

select is(
  (select string_agg(member_id::text, ',') from public.payment_suggestions),
  'cd200000-0000-0000-0000-000000000003',
  'V1: C2 sees only their own suggestion'
);

select is(
  (select string_agg(member_id::text, ',') from public.payment_suggestion_parts),
  'cd200000-0000-0000-0000-000000000003',
  'V2: C2 sees only their own part'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"cd100000-0000-0000-0000-000000000002","role":"authenticated"}';

select is(
  (select count(*) from public.payment_suggestions
    where member_id = 'cd200000-0000-0000-0000-000000000002'),
  2::bigint,
  'V3: C1 sees their own two suggestions'
);

select is(
  (select count(*) from public.payment_suggestions)
  || '/' || (select count(*) from public.payment_suggestion_parts),
  '2/3',
  'V4: C1 sees nothing of C2''s (2 suggestions, 3 parts in total)'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"cd100000-0000-0000-0000-000000000001","role":"authenticated"}';

select is(
  (select count(*) from public.payment_suggestions where household_id = 'cd000000-0000-0000-0000-00000000000a')
  || '/' || (select count(*) from public.payment_suggestion_parts where household_id = 'cd000000-0000-0000-0000-00000000000a'),
  '3/4',
  'V5: the Parent sees the whole household (3 suggestions, 4 parts)'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"cd100000-0000-0000-0000-000000000005","role":"authenticated"}';

select is(
  (select count(*) from public.payment_suggestions)
  || '/' || (select count(*) from public.payment_suggestion_parts),
  '0/0',
  'V6: the Parent of household B sees nothing of household A'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"cd100000-0000-0000-0000-000000000006","role":"authenticated"}';

select is(
  (select count(*) from public.payment_suggestions)
  || '/' || (select count(*) from public.payment_suggestion_parts),
  '0/0',
  'V7: the Child of household B sees nothing of household A'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"cd100000-0000-0000-0000-000000000007","role":"authenticated"}';

select is(
  (select count(*) from public.payment_suggestions)
  || '/' || (select count(*) from public.payment_suggestion_parts),
  '0/0',
  'V8: an outsider sees nothing'
);

reset role;

-- ---------------------------------------------------------------------------
-- WD: withdraw
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"cd100000-0000-0000-0000-000000000001","role":"authenticated"}';
select set_config('cb5.snap1', pg_temp.snap(), true);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"cd100000-0000-0000-0000-000000000003","role":"authenticated"}';

select is(
  (select status || '/' || (resolved_by = 'cd200000-0000-0000-0000-000000000003') || '/' || (resolved_at is not null)
     from public.withdraw_payment_suggestion(current_setting('cb5.s_c2')::uuid)),
  'withdrawn/true/true',
  'WD1: a Child withdraws their own pending suggestion'
);

select throws_ok(
  $$ select public.withdraw_payment_suggestion(current_setting('cb5.s_c2')::uuid) $$,
  '23514', format('payment suggestion %s is already withdrawn and cannot be withdrawn', current_setting('cb5.s_c2')),
  'WD2: withdrawing twice is rejected (terminal)'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"cd100000-0000-0000-0000-000000000001","role":"authenticated"}';

select throws_ok(
  $$ select public.dismiss_payment_suggestion(current_setting('cb5.s_c2')::uuid) $$,
  '23514', format('payment suggestion %s is already withdrawn and cannot be dismissed', current_setting('cb5.s_c2')),
  'WD3: a withdrawn suggestion cannot be dismissed'
);

select throws_ok(
  $$ select public.record_payment('cd200000-0000-0000-0000-000000000003', -400, 'x', '2026-10-07', null, null, null,
       current_setting('cb5.s_c2')::uuid) $$,
  '23514', format('payment suggestion %s is already withdrawn and cannot be used', current_setting('cb5.s_c2')),
  'WD4: a withdrawn suggestion cannot be converted'
);

select is(
  pg_temp.snap(), current_setting('cb5.snap1'),
  'WD5: balances and ledger row count are unchanged after withdraw and the rejected conversion'
);

reset role;

select is(
  (select count(*) from public.ledger_transactions where type = 'payment'
     and household_id = 'cd000000-0000-0000-0000-00000000000a'),
  0::bigint,
  'WD6: the rejected conversion rolled its payment back (no payment row)'
);

select is(
  (select (old_values ->> 'status') || '>' || (new_values ->> 'status') from public.audit_log
    where entity_type = 'payment_suggestions' and action = 'withdraw'
      and entity_id = current_setting('cb5.s_c2')::uuid),
  'pending>withdrawn',
  'WD7: withdraw wrote an audit row with old and new status'
);

-- ---------------------------------------------------------------------------
-- DI: dismiss
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"cd100000-0000-0000-0000-000000000002","role":"authenticated"}';

select isnt(
  set_config('cb5.s_dis', (select id::text from public.create_payment_suggestion(
    'cd200000-0000-0000-0000-000000000002', 250, '2026-10-08', 'to dismiss')), true),
  null,
  'DI0: C1 creates a suggestion to be dismissed'
);

select isnt(
  set_config('cb5.s_dis2', (select id::text from public.create_payment_suggestion(
    'cd200000-0000-0000-0000-000000000002', 150, '2026-10-08')), true),
  null,
  'DI0b: ... and another, to be dismissed without a reason'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"cd100000-0000-0000-0000-000000000001","role":"authenticated"}';
select set_config('cb5.snap2', pg_temp.snap(), true);

select throws_ok(
  $$ select public.dismiss_payment_suggestion(current_setting('cb5.s_dis')::uuid, repeat('y', 501)) $$,
  '23514', 'reason is too long (at most 500 characters)',
  'DI1: an over-long reason is rejected'
);

select is(
  (select status || '/' || resolution_note || '/' || (resolved_by = 'cd200000-0000-0000-0000-000000000001')
     from public.dismiss_payment_suggestion(current_setting('cb5.s_dis')::uuid, '  not now  ')),
  'dismissed/not now/true',
  'DI2: a Parent dismisses with a (trimmed) reason'
);

select is(
  (select status || '/' || coalesce(resolution_note, '<null>')
     from public.dismiss_payment_suggestion(current_setting('cb5.s_dis2')::uuid)),
  'dismissed/<null>',
  'DI2b: the reason is optional'
);

select is(
  pg_temp.snap(), current_setting('cb5.snap2'),
  'DI3: balances and ledger row count are unchanged after dismiss'
);

select throws_ok(
  $$ select public.dismiss_payment_suggestion(current_setting('cb5.s_dis')::uuid) $$,
  '23514', format('payment suggestion %s is already dismissed and cannot be dismissed', current_setting('cb5.s_dis')),
  'DI4: dismissing twice is rejected (terminal)'
);

select throws_ok(
  $$ select public.record_payment('cd200000-0000-0000-0000-000000000002', -250, 'x', '2026-10-08', null, null, null,
       current_setting('cb5.s_dis')::uuid) $$,
  '23514', format('payment suggestion %s is already dismissed and cannot be used', current_setting('cb5.s_dis')),
  'DI5: a dismissed suggestion cannot be converted'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"cd100000-0000-0000-0000-000000000002","role":"authenticated"}';

select throws_ok(
  $$ select public.withdraw_payment_suggestion(current_setting('cb5.s_dis')::uuid) $$,
  '23514', format('payment suggestion %s is already dismissed and cannot be withdrawn', current_setting('cb5.s_dis')),
  'DI6: a dismissed suggestion cannot be withdrawn'
);

select is(
  (select status || '/' || resolution_note from public.payment_suggestions
    where id = current_setting('cb5.s_dis')::uuid),
  'dismissed/not now',
  'DI7: the Child sees the outcome and the reason'
);

reset role;

select is(
  (select (old_values ->> 'status') || '>' || (new_values ->> 'status') || '/' || (new_values ->> 'resolution_note')
     from public.audit_log
    where entity_type = 'payment_suggestions' and action = 'dismiss'
      and entity_id = current_setting('cb5.s_dis')::uuid),
  'pending>dismissed/not now',
  'DI8: dismiss wrote an audit row with old and new status and the reason'
);

-- ---------------------------------------------------------------------------
-- CV: conversion through record_payment(p_suggestion_id)
-- ---------------------------------------------------------------------------

-- Two more pending suggestions from C1 for the negative cases.
set local role authenticated;
set local request.jwt.claims to '{"sub":"cd100000-0000-0000-0000-000000000002","role":"authenticated"}';

select isnt(
  set_config('cb5.s_x', (select id::text from public.create_payment_suggestion(
    'cd200000-0000-0000-0000-000000000002', 400, '2026-10-09')), true),
  null,
  'CV0: C1 creates two more pending suggestions (x: Everyday 400)'
);

select isnt(
  set_config('cb5.s_y', (select id::text from public.create_payment_suggestion(
    'cd200000-0000-0000-0000-000000000002', 600, '2026-10-09', null,
    '[{"tracked_balance_id":"cd400000-0000-0000-0000-000000000001","amount_cents":600}]')), true),
  null,
  'CV0b: (y: Car 600)'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"cd100000-0000-0000-0000-000000000001","role":"authenticated"}';
select set_config('cb5.snap3', pg_temp.snap(), true);

-- The payment's own amount and split differ from the suggestion's (3000 as
-- Car 2000 + College 1000): the Parent records 2500 as Car 1500 + Everyday 1000.
select isnt(
  set_config('cb5.pay1', (select id::text from public.record_payment(
    p_member_id => 'cd200000-0000-0000-0000-000000000002',
    p_amount_cents => -2500,
    p_description => 'Payment from suggestion',
    p_occurred_on => '2026-10-10',
    p_allocations => format('[{"tracked_balance_id":"cd400000-0000-0000-0000-000000000001","amount_cents":1500},
                              {"tracked_balance_id":"%s","amount_cents":1000}]', current_setting('cb5.a_everyday'))::jsonb,
    p_suggestion_id => current_setting('cb5.s_split')::uuid)), true),
  null,
  'CV1: a Parent records a payment from a suggestion (amount and split may differ)'
);

select is(
  (select status || '/' || (converted_transaction_id = current_setting('cb5.pay1')::uuid) || '/' ||
          converted_transaction_type || '/' || (resolved_by = 'cd200000-0000-0000-0000-000000000001') || '/' ||
          (resolved_at is not null) || '/' || coalesce(resolution_note, '<null>') || '/' || amount_cents
     from public.payment_suggestions where id = current_setting('cb5.s_split')::uuid),
  'converted/true/payment/true/true/<null>/3000',
  'CV2: the suggestion is converted, linked to the payment, resolved by the Parent; its own amount is untouched'
);

select is(
  (select string_agg(tb.name || '=' || pa.amount_cents, ',' order by tb.name)
     from public.payment_allocations pa
     join public.tracked_balances tb on tb.id = pa.tracked_balance_id
    where pa.transaction_id = current_setting('cb5.pay1')::uuid),
  'Car=1500,Everyday=1000',
  'CV3: the payment has its own normal allocation parts (not the suggestion''s)'
);

select is(
  (select string_agg(tb.name || '=' || p.amount_cents, ',' order by tb.name)
     from public.payment_suggestion_parts p
     join public.tracked_balances tb on tb.id = p.tracked_balance_id
    where p.suggestion_id = current_setting('cb5.s_split')::uuid),
  'Car=2000,College=1000',
  'CV4: the suggestion''s proposed parts are preserved as history'
);

select is(
  (select string_agg(tb.name || '=' || b.balance_cents::text, ',' order by tb.name)
     from public.household_member_balance_breakdown('cd000000-0000-0000-0000-00000000000a') b
     join public.tracked_balances tb on tb.id = b.tracked_balance_id
    where b.member_id = 'cd200000-0000-0000-0000-000000000002'),
  'Car=8500,Everyday=4000',
  'CV5: only the payment moved the breakdown (Car -1500, Everyday -1000)'
);

select is(
  (select balance_cents from public.household_member_balances('cd000000-0000-0000-0000-00000000000a')
    where member_id = 'cd200000-0000-0000-0000-000000000002'),
  12500::bigint,
  'CV6: C1''s total fell by exactly the payment (15000 - 2500)'
);

reset role;

select is(
  (select (old_values ->> 'status') || '>' || (new_values ->> 'status') || '/' ||
          (new_values ->> 'converted_transaction_id')
     from public.audit_log
    where entity_type = 'payment_suggestions' and action = 'convert'
      and entity_id = current_setting('cb5.s_split')::uuid),
  'pending>converted/' || current_setting('cb5.pay1'),
  'CV7: the conversion wrote an audit row linking the payment'
);

select is(
  (select count(*) from public.audit_log
    where entity_type = 'ledger_transactions' and action = 'insert'
      and entity_id = current_setting('cb5.pay1')::uuid
      and jsonb_array_length(new_values -> 'allocations') = 2),
  1::bigint,
  'CV8: the payment kept its own normal audit row (with its allocations)'
);

-- Single use.
select set_config('cb5.counts1',
  (select (select count(*) from public.ledger_transactions where household_id = 'cd000000-0000-0000-0000-00000000000a')::text
       || '/' || (select count(*) from public.payment_allocations where household_id = 'cd000000-0000-0000-0000-00000000000a')::text
       || '/' || (select count(*) from public.audit_log where household_id = 'cd000000-0000-0000-0000-00000000000a')::text),
  true);

set local role authenticated;
set local request.jwt.claims to '{"sub":"cd100000-0000-0000-0000-000000000001","role":"authenticated"}';

select throws_ok(
  $$ select public.record_payment('cd200000-0000-0000-0000-000000000002', -100, 'again', '2026-10-10', null, null, null,
       current_setting('cb5.s_split')::uuid) $$,
  '23514', format('payment suggestion %s is already converted and cannot be used', current_setting('cb5.s_split')),
  'CV9: a converted suggestion cannot be used a second time'
);

reset role;

select is(
  (select (select count(*) from public.ledger_transactions where household_id = 'cd000000-0000-0000-0000-00000000000a')::text
       || '/' || (select count(*) from public.payment_allocations where household_id = 'cd000000-0000-0000-0000-00000000000a')::text
       || '/' || (select count(*) from public.audit_log where household_id = 'cd000000-0000-0000-0000-00000000000a')::text),
  current_setting('cb5.counts1'),
  'CV10: the rejected second use wrote nothing (no ledger row, no part, no audit row)'
);

-- Wrong member / household / missing / bad payment: rollback, still pending.
set local role authenticated;
set local request.jwt.claims to '{"sub":"cd100000-0000-0000-0000-000000000001","role":"authenticated"}';

select throws_ok(
  $$ select public.record_payment('cd200000-0000-0000-0000-000000000003', -400, 'wrong member', '2026-10-10', null, null, null,
       current_setting('cb5.s_x')::uuid) $$,
  '23514', format('payment suggestion %s is for a different household member', current_setting('cb5.s_x')),
  'CV11: a suggestion of another member cannot be converted by a payment for someone else'
);

select throws_ok(
  $$ select public.record_payment('cd200000-0000-0000-0000-000000000002', -400, 'x', '2026-10-10', null, null, null,
       'cd600000-0000-0000-0000-0000000000ff') $$,
  '23514', 'no such payment suggestion in this household: cd600000-0000-0000-0000-0000000000ff',
  'CV12: a nonexistent suggestion id is rejected and rolls the payment back'
);

select throws_ok(
  $$ select public.record_payment('cd200000-0000-0000-0000-000000000002', -700, 'bad split', '2026-10-10', null, null,
       '[{"tracked_balance_id":"cd400000-0000-0000-0000-000000000001","amount_cents":500}]',
       current_setting('cb5.s_y')::uuid) $$,
  '23514', 'allocations sum to 500, but the payment is 700',
  'CV13: a payment that fails its own validation does not touch the suggestion'
);

select throws_ok(
  $$ select public.record_payment('cd200000-0000-0000-0000-000000000002', -700, 'archived', '2026-10-10', null, null,
       '[{"tracked_balance_id":"cd400000-0000-0000-0000-000000000003","amount_cents":700}]',
       current_setting('cb5.s_y')::uuid) $$,
  '23514', 'balance "Old" is archived and cannot receive an allocation',
  'CV14: ... including a payment onto an archived balance'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"cd100000-0000-0000-0000-000000000005","role":"authenticated"}';

select throws_ok(
  $$ select public.record_payment('cd200000-0000-0000-0000-000000000006', -100, 'foreign', '2026-10-10', null, null, null,
       current_setting('cb5.s_x')::uuid) $$,
  '23514', format('no such payment suggestion in this household: %s', current_setting('cb5.s_x')),
  'CV15: a Parent of another household cannot convert household A''s suggestion'
);

select throws_ok(
  $$ select public.record_payment('cd200000-0000-0000-0000-000000000002', -100, 'foreign', '2026-10-10', null, null, null,
       current_setting('cb5.s_x')::uuid) $$,
  '42501', null,
  'CV16: nor record any payment for household A'
);

reset role;

select is(
  (select count(*) from public.ledger_transactions where type = 'payment'
     and household_id = 'cd000000-0000-0000-0000-00000000000a')
  || '/' || (select count(*) from public.payment_suggestions
              where id in (current_setting('cb5.s_x')::uuid, current_setting('cb5.s_y')::uuid)
                and status = 'pending'),
  '1/2',
  'CV17: after every failed conversion there is still exactly 1 payment and both suggestions are pending'
);

select is(
  (select (select count(*) from public.ledger_transactions where household_id = 'cd000000-0000-0000-0000-00000000000a')::text
       || '/' || (select count(*) from public.payment_allocations where household_id = 'cd000000-0000-0000-0000-00000000000a')::text
       || '/' || (select count(*) from public.audit_log where household_id = 'cd000000-0000-0000-0000-00000000000a')::text),
  current_setting('cb5.counts1'),
  'CV18: ... and nothing at all was written by them (rows, parts, audit)'
);

-- Old call shapes still work; a NULL suggestion is a plain payment.
set local role authenticated;
set local request.jwt.claims to '{"sub":"cd100000-0000-0000-0000-000000000001","role":"authenticated"}';

select lives_ok(
  $$ select public.record_payment('cd200000-0000-0000-0000-000000000003', -100, 'five-arg', '2026-10-10') $$,
  'CV19: the old positional four-argument call still works'
);

select lives_ok(
  $$ select public.record_payment(
       p_member_id => 'cd200000-0000-0000-0000-000000000003', p_amount_cents => -100, p_description => 'six named',
       p_occurred_on => '2026-10-10', p_category_id => null, p_note => null) $$,
  'CV20: the front end''s six-named-parameter call still works'
);

select lives_ok(
  $$ select public.record_payment('cd200000-0000-0000-0000-000000000003', -200, 'seven', '2026-10-10', null, null,
       '[{"tracked_balance_id":"cd400000-0000-0000-0000-000000000002","amount_cents":200}]') $$,
  'CV21: the seven-argument (allocations) call still works'
);

select lives_ok(
  $$ select public.record_payment('cd200000-0000-0000-0000-000000000003', -100, 'null sug', '2026-10-10', null, null, null, null) $$,
  'CV22: an explicit NULL suggestion is a plain payment'
);

select throws_ok(
  $$ select public.record_adjustment(p_member_id => 'cd200000-0000-0000-0000-000000000002', p_amount_cents => -100,
       p_description => 'adj', p_occurred_on => '2026-10-10', p_suggestion_id => current_setting('cb5.s_x')::uuid) $$,
  '42883', null,
  'CV23: record_adjustment does not accept a suggestion'
);

-- Convert x with a plain payment (null allocations -> Everyday).
select isnt(
  set_config('cb5.pay2', (select id::text from public.record_payment(
    'cd200000-0000-0000-0000-000000000002', -400, 'Payment x', '2026-10-10', null, null, null,
    current_setting('cb5.s_x')::uuid)), true),
  null,
  'CV24: converting with the same amount and NULL allocations works'
);

select is(
  (select string_agg(pa.tracked_balance_id::text || '=' || pa.amount_cents, ',')
     from public.payment_allocations pa where pa.transaction_id = current_setting('cb5.pay2')::uuid),
  current_setting('cb5.a_everyday') || '=400',
  'CV25: that payment''s single part is the whole amount on Everyday'
);

select is(
  (select status || '/' || (converted_transaction_id = current_setting('cb5.pay2')::uuid)
     from public.payment_suggestions where id = current_setting('cb5.s_x')::uuid),
  'converted/true',
  'CV26: the second suggestion links to its own payment'
);

select is(
  (select balance_cents from public.household_member_balances('cd000000-0000-0000-0000-00000000000a')
    where member_id = 'cd200000-0000-0000-0000-000000000002'),
  12100::bigint,
  'CV27: C1''s total reflects only the two real payments (15000 - 2500 - 400)'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"cd100000-0000-0000-0000-000000000002","role":"authenticated"}';

select is(
  (select status || '/' || (converted_transaction_id = current_setting('cb5.pay1')::uuid)
     from public.payment_suggestions where id = current_setting('cb5.s_split')::uuid),
  'converted/true',
  'CV28: the Child sees their suggestion''s outcome and the payment it became'
);

select throws_ok(
  $$ select public.withdraw_payment_suggestion(current_setting('cb5.s_split')::uuid) $$,
  '23514', format('payment suggestion %s is already converted and cannot be withdrawn', current_setting('cb5.s_split')),
  'CV29: a converted suggestion cannot be withdrawn'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"cd100000-0000-0000-0000-000000000001","role":"authenticated"}';

select throws_ok(
  $$ select public.dismiss_payment_suggestion(current_setting('cb5.s_split')::uuid) $$,
  '23514', format('payment suggestion %s is already converted and cannot be dismissed', current_setting('cb5.s_split')),
  'CV30: a converted suggestion cannot be dismissed'
);

reset role;

-- ---------------------------------------------------------------------------
-- D: declarative and trigger enforcement, even for postgres
-- ---------------------------------------------------------------------------
--
-- Ledger rows used below: pay1 (C1 payment, already converted), a C2 payment
-- (found by description), an expense (cd500000-...-01).

select throws_ok(
  $$ insert into public.payment_suggestions
       (household_id, member_id, amount_cents, suggested_on, created_by, status)
     values ('cd000000-0000-0000-0000-00000000000a', 'cd200000-0000-0000-0000-000000000002',
             100, '2026-10-05', 'cd200000-0000-0000-0000-000000000002', 'converted') $$,
  '23514', null,
  'D1: a converted suggestion without its resolution columns is rejected'
);

select throws_ok(
  $$ insert into public.payment_suggestions
       (household_id, member_id, amount_cents, suggested_on, created_by, resolved_at)
     values ('cd000000-0000-0000-0000-00000000000a', 'cd200000-0000-0000-0000-000000000002',
             100, '2026-10-05', 'cd200000-0000-0000-0000-000000000002', now()) $$,
  '23514', null,
  'D2: a pending suggestion with a resolution is rejected'
);

select throws_ok(
  $$ insert into public.payment_suggestions
       (household_id, member_id, amount_cents, suggested_on, created_by, status)
     values ('cd000000-0000-0000-0000-00000000000a', 'cd200000-0000-0000-0000-000000000002',
             100, '2026-10-05', 'cd200000-0000-0000-0000-000000000002', 'bogus') $$,
  '23514', null,
  'D3: an unknown status is rejected'
);

select throws_ok(
  $$ insert into public.payment_suggestions
       (household_id, member_id, amount_cents, suggested_on, created_by)
     values ('cd000000-0000-0000-0000-00000000000a', 'cd200000-0000-0000-0000-000000000002',
             0, '2026-10-05', 'cd200000-0000-0000-0000-000000000002') $$,
  '23514', null,
  'D4: a zero amount is rejected by the table itself'
);

select throws_ok(
  $$ insert into public.payment_suggestions
       (household_id, member_id, amount_cents, suggested_on, created_by)
     values ('cd000000-0000-0000-0000-00000000000a', 'cd200000-0000-0000-0000-000000000002',
             -5, '2026-10-05', 'cd200000-0000-0000-0000-000000000002') $$,
  '23514', null,
  'D5: a negative amount is rejected by the table itself'
);

select throws_ok(
  $$ insert into public.payment_suggestions
       (household_id, member_id, amount_cents, suggested_on, created_by, note)
     values ('cd000000-0000-0000-0000-00000000000a', 'cd200000-0000-0000-0000-000000000002',
             100, '2026-10-05', 'cd200000-0000-0000-0000-000000000002', ' padded ') $$,
  '23514', null,
  'D6: an untrimmed note is rejected by the table itself'
);

select throws_ok(
  $$ insert into public.payment_suggestions
       (household_id, member_id, amount_cents, suggested_on, created_by)
     values ('cd000000-0000-0000-0000-00000000000a', 'cd200000-0000-0000-0000-000000000006',
             100, '2026-10-05', 'cd200000-0000-0000-0000-000000000002') $$,
  '23503', null,
  'D7: the member must belong to the suggestion''s household'
);

select throws_ok(
  $$ insert into public.payment_suggestions
       (household_id, member_id, amount_cents, suggested_on, created_by)
     values ('cd000000-0000-0000-0000-00000000000a', 'cd200000-0000-0000-0000-000000000002',
             100, '2026-10-05', 'cd200000-0000-0000-0000-000000000005') $$,
  '23503', null,
  'D8: created_by must belong to the suggestion''s household'
);

-- Guard: edits and deletes.
select throws_ok(
  $$ update public.payment_suggestions
        set status = 'dismissed', resolved_at = now(), resolved_by = 'cd200000-0000-0000-0000-000000000001',
            amount_cents = 1
      where id = current_setting('cb5.s_y')::uuid $$,
  '23514', 'payment suggestions cannot be edited',
  'D9: even postgres cannot edit a suggestion''s amount while resolving it'
);

select throws_ok(
  $$ update public.payment_suggestions set note = 'rewritten'
      where id = current_setting('cb5.s_y')::uuid $$,
  '23514', 'payment suggestions cannot be changed, only resolved',
  'D10: even postgres cannot edit a pending suggestion without resolving it'
);

select throws_ok(
  $$ update public.payment_suggestions
        set status = 'pending', resolved_at = null, resolved_by = null, resolution_note = null
      where id = current_setting('cb5.s_dis')::uuid $$,
  '23514', null,
  'D11: a resolved suggestion cannot be reopened'
);

select throws_ok(
  $$ update public.payment_suggestions set status = 'withdrawn', resolution_note = null
      where id = current_setting('cb5.s_split')::uuid $$,
  '23514', null,
  'D12: a converted suggestion cannot move to another terminal state'
);

select throws_ok(
  $$ delete from public.payment_suggestions where id = current_setting('cb5.s_y')::uuid $$,
  '23514', 'payment suggestions cannot be deleted',
  'D13: even postgres cannot DELETE a suggestion on its own'
);

select throws_ok(
  $$ update public.payment_suggestion_parts set amount_cents = amount_cents
      where suggestion_id = current_setting('cb5.s_y')::uuid $$,
  '23514', 'payment suggestion parts cannot be changed',
  'D14: even postgres cannot UPDATE a part'
);

select throws_ok(
  $$ delete from public.payment_suggestion_parts where suggestion_id = current_setting('cb5.s_y')::uuid $$,
  '23514', 'payment suggestion parts cannot be deleted',
  'D15: even postgres cannot DELETE a part on its own'
);

-- Conversion link: single payment, payment type, same member.
select throws_ok(
  $$ update public.payment_suggestions
        set status = 'converted', resolved_at = now(), resolved_by = 'cd200000-0000-0000-0000-000000000001',
            converted_transaction_id = current_setting('cb5.pay1')::uuid, converted_transaction_type = 'payment'
      where id = current_setting('cb5.s_y')::uuid $$,
  '23505', null,
  'D16: one payment can close at most one suggestion (unique link)'
);

select throws_ok(
  $$ update public.payment_suggestions
        set status = 'converted', resolved_at = now(), resolved_by = 'cd200000-0000-0000-0000-000000000001',
            converted_transaction_id = (select id from public.ledger_transactions where description = 'five-arg'),
            converted_transaction_type = 'payment'
      where id = current_setting('cb5.s_y')::uuid $$,
  '23503', null,
  'D17: the converting payment must be the same member''s'
);

select throws_ok(
  $$ update public.payment_suggestions
        set status = 'converted', resolved_at = now(), resolved_by = 'cd200000-0000-0000-0000-000000000001',
            converted_transaction_id = 'cd500000-0000-0000-0000-000000000001', converted_transaction_type = 'payment'
      where id = current_setting('cb5.s_y')::uuid $$,
  '23503', null,
  'D18: an expense cannot be the converting transaction'
);

select throws_ok(
  $$ update public.payment_suggestions
        set status = 'converted', resolved_at = now(), resolved_by = 'cd200000-0000-0000-0000-000000000001',
            converted_transaction_id = current_setting('cb5.pay1')::uuid, converted_transaction_type = 'adjustment'
      where id = current_setting('cb5.s_y')::uuid $$,
  '23514', null,
  'D19: the converting transaction type can only be ''payment'''
);

select is(
  (select status from public.payment_suggestions where id = current_setting('cb5.s_y')::uuid),
  'pending',
  'D20: after all of that, suggestion y is still pending'
);

-- Sum check (deferred; forced immediate inside each statement).
select throws_ok(
  $$ insert into public.payment_suggestions
       (id, household_id, member_id, amount_cents, suggested_on, created_by)
     values ('cd600000-0000-0000-0000-000000000010', 'cd000000-0000-0000-0000-00000000000a',
             'cd200000-0000-0000-0000-000000000002', 700, '2026-10-05', 'cd200000-0000-0000-0000-000000000002');
     set constraints public.payment_suggestions_parts_sum_check immediate $$,
  '23514', 'parts of payment suggestion cd600000-0000-0000-0000-000000000010 sum to 0, expected 700',
  'D21: a suggestion with zero parts fails the sum check (at commit; forced here)'
);
set constraints public.payment_suggestions_parts_sum_check, public.payment_suggestion_parts_sum_check deferred;

select throws_ok(
  $$ insert into public.payment_suggestions
       (id, household_id, member_id, amount_cents, suggested_on, created_by)
     values ('cd600000-0000-0000-0000-000000000011', 'cd000000-0000-0000-0000-00000000000a',
             'cd200000-0000-0000-0000-000000000002', 700, '2026-10-05', 'cd200000-0000-0000-0000-000000000002');
     insert into public.payment_suggestion_parts
       (household_id, member_id, suggestion_id, tracked_balance_id, amount_cents)
     values ('cd000000-0000-0000-0000-00000000000a', 'cd200000-0000-0000-0000-000000000002',
             'cd600000-0000-0000-0000-000000000011', 'cd400000-0000-0000-0000-000000000001', 600);
     set constraints public.payment_suggestions_parts_sum_check, public.payment_suggestion_parts_sum_check immediate $$,
  '23514', 'parts of payment suggestion cd600000-0000-0000-0000-000000000011 sum to 600, expected 700',
  'D22: parts that do not sum to the amount fail the sum check'
);
set constraints public.payment_suggestions_parts_sum_check, public.payment_suggestion_parts_sum_check deferred;

select lives_ok(
  $$ insert into public.payment_suggestions
       (id, household_id, member_id, amount_cents, suggested_on, created_by)
     values ('cd600000-0000-0000-0000-000000000012', 'cd000000-0000-0000-0000-00000000000a',
             'cd200000-0000-0000-0000-000000000002', 700, '2026-10-05', 'cd200000-0000-0000-0000-000000000002');
     insert into public.payment_suggestion_parts
       (household_id, member_id, suggestion_id, tracked_balance_id, amount_cents)
     values ('cd000000-0000-0000-0000-00000000000a', 'cd200000-0000-0000-0000-000000000002',
             'cd600000-0000-0000-0000-000000000012', 'cd400000-0000-0000-0000-000000000001', 400),
            ('cd000000-0000-0000-0000-00000000000a', 'cd200000-0000-0000-0000-000000000002',
             'cd600000-0000-0000-0000-000000000012', 'cd400000-0000-0000-0000-000000000002', 300);
     set constraints public.payment_suggestions_parts_sum_check, public.payment_suggestion_parts_sum_check immediate $$,
  'D23: a directly written suggestion whose parts sum correctly passes the sum check'
);
set constraints public.payment_suggestions_parts_sum_check, public.payment_suggestion_parts_sum_check deferred;

select throws_ok(
  $$ insert into public.payment_suggestion_parts
       (household_id, member_id, suggestion_id, tracked_balance_id, amount_cents)
     values ('cd000000-0000-0000-0000-00000000000a', 'cd200000-0000-0000-0000-000000000002',
             'cd600000-0000-0000-0000-000000000012', 'cd400000-0000-0000-0000-000000000001', 1) $$,
  '23505', null,
  'D24: one part per balance per suggestion'
);

select throws_ok(
  $$ insert into public.payment_suggestion_parts
       (household_id, member_id, suggestion_id, tracked_balance_id, amount_cents)
     values ('cd000000-0000-0000-0000-00000000000a', 'cd200000-0000-0000-0000-000000000002',
             'cd600000-0000-0000-0000-000000000012', 'cd400000-0000-0000-0000-00000000000b', 1) $$,
  '23503', null,
  'D25: a part''s balance must be in its suggestion''s household'
);

select throws_ok(
  $$ insert into public.payment_suggestion_parts
       (household_id, member_id, suggestion_id, tracked_balance_id, amount_cents)
     values ('cd000000-0000-0000-0000-00000000000a', 'cd200000-0000-0000-0000-000000000003',
             'cd600000-0000-0000-0000-000000000012', current_setting('cb5.a_everyday')::uuid, 1) $$,
  '23503', null,
  'D26: a part''s member must be its suggestion''s member'
);

select throws_ok(
  $$ insert into public.payment_suggestion_parts
       (household_id, member_id, suggestion_id, tracked_balance_id, amount_cents)
     values ('cd000000-0000-0000-0000-00000000000a', 'cd200000-0000-0000-0000-000000000002',
             'cd600000-0000-0000-0000-000000000012', current_setting('cb5.a_everyday')::uuid, 0) $$,
  '23514', null,
  'D27: a zero part is rejected by the table itself'
);

-- Household cascade (owner-only): suggestions and parts go with their household.
set local role authenticated;
set local request.jwt.claims to '{"sub":"cd100000-0000-0000-0000-000000000006","role":"authenticated"}';

select isnt(
  set_config('cb5.s_c3', (select id::text from public.create_payment_suggestion(
    'cd200000-0000-0000-0000-000000000006', 300, '2026-10-05', null,
    '[{"tracked_balance_id":"cd400000-0000-0000-0000-00000000000b","amount_cents":300}]')), true),
  null,
  'D28: a Child of household B creates a suggestion on B''s own balance'
);

reset role;

select lives_ok(
  $$ delete from public.households where id = 'cd000000-0000-0000-0000-00000000000b' $$,
  'D29: deleting a household (owner-only) cascades through its suggestions and parts'
);

select is(
  (select count(*) from public.payment_suggestions where household_id = 'cd000000-0000-0000-0000-00000000000b')
  || '/' || (select count(*) from public.payment_suggestion_parts where household_id = 'cd000000-0000-0000-0000-00000000000b'),
  '0/0',
  'D30: the cascaded suggestions and parts are gone'
);

select * from finish();

rollback;
