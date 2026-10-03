-- Regression tests: CB2 -- payment allocations.
--
-- Covers 20261003140000_payment_allocations.sql: public.payment_allocations
-- (composite FKs, immutability guard, deferred sum constraint triggers,
-- backfill, RLS/grants), the replaced record_payment / record_adjustment
-- (trailing p_allocations jsonb DEFAULT NULL), the audit row carrying the
-- parts, and household_member_balance_breakdown following the parts.
--
-- Role-switching idiom matches 003/005/013: fixtures run as postgres; each
-- persona block sets `role authenticated` (or `anon`) plus
-- `request.jwt.claims`; `reset role` returns to postgres.
--
-- The sum check is DEFERRABLE INITIALLY DEFERRED and this file rolls back
-- instead of committing, so the D-block forces it with
-- `set constraints ... immediate` inside each throws_ok (the failed
-- statement's subtransaction is rolled back with it), then restores
-- `deferred` explicitly.
--
-- Self-contained: creates its own fixtures, depends on nothing in seed.sql,
-- and the whole file runs inside begin/rollback. K1/K3 are deliberately
-- global (every row in the database, not just this file's).
--
-- Run with: npm run test:db  (wraps `npx supabase test db --local`)

begin;

create extension if not exists pgtap with schema extensions;
set local search_path to extensions, public, pg_catalog;

select plan(89);

-- ---------------------------------------------------------------------------
-- K: backfill / global invariants -- checked before this file adds anything
-- ---------------------------------------------------------------------------

select is_empty(
  $$ select lt.id
       from public.ledger_transactions lt
      where lt.type in ('payment', 'adjustment')
        and -lt.amount_cents is distinct from
            (select sum(pa.amount_cents) from public.payment_allocations pa
              where pa.transaction_id = lt.id) $$,
  'K1: every payment/adjustment in the database (voided ones too) has parts summing to -amount_cents'
);

select is_empty(
  $$ select pa.id
       from public.payment_allocations pa
       join public.ledger_transactions lt on lt.id = pa.transaction_id
      where lt.type = 'expense' $$,
  'K2: no expense in the database has allocation parts'
);

-- Backfilled parts are the ones created after their transaction (a part
-- written by record_payment shares its transaction's now()).
select is_empty(
  $$ select lt.id
       from public.ledger_transactions lt
       join public.payment_allocations pa on pa.transaction_id = lt.id
       join public.tracked_balances tb on tb.id = pa.tracked_balance_id
      where pa.created_at > lt.created_at
        and (not tb.is_everyday
             or pa.amount_cents <> -lt.amount_cents
             or (select count(*) from public.payment_allocations p2
                  where p2.transaction_id = lt.id) <> 1) $$,
  'K3: every backfilled payment/adjustment has exactly one Everyday part equal to its amount'
);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
--
-- Household A: P1 (Parent), C1, C2 (Children). Balances: Everyday (trigger),
-- Car, College, Old (archived). Category Auto feeds Car.
-- Household B: P2 (Parent), C3 (Child). Balance B Savings.
-- NOUSER: authenticated, member of nothing.

insert into public.households (id, name, timezone) values
  ('cc000000-0000-0000-0000-00000000000a', 'CB2 Household A', 'America/Chicago'),
  ('cc000000-0000-0000-0000-00000000000b', 'CB2 Household B', 'Europe/Paris');

insert into auth.users (id, email) values
  ('cc100000-0000-0000-0000-000000000001', 'p1-cb2@example.test'),
  ('cc100000-0000-0000-0000-000000000002', 'c1-cb2@example.test'),
  ('cc100000-0000-0000-0000-000000000003', 'c2-cb2@example.test'),
  ('cc100000-0000-0000-0000-000000000005', 'p2-cb2@example.test'),
  ('cc100000-0000-0000-0000-000000000006', 'c3-cb2@example.test'),
  ('cc100000-0000-0000-0000-000000000007', 'nouser-cb2@example.test');

insert into public.household_members (id, household_id, user_id, name, role, status) values
  ('cc200000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-00000000000a',
   'cc100000-0000-0000-0000-000000000001', 'P1', 'parent', 'active'),
  ('cc200000-0000-0000-0000-000000000002', 'cc000000-0000-0000-0000-00000000000a',
   'cc100000-0000-0000-0000-000000000002', 'C1', 'child',  'active'),
  ('cc200000-0000-0000-0000-000000000003', 'cc000000-0000-0000-0000-00000000000a',
   'cc100000-0000-0000-0000-000000000003', 'C2', 'child',  'active'),
  ('cc200000-0000-0000-0000-000000000005', 'cc000000-0000-0000-0000-00000000000b',
   'cc100000-0000-0000-0000-000000000005', 'P2', 'parent', 'active'),
  ('cc200000-0000-0000-0000-000000000006', 'cc000000-0000-0000-0000-00000000000b',
   'cc100000-0000-0000-0000-000000000006', 'C3', 'child',  'active');

insert into public.tracked_balances (id, household_id, name, active) values
  ('cc400000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-00000000000a', 'Car', true),
  ('cc400000-0000-0000-0000-000000000002', 'cc000000-0000-0000-0000-00000000000a', 'College', true),
  ('cc400000-0000-0000-0000-000000000003', 'cc000000-0000-0000-0000-00000000000a', 'Old', false),
  ('cc400000-0000-0000-0000-00000000000b', 'cc000000-0000-0000-0000-00000000000b', 'B Savings', true);

insert into public.categories (id, household_id, name, tracked_balance_id) values
  ('cc300000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-00000000000a', 'Auto',
   'cc400000-0000-0000-0000-000000000001');

-- Expenses only (no parts needed). C1: Auto 10000 (Car) + 5000 uncategorized
-- (Everyday). C2: 3000. C3 (B): 800.
insert into public.ledger_transactions
  (id, household_id, member_id, amount_cents, type, category_id, description, occurred_on, created_by) values
  ('cc500000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-00000000000a',
   'cc200000-0000-0000-0000-000000000002', 10000, 'expense', 'cc300000-0000-0000-0000-000000000001',
   'car repair', '2026-10-01', 'cc200000-0000-0000-0000-000000000001'),
  ('cc500000-0000-0000-0000-000000000002', 'cc000000-0000-0000-0000-00000000000a',
   'cc200000-0000-0000-0000-000000000002', 5000, 'expense', null,
   'misc', '2026-10-01', 'cc200000-0000-0000-0000-000000000001'),
  ('cc500000-0000-0000-0000-000000000003', 'cc000000-0000-0000-0000-00000000000a',
   'cc200000-0000-0000-0000-000000000003', 3000, 'expense', null,
   'misc', '2026-10-01', 'cc200000-0000-0000-0000-000000000001'),
  ('cc500000-0000-0000-0000-000000000004', 'cc000000-0000-0000-0000-00000000000b',
   'cc200000-0000-0000-0000-000000000006', 800, 'expense', null,
   'b thing', '2026-10-01', 'cc200000-0000-0000-0000-000000000005');

select set_config('cb2.a_everyday',
  (select id::text from public.tracked_balances
    where household_id = 'cc000000-0000-0000-0000-00000000000a' and is_everyday), true);

-- ---------------------------------------------------------------------------
-- S: structure and grants
-- ---------------------------------------------------------------------------

select ok(to_regclass('public.payment_allocations') is not null, 'S1: public.payment_allocations exists');

select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = to_regclass('public.payment_allocations')),
  'S2: RLS is enabled on payment_allocations'
);

select ok(
  not has_table_privilege('authenticated', 'public.payment_allocations', 'INSERT')
  and not has_table_privilege('authenticated', 'public.payment_allocations', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.payment_allocations', 'DELETE')
  and not has_table_privilege('authenticated', 'public.payment_allocations', 'TRUNCATE')
  and has_table_privilege('authenticated', 'public.payment_allocations', 'SELECT'),
  'S3: authenticated may only SELECT payment_allocations'
);

select ok(
  not has_table_privilege('anon', 'public.payment_allocations', 'SELECT')
  and not has_table_privilege('anon', 'public.payment_allocations', 'INSERT')
  and not has_table_privilege('anon', 'public.payment_allocations', 'UPDATE')
  and not has_table_privilege('anon', 'public.payment_allocations', 'DELETE'),
  'S4: anon has no privileges on payment_allocations'
);

select ok(
  to_regprocedure('public.record_payment(uuid,bigint,text,date,uuid,text,jsonb)') is not null
  and to_regprocedure('public.record_adjustment(uuid,bigint,text,date,uuid,text,jsonb)') is not null
  and to_regprocedure('internal.record_balance_decrease(uuid,bigint,text,text,date,uuid,text,jsonb)') is not null,
  'S5: the new record_payment / record_adjustment / helper signatures exist'
);

select ok(
  to_regprocedure('public.record_payment(uuid,bigint,text,date,uuid,text)') is null
  and to_regprocedure('public.record_adjustment(uuid,bigint,text,date,uuid,text)') is null
  and to_regprocedure('internal.record_balance_decrease(uuid,bigint,text,text,date,uuid,text)') is null,
  'S6: the old six-argument overloads are gone (no ambiguity)'
);

select ok(
  has_function_privilege('authenticated', 'public.record_payment(uuid,bigint,text,date,uuid,text,jsonb)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.record_adjustment(uuid,bigint,text,date,uuid,text,jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.record_payment(uuid,bigint,text,date,uuid,text,jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.record_adjustment(uuid,bigint,text,date,uuid,text,jsonb)', 'EXECUTE'),
  'S7: authenticated (not anon) can EXECUTE record_payment / record_adjustment'
);

select ok(
  not has_function_privilege('authenticated', 'internal.record_balance_decrease(uuid,bigint,text,text,date,uuid,text,jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'internal.payment_allocations_guard()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'internal.payment_allocations_check_sum()', 'EXECUTE')
  and not has_function_privilege('anon', 'internal.record_balance_decrease(uuid,bigint,text,text,date,uuid,text,jsonb)', 'EXECUTE'),
  'S8: the internal helper and trigger functions are not executable by app roles'
);

select is(
  (select count(*) from pg_catalog.pg_trigger
    where tgname in ('payment_allocations_sum_check', 'ledger_transactions_allocations_sum_check')
      and tgdeferrable and tginitdeferred),
  2::bigint,
  'S9: both sum-check constraint triggers exist and are DEFERRABLE INITIALLY DEFERRED'
);

-- ---------------------------------------------------------------------------
-- O: old-shape calls (exactly as the front end and seed script send them)
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"cc100000-0000-0000-0000-000000000001","role":"authenticated"}';

-- Front end (RecordPaymentPage): six named params, category/note null.
select isnt(
  set_config('cb2.o_payment', (select id::text from public.record_payment(
    p_member_id => 'cc200000-0000-0000-0000-000000000002',
    p_amount_cents => -1000,
    p_description => 'Payment',
    p_occurred_on => '2026-10-02',
    p_category_id => null,
    p_note => null)), true),
  null,
  'O1: an old-shape six-named-parameter record_payment call still succeeds'
);

-- Seed script: four named params.
select isnt(
  set_config('cb2.o_adjustment', (select id::text from public.record_adjustment(
    p_member_id => 'cc200000-0000-0000-0000-000000000002',
    p_amount_cents => -200,
    p_description => 'Waived',
    p_occurred_on => '2026-10-02')), true),
  null,
  'O2: an old-shape four-named-parameter record_adjustment call still succeeds'
);

select is(
  (select string_agg(pa.tracked_balance_id::text || '=' || pa.amount_cents::text, ',')
     from public.payment_allocations pa
    where pa.transaction_id = current_setting('cb2.o_payment')::uuid),
  current_setting('cb2.a_everyday') || '=1000',
  'O3: the old-shape payment has exactly one part: the whole amount on Everyday'
);

select is(
  (select string_agg(pa.tracked_balance_id::text || '=' || pa.amount_cents::text, ',')
     from public.payment_allocations pa
    where pa.transaction_id = current_setting('cb2.o_adjustment')::uuid),
  current_setting('cb2.a_everyday') || '=200',
  'O4: the old-shape adjustment has exactly one part: the whole amount on Everyday'
);

select is(
  (select string_agg(tb.name || '=' || b.balance_cents::text, ',' order by tb.name)
     from public.household_member_balance_breakdown('cc000000-0000-0000-0000-00000000000a') b
     join public.tracked_balances tb on tb.id = b.tracked_balance_id
    where b.member_id = 'cc200000-0000-0000-0000-000000000002'),
  'Car=10000,Everyday=3800',
  'O5: breakdown after old-shape calls: both decreases on Everyday'
);

-- ---------------------------------------------------------------------------
-- SP: split payment / adjustment
-- ---------------------------------------------------------------------------

select isnt(
  set_config('cb2.split_payment', (select id::text from public.record_payment(
    p_member_id => 'cc200000-0000-0000-0000-000000000002',
    p_amount_cents => -3000,
    p_description => 'Split payment',
    p_occurred_on => '2026-10-02',
    p_allocations => '[{"tracked_balance_id":"cc400000-0000-0000-0000-000000000001","amount_cents":2000},
                       {"tracked_balance_id":"cc400000-0000-0000-0000-000000000002","amount_cents":1000}]')), true),
  null,
  'SP1: a split payment (Car 2000 + College 1000) succeeds'
);

select is(
  (select string_agg(tb.name || '=' || pa.amount_cents::text || '/' || pa.member_id::text || '/' || pa.transaction_type, ',' order by tb.name)
     from public.payment_allocations pa
     join public.tracked_balances tb on tb.id = pa.tracked_balance_id
    where pa.transaction_id = current_setting('cb2.split_payment')::uuid),
  'Car=2000/cc200000-0000-0000-0000-000000000002/payment,College=1000/cc200000-0000-0000-0000-000000000002/payment',
  'SP2: the split payment stored exactly its two parts'
);

select is(
  (select string_agg(tb.name || '=' || b.balance_cents::text, ',' order by tb.name)
     from public.household_member_balance_breakdown('cc000000-0000-0000-0000-00000000000a') b
     join public.tracked_balances tb on tb.id = b.tracked_balance_id
    where b.member_id = 'cc200000-0000-0000-0000-000000000002'),
  'Car=8000,College=-1000,Everyday=3800',
  'SP3: the breakdown moved by the parts (Car -2000, College -1000, Everyday unchanged)'
);

select isnt(
  set_config('cb2.split_adjustment', (select id::text from public.record_adjustment(
    p_member_id => 'cc200000-0000-0000-0000-000000000002',
    p_amount_cents => -500,
    p_description => 'Split adjustment',
    p_occurred_on => '2026-10-02',
    p_allocations => '[{"amount_cents":300,"tracked_balance_id":"cc400000-0000-0000-0000-000000000001"},
                       {"tracked_balance_id":"cc400000-0000-0000-0000-000000000002","amount_cents":200}]')), true),
  null,
  'SP4: a split adjustment (Car 300 + College 200, keys in either order) succeeds'
);

select is(
  (select string_agg(tb.name || '=' || b.balance_cents::text, ',' order by tb.name)
     from public.household_member_balance_breakdown('cc000000-0000-0000-0000-00000000000a') b
     join public.tracked_balances tb on tb.id = b.tracked_balance_id
    where b.member_id = 'cc200000-0000-0000-0000-000000000002'),
  'Car=7700,College=-1200,Everyday=3800',
  'SP5: the adjustment''s parts moved the breakdown the same way'
);

select is(
  (select balance_cents from public.household_member_balances('cc000000-0000-0000-0000-00000000000a')
    where member_id = 'cc200000-0000-0000-0000-000000000002'),
  10300::bigint,
  'SP6: C1''s total is simply 15000 - 1000 - 200 - 3000 - 500 = 10300'
);

select is_empty(
  $$ select t.member_id
       from public.household_member_balances('cc000000-0000-0000-0000-00000000000a') t
       left join (select member_id, sum(balance_cents) as s
                    from public.household_member_balance_breakdown('cc000000-0000-0000-0000-00000000000a')
                   group by member_id) d using (member_id)
      where d.s is distinct from t.balance_cents $$,
  'SP7: per member, the breakdown still sums exactly to household_member_balances'
);

-- C2 gets one ordinary payment (used by the Child read tests).
select lives_ok(
  $$ select public.record_payment('cc200000-0000-0000-0000-000000000003', -500, 'C2 payment', '2026-10-02') $$,
  'SP8: an old-shape positional call also still works'
);

-- ---------------------------------------------------------------------------
-- AU: audit rows carry the parts
-- ---------------------------------------------------------------------------

reset role;

select is(
  (select new_values -> 'allocations' from public.audit_log
    where entity_type = 'ledger_transactions' and action = 'insert'
      and entity_id = current_setting('cb2.split_payment')::uuid),
  '[{"tracked_balance_id":"cc400000-0000-0000-0000-000000000001","amount_cents":2000},
    {"tracked_balance_id":"cc400000-0000-0000-0000-000000000002","amount_cents":1000}]'::jsonb,
  'AU1: the split payment''s audit row lists its parts in new_values.allocations'
);

select is(
  (select (new_values ->> 'amount_cents') || '/' || (new_values ->> 'type') from public.audit_log
    where entity_type = 'ledger_transactions' and action = 'insert'
      and entity_id = current_setting('cb2.split_payment')::uuid),
  '-3000/payment',
  'AU2: the audit row still carries the ledger row itself'
);

select is(
  (select new_values -> 'allocations' from public.audit_log
    where entity_type = 'ledger_transactions' and action = 'insert'
      and entity_id = current_setting('cb2.o_payment')::uuid),
  jsonb_build_array(jsonb_build_object('tracked_balance_id', current_setting('cb2.a_everyday'), 'amount_cents', 1000)),
  'AU3: the old-shape payment''s audit row lists its single Everyday part'
);

select is(
  (select jsonb_array_length(new_values -> 'allocations') from public.audit_log
    where entity_type = 'ledger_transactions' and action = 'insert'
      and entity_id = current_setting('cb2.split_adjustment')::uuid),
  2,
  'AU4: the split adjustment''s audit row lists both parts'
);

-- ---------------------------------------------------------------------------
-- R: rejected allocations -- nothing written
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"cc100000-0000-0000-0000-000000000001","role":"authenticated"}';

select throws_ok(
  $$ select public.record_payment('cc200000-0000-0000-0000-000000000002', -1000, 'x', '2026-10-02', null, null,
       '[{"tracked_balance_id":"cc400000-0000-0000-0000-000000000001","amount_cents":600},
         {"tracked_balance_id":"cc400000-0000-0000-0000-000000000002","amount_cents":300}]') $$,
  '23514', 'allocations sum to 900, but the payment is 1000',
  'R1: parts that do not sum to the amount are rejected'
);

select throws_ok(
  $$ select public.record_payment('cc200000-0000-0000-0000-000000000002', -1000, 'x', '2026-10-02', null, null,
       '[{"tracked_balance_id":"cc400000-0000-0000-0000-000000000001","amount_cents":0},
         {"tracked_balance_id":"cc400000-0000-0000-0000-000000000002","amount_cents":1000}]') $$,
  '23514', 'allocation amount_cents must be a positive whole number of cents, got 0',
  'R2: a zero part is rejected'
);

select throws_ok(
  $$ select public.record_payment('cc200000-0000-0000-0000-000000000002', -1000, 'x', '2026-10-02', null, null,
       '[{"tracked_balance_id":"cc400000-0000-0000-0000-000000000001","amount_cents":-100},
         {"tracked_balance_id":"cc400000-0000-0000-0000-000000000002","amount_cents":1100}]') $$,
  '23514', 'allocation amount_cents must be a positive whole number of cents, got -100',
  'R3: a negative part is rejected'
);

select throws_ok(
  $$ select public.record_payment('cc200000-0000-0000-0000-000000000002', -1000, 'x', '2026-10-02', null, null,
       '[{"tracked_balance_id":"cc400000-0000-0000-0000-000000000001","amount_cents":500.5},
         {"tracked_balance_id":"cc400000-0000-0000-0000-000000000002","amount_cents":499.5}]') $$,
  '23514', 'allocation amount_cents must be a positive whole number of cents, got 500.5',
  'R4: a fractional part is rejected (even though the parts sum correctly)'
);

select throws_ok(
  $$ select public.record_payment('cc200000-0000-0000-0000-000000000002', -1000, 'x', '2026-10-02', null, null,
       '[{"tracked_balance_id":"cc400000-0000-0000-0000-000000000001","amount_cents":1000.0}]') $$,
  '23514', 'allocation amount_cents must be a positive whole number of cents, got 1000.0',
  'R5: a decimal-notated whole number (1000.0) is rejected'
);

select throws_ok(
  $$ select public.record_payment('cc200000-0000-0000-0000-000000000002', -1000, 'x', '2026-10-02', null, null,
       '[{"tracked_balance_id":"cc400000-0000-0000-0000-000000000001","amount_cents":"1000"}]') $$,
  '23514', 'allocation amount_cents must be a JSON number',
  'R6: a string amount is rejected'
);

select throws_ok(
  $$ select public.record_payment('cc200000-0000-0000-0000-000000000002', -1000, 'x', '2026-10-02', null, null,
       '[{"tracked_balance_id":"cc400000-0000-0000-0000-00000000000b","amount_cents":1000}]') $$,
  '23514', 'no such balance in this household: cc400000-0000-0000-0000-00000000000b',
  'R7: another household''s balance is rejected'
);

select throws_ok(
  $$ select public.record_payment('cc200000-0000-0000-0000-000000000002', -1000, 'x', '2026-10-02', null, null,
       '[{"tracked_balance_id":"cc400000-0000-0000-0000-0000000000ff","amount_cents":1000}]') $$,
  '23514', 'no such balance in this household: cc400000-0000-0000-0000-0000000000ff',
  'R8: a nonexistent balance gets the same rejection as a foreign one'
);

select throws_ok(
  $$ select public.record_payment('cc200000-0000-0000-0000-000000000002', -1000, 'x', '2026-10-02', null, null,
       '[{"tracked_balance_id":"cc400000-0000-0000-0000-000000000003","amount_cents":1000}]') $$,
  '23514', 'balance "Old" is archived and cannot receive an allocation',
  'R9: an archived balance is rejected'
);

select throws_ok(
  $$ select public.record_payment('cc200000-0000-0000-0000-000000000002', -1000, 'x', '2026-10-02', null, null,
       '[{"tracked_balance_id":"cc400000-0000-0000-0000-000000000001","amount_cents":500},
         {"tracked_balance_id":"cc400000-0000-0000-0000-000000000001","amount_cents":500}]') $$,
  '23514', 'balance "Car" appears more than once in the allocations',
  'R10: the same balance twice is rejected'
);

select throws_ok(
  $$ select public.record_payment('cc200000-0000-0000-0000-000000000002', -1000, 'x', '2026-10-02', null, null, '[]') $$,
  '23514', 'allocations must be a non-empty JSON array',
  'R11: an empty array is rejected'
);

select throws_ok(
  $$ select public.record_payment('cc200000-0000-0000-0000-000000000002', -1000, 'x', '2026-10-02', null, null,
       '{"tracked_balance_id":"cc400000-0000-0000-0000-000000000001","amount_cents":1000}') $$,
  '23514', 'allocations must be a non-empty JSON array',
  'R12: a bare object (not an array) is rejected'
);

select throws_ok(
  $$ select public.record_payment('cc200000-0000-0000-0000-000000000002', -1000, 'x', '2026-10-02', null, null, '[1000]') $$,
  '23514', 'each allocation must be an object with tracked_balance_id and amount_cents',
  'R13: a non-object element is rejected'
);

select throws_ok(
  $$ select public.record_payment('cc200000-0000-0000-0000-000000000002', -1000, 'x', '2026-10-02', null, null,
       '[{"tracked_balance_id":"cc400000-0000-0000-0000-000000000001","amount_cents":1000,"note":"x"}]') $$,
  '23514', 'each allocation must have exactly the keys tracked_balance_id and amount_cents',
  'R14: an extra key is rejected'
);

select throws_ok(
  $$ select public.record_payment('cc200000-0000-0000-0000-000000000002', -1000, 'x', '2026-10-02', null, null,
       '[{"amount_cents":1000}]') $$,
  '23514', 'each allocation must have exactly the keys tracked_balance_id and amount_cents',
  'R15: a missing key is rejected'
);

select throws_ok(
  $$ select public.record_payment('cc200000-0000-0000-0000-000000000002', -1000, 'x', '2026-10-02', null, null,
       '[{"tracked_balance_id":"not-a-uuid","amount_cents":1000}]') $$,
  '23514', 'allocation tracked_balance_id must be a uuid string',
  'R16: a malformed balance id is rejected'
);

select throws_ok(
  $$ select public.record_adjustment('cc200000-0000-0000-0000-000000000002', -1000, 'x', '2026-10-02', null, null,
       '[{"tracked_balance_id":"cc400000-0000-0000-0000-000000000001","amount_cents":999}]') $$,
  '23514', 'allocations sum to 999, but the adjustment is 1000',
  'R17: record_adjustment validates its parts the same way'
);

reset role;

-- 4 successful A writes for C1 + 1 for C2; 3 fixture expenses.
select is(
  (select count(*) from public.ledger_transactions where household_id = 'cc000000-0000-0000-0000-00000000000a'),
  8::bigint,
  'RN1: no ledger row was written by any rejected call'
);

select is(
  (select count(*) from public.payment_allocations where household_id = 'cc000000-0000-0000-0000-00000000000a'),
  7::bigint,
  'RN2: no allocation part was written by any rejected call (1 + 1 + 2 + 2 + 1)'
);

select is(
  (select count(*) from public.audit_log
    where household_id = 'cc000000-0000-0000-0000-00000000000a'
      and entity_type = 'ledger_transactions' and action = 'insert'),
  5::bigint,
  'RN3: no audit row was written by any rejected call'
);

-- ---------------------------------------------------------------------------
-- W: direct writes on payment_allocations, every app role
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"cc100000-0000-0000-0000-000000000001","role":"authenticated"}';

select throws_ok(
  $$ insert into public.payment_allocations
       (household_id, member_id, transaction_id, transaction_type, tracked_balance_id, amount_cents)
     values ('cc000000-0000-0000-0000-00000000000a', 'cc200000-0000-0000-0000-000000000002',
             current_setting('cb2.split_payment')::uuid, 'payment', current_setting('cb2.a_everyday')::uuid, 1) $$,
  '42501', null,
  'W1: a Parent cannot INSERT a part directly'
);

select throws_ok(
  $$ update public.payment_allocations set amount_cents = 1
      where transaction_id = current_setting('cb2.split_payment')::uuid $$,
  '42501', null,
  'W2: a Parent cannot UPDATE a part directly'
);

select throws_ok(
  $$ delete from public.payment_allocations
      where transaction_id = current_setting('cb2.split_payment')::uuid $$,
  '42501', null,
  'W3: a Parent cannot DELETE a part directly'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"cc100000-0000-0000-0000-000000000002","role":"authenticated"}';

select throws_ok(
  $$ insert into public.payment_allocations
       (household_id, member_id, transaction_id, transaction_type, tracked_balance_id, amount_cents)
     values ('cc000000-0000-0000-0000-00000000000a', 'cc200000-0000-0000-0000-000000000002',
             current_setting('cb2.split_payment')::uuid, 'payment', current_setting('cb2.a_everyday')::uuid, 1) $$,
  '42501', null,
  'W4: a Child cannot INSERT a part directly'
);

select throws_ok(
  $$ update public.payment_allocations set tracked_balance_id = current_setting('cb2.a_everyday')::uuid
      where transaction_id = current_setting('cb2.split_payment')::uuid $$,
  '42501', null,
  'W5: a Child cannot UPDATE (re-point) a part directly'
);

select throws_ok(
  $$ delete from public.payment_allocations
      where transaction_id = current_setting('cb2.split_payment')::uuid $$,
  '42501', null,
  'W6: a Child cannot DELETE a part directly'
);

-- ---------------------------------------------------------------------------
-- CH: Child -- still no payments/adjustments; reads own parts only
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select public.record_payment('cc200000-0000-0000-0000-000000000002', -1000, 'child', '2026-10-02', null, null,
       '[{"tracked_balance_id":"cc400000-0000-0000-0000-000000000001","amount_cents":1000}]') $$,
  '42501', 'only an active Parent may record a payment',
  'CH1: a Child cannot record a split payment against themselves'
);

select throws_ok(
  $$ select public.record_adjustment('cc200000-0000-0000-0000-000000000002', -1000, 'child', '2026-10-02', null, null,
       '[{"tracked_balance_id":"cc400000-0000-0000-0000-000000000001","amount_cents":1000}]') $$,
  '42501', 'only an active Parent may record a adjustment',
  'CH2: a Child cannot record a split adjustment'
);

select throws_ok(
  $$ select public.record_payment('cc200000-0000-0000-0000-000000000002', -1000, 'child', '2026-10-02', null, null,
       '[{"tracked_balance_id":"cc400000-0000-0000-0000-00000000000b","amount_cents":5}]') $$,
  '42501', 'only an active Parent may record a payment',
  'CH3: authorization is checked before allocations (a Child learns nothing about balances)'
);

select is(
  (select count(*) from public.payment_allocations),
  6::bigint,
  'CH4: C1 reads exactly their own six parts'
);

select is(
  (select count(*) from public.payment_allocations
    where member_id <> 'cc200000-0000-0000-0000-000000000002'),
  0::bigint,
  'CH5: C1 sees none of C2''s parts'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"cc100000-0000-0000-0000-000000000003","role":"authenticated"}';

select is(
  (select string_agg(member_id::text || '=' || amount_cents::text, ',') from public.payment_allocations),
  'cc200000-0000-0000-0000-000000000003=500',
  'CH6: C2 reads only their own single part'
);

reset role;

select is(
  (select count(*) from public.payment_allocations where household_id = 'cc000000-0000-0000-0000-00000000000a'),
  7::bigint,
  'CH7: after every Child attempt, household A still has exactly 7 parts'
);

-- ---------------------------------------------------------------------------
-- X: Parent reads, cross-household, outsider, anon
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"cc100000-0000-0000-0000-000000000001","role":"authenticated"}';

select is(
  (select count(*) from public.payment_allocations where household_id = 'cc000000-0000-0000-0000-00000000000a'),
  7::bigint,
  'X1: the Parent reads every part in their household'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"cc100000-0000-0000-0000-000000000005","role":"authenticated"}';

select is(
  (select count(*) from public.payment_allocations where household_id = 'cc000000-0000-0000-0000-00000000000a'),
  0::bigint,
  'X2: the Parent of B reads none of household A''s parts'
);

select throws_ok(
  $$ select public.record_payment('cc200000-0000-0000-0000-000000000002', -1000, 'x', '2026-10-02', null, null,
       '[{"tracked_balance_id":"cc400000-0000-0000-0000-00000000000b","amount_cents":1000}]') $$,
  '42501', null,
  'X3: the Parent of B cannot record a payment for A''s child, even onto B''s own balance'
);

select throws_ok(
  $$ select public.record_payment('cc200000-0000-0000-0000-000000000006', -800, 'x', '2026-10-02', null, null,
       '[{"tracked_balance_id":"cc400000-0000-0000-0000-000000000001","amount_cents":800}]') $$,
  '23514', 'no such balance in this household: cc400000-0000-0000-0000-000000000001',
  'X4: the Parent of B cannot allocate their own child''s payment onto A''s balance'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"cc100000-0000-0000-0000-000000000007","role":"authenticated"}';

select is(
  (select count(*) from public.payment_allocations),
  0::bigint,
  'X5: an authenticated non-member reads no parts'
);

reset role;
set local role anon;
set local request.jwt.claims to '{"role":"anon"}';

select throws_ok(
  $$ select count(*) from public.payment_allocations $$,
  '42501', null,
  'X6: anon cannot read payment_allocations'
);

select throws_ok(
  $$ insert into public.payment_allocations
       (household_id, member_id, transaction_id, transaction_type, tracked_balance_id, amount_cents)
     values ('cc000000-0000-0000-0000-00000000000a', 'cc200000-0000-0000-0000-000000000002',
             current_setting('cb2.split_payment')::uuid, 'payment', current_setting('cb2.a_everyday')::uuid, 1) $$,
  '42501', null,
  'X7: anon cannot INSERT a part'
);

select throws_ok(
  $$ delete from public.payment_allocations $$,
  '42501', null,
  'X8: anon cannot DELETE parts'
);

select throws_ok(
  $$ select public.record_payment('cc200000-0000-0000-0000-000000000002', -1000, 'x', '2026-10-02', null, null,
       '[{"tracked_balance_id":"cc400000-0000-0000-0000-000000000001","amount_cents":1000}]') $$,
  '42501', null,
  'X9: anon cannot call record_payment'
);

reset role;

-- ---------------------------------------------------------------------------
-- V: voiding removes the parts' effect, parts themselves untouched
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"cc100000-0000-0000-0000-000000000001","role":"authenticated"}';

select lives_ok(
  $$ select public.void_ledger_transaction(current_setting('cb2.split_payment')::uuid, 'entered twice') $$,
  'V1: a Parent voids the split payment'
);

select is(
  (select string_agg(tb.name || '=' || b.balance_cents::text, ',' order by tb.name)
     from public.household_member_balance_breakdown('cc000000-0000-0000-0000-00000000000a') b
     join public.tracked_balances tb on tb.id = b.tracked_balance_id
    where b.member_id = 'cc200000-0000-0000-0000-000000000002'),
  'Car=9700,College=-200,Everyday=3800',
  'V2: the voided payment''s parts no longer count (Car +2000, College +1000)'
);

select is(
  (select balance_cents from public.household_member_balances('cc000000-0000-0000-0000-00000000000a')
    where member_id = 'cc200000-0000-0000-0000-000000000002'),
  13300::bigint,
  'V3: C1''s total rose by the voided 3000'
);

select is_empty(
  $$ select t.member_id
       from public.household_member_balances('cc000000-0000-0000-0000-00000000000a') t
       left join (select member_id, sum(balance_cents) as s
                    from public.household_member_balance_breakdown('cc000000-0000-0000-0000-00000000000a')
                   group by member_id) d using (member_id)
      where d.s is distinct from t.balance_cents $$,
  'V4: after the void, every member''s breakdown still sums to the total'
);

select is(
  (select count(*) from public.payment_allocations
    where transaction_id = current_setting('cb2.split_payment')::uuid),
  2::bigint,
  'V5: voiding left the payment''s parts in place (history preserved)'
);

reset role;

-- ---------------------------------------------------------------------------
-- D: declarative and trigger enforcement, even for postgres
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ insert into public.ledger_transactions
       (id, household_id, member_id, amount_cents, type, description, occurred_on, created_by)
     values ('cc500000-0000-0000-0000-000000000010', 'cc000000-0000-0000-0000-00000000000a',
             'cc200000-0000-0000-0000-000000000002', -700, 'payment', 'no parts', '2026-10-02',
             'cc200000-0000-0000-0000-000000000001');
     set constraints public.ledger_transactions_allocations_sum_check immediate $$,
  '23514', 'allocation parts of payment cc500000-0000-0000-0000-000000000010 sum to 0, expected 700',
  'D1: a payment with zero parts fails the sum check (at commit; forced here)'
);
set constraints public.ledger_transactions_allocations_sum_check, public.payment_allocations_sum_check deferred;

select throws_ok(
  $$ insert into public.ledger_transactions
       (id, household_id, member_id, amount_cents, type, description, occurred_on, created_by)
     values ('cc500000-0000-0000-0000-000000000011', 'cc000000-0000-0000-0000-00000000000a',
             'cc200000-0000-0000-0000-000000000002', -700, 'payment', 'short parts', '2026-10-02',
             'cc200000-0000-0000-0000-000000000001');
     insert into public.payment_allocations
       (household_id, member_id, transaction_id, transaction_type, tracked_balance_id, amount_cents)
     values ('cc000000-0000-0000-0000-00000000000a', 'cc200000-0000-0000-0000-000000000002',
             'cc500000-0000-0000-0000-000000000011', 'payment', 'cc400000-0000-0000-0000-000000000001', 600);
     set constraints public.ledger_transactions_allocations_sum_check, public.payment_allocations_sum_check immediate $$,
  '23514', 'allocation parts of payment cc500000-0000-0000-0000-000000000011 sum to 600, expected 700',
  'D2: parts that do not sum to the amount fail the sum check'
);
set constraints public.ledger_transactions_allocations_sum_check, public.payment_allocations_sum_check deferred;

select lives_ok(
  $$ insert into public.ledger_transactions
       (id, household_id, member_id, amount_cents, type, description, occurred_on, created_by)
     values ('cc500000-0000-0000-0000-000000000012', 'cc000000-0000-0000-0000-00000000000a',
             'cc200000-0000-0000-0000-000000000002', -700, 'payment', 'good parts', '2026-10-02',
             'cc200000-0000-0000-0000-000000000001');
     insert into public.payment_allocations
       (household_id, member_id, transaction_id, transaction_type, tracked_balance_id, amount_cents)
     values ('cc000000-0000-0000-0000-00000000000a', 'cc200000-0000-0000-0000-000000000002',
             'cc500000-0000-0000-0000-000000000012', 'payment', 'cc400000-0000-0000-0000-000000000001', 400),
            ('cc000000-0000-0000-0000-00000000000a', 'cc200000-0000-0000-0000-000000000002',
             'cc500000-0000-0000-0000-000000000012', 'payment', 'cc400000-0000-0000-0000-000000000002', 300);
     set constraints public.ledger_transactions_allocations_sum_check, public.payment_allocations_sum_check immediate $$,
  'D3: a directly written payment whose parts sum correctly passes the sum check'
);
set constraints public.ledger_transactions_allocations_sum_check, public.payment_allocations_sum_check deferred;

select throws_ok(
  $$ update public.ledger_transactions set amount_cents = -800
      where id = 'cc500000-0000-0000-0000-000000000012';
     set constraints public.ledger_transactions_allocations_sum_check immediate $$,
  '23514', 'allocation parts of payment cc500000-0000-0000-0000-000000000012 sum to 700, expected 800',
  'D4: changing a payment''s amount under its parts fails the sum check'
);
set constraints public.ledger_transactions_allocations_sum_check, public.payment_allocations_sum_check deferred;

select throws_ok(
  $$ insert into public.payment_allocations
       (household_id, member_id, transaction_id, transaction_type, tracked_balance_id, amount_cents)
     values ('cc000000-0000-0000-0000-00000000000a', 'cc200000-0000-0000-0000-000000000002',
             'cc500000-0000-0000-0000-000000000001', 'expense', 'cc400000-0000-0000-0000-000000000001', 1) $$,
  '23514', null,
  'D5: a part typed as an expense part is rejected'
);

select throws_ok(
  $$ insert into public.payment_allocations
       (household_id, member_id, transaction_id, transaction_type, tracked_balance_id, amount_cents)
     values ('cc000000-0000-0000-0000-00000000000a', 'cc200000-0000-0000-0000-000000000002',
             'cc500000-0000-0000-0000-000000000001', 'payment', 'cc400000-0000-0000-0000-000000000001', 1) $$,
  '23503', null,
  'D6: a part cannot hang off an expense row (type is part of the FK)'
);

select throws_ok(
  $$ insert into public.payment_allocations
       (household_id, member_id, transaction_id, transaction_type, tracked_balance_id, amount_cents)
     values ('cc000000-0000-0000-0000-00000000000a', 'cc200000-0000-0000-0000-000000000003',
             'cc500000-0000-0000-0000-000000000012', 'payment', current_setting('cb2.a_everyday')::uuid, 1) $$,
  '23503', null,
  'D7: a part''s member must be its transaction''s member'
);

select throws_ok(
  $$ insert into public.payment_allocations
       (household_id, member_id, transaction_id, transaction_type, tracked_balance_id, amount_cents)
     values ('cc000000-0000-0000-0000-00000000000a', 'cc200000-0000-0000-0000-000000000002',
             'cc500000-0000-0000-0000-000000000012', 'payment', 'cc400000-0000-0000-0000-00000000000b', 1) $$,
  '23503', null,
  'D8: a part''s balance must be in its transaction''s household'
);

select throws_ok(
  $$ insert into public.payment_allocations
       (household_id, member_id, transaction_id, transaction_type, tracked_balance_id, amount_cents)
     values ('cc000000-0000-0000-0000-00000000000a', 'cc200000-0000-0000-0000-000000000002',
             'cc500000-0000-0000-0000-000000000012', 'payment', 'cc400000-0000-0000-0000-000000000001', 1) $$,
  '23505', null,
  'D9: one part per balance per transaction'
);

select throws_ok(
  $$ update public.payment_allocations set amount_cents = amount_cents
      where transaction_id = 'cc500000-0000-0000-0000-000000000012' $$,
  '23514', 'payment allocations cannot be changed',
  'D10: even postgres cannot UPDATE a part'
);

select throws_ok(
  $$ delete from public.payment_allocations
      where transaction_id = 'cc500000-0000-0000-0000-000000000012' $$,
  '23514', 'payment allocations cannot be deleted',
  'D11: even postgres cannot DELETE a part on its own'
);

select lives_ok(
  $$ delete from public.ledger_transactions where id = 'cc500000-0000-0000-0000-000000000012' $$,
  'D12: deleting the transaction itself (owner-only) cascades through its parts'
);

select is(
  (select count(*) from public.payment_allocations where transaction_id = 'cc500000-0000-0000-0000-000000000012'),
  0::bigint,
  'D13: the cascaded parts are gone'
);

select * from finish();

rollback;
