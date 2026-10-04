-- Regression tests: CB3 -- balance transfers ("move money").
--
-- Covers 20261003150000_balance_transfers.sql: public.balance_transfers
-- (composite same-household FKs, CHECKs, immutability guard, RLS/grants),
-- public.record_balance_transfer / public.void_balance_transfer (Parent-only,
-- audited), and household_member_balance_breakdown including transfers.
--
-- Direction under test (see the migration header): a transfer of A from F
-- to T moves PAID CREDIT -- F's balance goes UP by A, T's goes DOWN by A,
-- the member's total is unchanged. WE reproduces the header's worked example.
--
-- Role-switching idiom matches 003/005/013/014: fixtures run as postgres;
-- each persona block sets `role authenticated` (or `anon`) plus
-- `request.jwt.claims`; `reset role` returns to postgres.
--
-- Self-contained: creates its own fixtures, depends on nothing in seed.sql,
-- and the whole file runs inside begin/rollback.
--
-- Run with: npm run test:db  (wraps `npx supabase test db --local`)

begin;

create extension if not exists pgtap with schema extensions;
set local search_path to extensions, public, pg_catalog;

select plan(80);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
--
-- Household A: P1 (Parent), C1, C2 (Children), CX (archived Child).
--   Balances: Everyday (trigger), Car, College, Old (archived).
--   Category Auto -- NOT mapped yet (WE maps it to Car).
-- Household B: P2 (Parent), C3 (Child). Balance B Savings.
-- Household C: PC (Parent) -- only used for the household-delete cascade.
-- NOUSER: authenticated, member of nothing.

insert into public.households (id, name, timezone) values
  ('dd000000-0000-0000-0000-00000000000a', 'CB3 Household A', 'America/Chicago'),
  ('dd000000-0000-0000-0000-00000000000b', 'CB3 Household B', 'Europe/Paris'),
  ('dd000000-0000-0000-0000-00000000000c', 'CB3 Household C', 'Europe/Paris');

insert into auth.users (id, email) values
  ('dd100000-0000-0000-0000-000000000001', 'p1-cb3@example.test'),
  ('dd100000-0000-0000-0000-000000000002', 'c1-cb3@example.test'),
  ('dd100000-0000-0000-0000-000000000003', 'c2-cb3@example.test'),
  ('dd100000-0000-0000-0000-000000000005', 'p2-cb3@example.test'),
  ('dd100000-0000-0000-0000-000000000006', 'c3-cb3@example.test'),
  ('dd100000-0000-0000-0000-000000000007', 'nouser-cb3@example.test'),
  ('dd100000-0000-0000-0000-000000000008', 'pc-cb3@example.test');

insert into public.household_members (id, household_id, user_id, name, role, status) values
  ('dd200000-0000-0000-0000-000000000001', 'dd000000-0000-0000-0000-00000000000a',
   'dd100000-0000-0000-0000-000000000001', 'P1', 'parent', 'active'),
  ('dd200000-0000-0000-0000-000000000002', 'dd000000-0000-0000-0000-00000000000a',
   'dd100000-0000-0000-0000-000000000002', 'C1', 'child',  'active'),
  ('dd200000-0000-0000-0000-000000000003', 'dd000000-0000-0000-0000-00000000000a',
   'dd100000-0000-0000-0000-000000000003', 'C2', 'child',  'active'),
  ('dd200000-0000-0000-0000-000000000004', 'dd000000-0000-0000-0000-00000000000a',
   null, 'CX', 'child', 'archived'),
  ('dd200000-0000-0000-0000-000000000005', 'dd000000-0000-0000-0000-00000000000b',
   'dd100000-0000-0000-0000-000000000005', 'P2', 'parent', 'active'),
  ('dd200000-0000-0000-0000-000000000006', 'dd000000-0000-0000-0000-00000000000b',
   'dd100000-0000-0000-0000-000000000006', 'C3', 'child',  'active'),
  ('dd200000-0000-0000-0000-000000000008', 'dd000000-0000-0000-0000-00000000000c',
   'dd100000-0000-0000-0000-000000000008', 'PC', 'parent', 'active');

insert into public.tracked_balances (id, household_id, name, active) values
  ('dd400000-0000-0000-0000-000000000001', 'dd000000-0000-0000-0000-00000000000a', 'Car', true),
  ('dd400000-0000-0000-0000-000000000002', 'dd000000-0000-0000-0000-00000000000a', 'College', true),
  ('dd400000-0000-0000-0000-000000000003', 'dd000000-0000-0000-0000-00000000000a', 'Old', false),
  ('dd400000-0000-0000-0000-00000000000b', 'dd000000-0000-0000-0000-00000000000b', 'B Savings', true),
  ('dd400000-0000-0000-0000-00000000000c', 'dd000000-0000-0000-0000-00000000000c', 'C Fund', true);

insert into public.categories (id, household_id, name) values
  ('dd300000-0000-0000-0000-000000000001', 'dd000000-0000-0000-0000-00000000000a', 'Auto');

-- Worked example, C1: $300 car expense (Auto), $50 other expense.
-- C2: $30 expense. C3 (B): $8 expense.
insert into public.ledger_transactions
  (id, household_id, member_id, amount_cents, type, category_id, description, occurred_on, created_by) values
  ('dd500000-0000-0000-0000-000000000001', 'dd000000-0000-0000-0000-00000000000a',
   'dd200000-0000-0000-0000-000000000002', 30000, 'expense', 'dd300000-0000-0000-0000-000000000001',
   'car repair', '2026-09-01', 'dd200000-0000-0000-0000-000000000001'),
  ('dd500000-0000-0000-0000-000000000002', 'dd000000-0000-0000-0000-00000000000a',
   'dd200000-0000-0000-0000-000000000002', 5000, 'expense', null,
   'misc', '2026-09-01', 'dd200000-0000-0000-0000-000000000001'),
  ('dd500000-0000-0000-0000-000000000003', 'dd000000-0000-0000-0000-00000000000a',
   'dd200000-0000-0000-0000-000000000003', 3000, 'expense', null,
   'misc', '2026-09-01', 'dd200000-0000-0000-0000-000000000001'),
  ('dd500000-0000-0000-0000-000000000004', 'dd000000-0000-0000-0000-00000000000b',
   'dd200000-0000-0000-0000-000000000006', 800, 'expense', null,
   'b thing', '2026-09-01', 'dd200000-0000-0000-0000-000000000005');

select set_config('cb3.a_everyday',
  (select id::text from public.tracked_balances
    where household_id = 'dd000000-0000-0000-0000-00000000000a' and is_everyday), true);
select set_config('cb3.b_everyday',
  (select id::text from public.tracked_balances
    where household_id = 'dd000000-0000-0000-0000-00000000000b' and is_everyday), true);

-- ---------------------------------------------------------------------------
-- S: structure and grants
-- ---------------------------------------------------------------------------

select ok(to_regclass('public.balance_transfers') is not null, 'S1: public.balance_transfers exists');

select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = to_regclass('public.balance_transfers')),
  'S2: RLS is enabled on balance_transfers'
);

select ok(
  not has_table_privilege('authenticated', 'public.balance_transfers', 'INSERT')
  and not has_table_privilege('authenticated', 'public.balance_transfers', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.balance_transfers', 'DELETE')
  and not has_table_privilege('authenticated', 'public.balance_transfers', 'TRUNCATE')
  and has_table_privilege('authenticated', 'public.balance_transfers', 'SELECT'),
  'S3: authenticated may only SELECT balance_transfers'
);

select ok(
  not has_table_privilege('anon', 'public.balance_transfers', 'SELECT')
  and not has_table_privilege('anon', 'public.balance_transfers', 'INSERT')
  and not has_table_privilege('anon', 'public.balance_transfers', 'UPDATE')
  and not has_table_privilege('anon', 'public.balance_transfers', 'DELETE'),
  'S4: anon has no privileges on balance_transfers'
);

select ok(
  has_function_privilege('authenticated', 'public.record_balance_transfer(uuid,uuid,uuid,bigint,date,text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.void_balance_transfer(uuid,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.record_balance_transfer(uuid,uuid,uuid,bigint,date,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.void_balance_transfer(uuid,text)', 'EXECUTE'),
  'S5: authenticated (not anon) can EXECUTE record_balance_transfer / void_balance_transfer'
);

select ok(
  not has_function_privilege('authenticated', 'internal.balance_transfers_guard()', 'EXECUTE')
  and not has_function_privilege('anon', 'internal.balance_transfers_guard()', 'EXECUTE'),
  'S6: the guard trigger function is not executable by app roles'
);

-- ---------------------------------------------------------------------------
-- WE: the migration header's worked example (Everyday credit moved to Car)
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"dd100000-0000-0000-0000-000000000001","role":"authenticated"}';

-- The $200 payment, before Car is mapped: whole amount to Everyday.
select lives_ok(
  $$ select public.record_payment('dd200000-0000-0000-0000-000000000002', -20000, 'Payment', '2026-09-15') $$,
  'WE1: C1 pays $200 (all on Everyday)'
);

select is(
  (select string_agg(tb.name || '=' || b.balance_cents::text, ',' order by tb.name)
     from public.household_member_balance_breakdown('dd000000-0000-0000-0000-00000000000a') b
     join public.tracked_balances tb on tb.id = b.tracked_balance_id
    where b.member_id = 'dd200000-0000-0000-0000-000000000002'),
  'Everyday=15000',
  'WE2: before Car is mapped, everything is on Everyday (+$150)'
);

select lives_ok(
  $$ select public.set_category_balance('dd300000-0000-0000-0000-000000000001', 'dd400000-0000-0000-0000-000000000001') $$,
  'WE3: the Parent points Auto at Car'
);

select is(
  (select string_agg(tb.name || '=' || b.balance_cents::text, ',' order by tb.name)
     from public.household_member_balance_breakdown('dd000000-0000-0000-0000-00000000000a') b
     join public.tracked_balances tb on tb.id = b.tracked_balance_id
    where b.member_id = 'dd200000-0000-0000-0000-000000000002'),
  'Car=30000,Everyday=-15000',
  'WE4: the $300 expense moved to Car; the $200 payment stayed on Everyday'
);

select is(
  (select balance_cents from public.household_member_balances('dd000000-0000-0000-0000-00000000000a')
    where member_id = 'dd200000-0000-0000-0000-000000000002'),
  15000::bigint,
  'WE5: C1''s total before the transfer is $150'
);

select isnt(
  set_config('cb3.we_transfer', (select id::text from public.record_balance_transfer(
    p_member_id => 'dd200000-0000-0000-0000-000000000002',
    p_from_tracked_balance_id => current_setting('cb3.a_everyday')::uuid,
    p_to_tracked_balance_id => 'dd400000-0000-0000-0000-000000000001',
    p_amount_cents => 15000,
    p_occurred_on => '2026-10-03',
    p_note => 'move old payments to Car')), true),
  null,
  'WE6: the Parent moves $150 FROM Everyday TO Car'
);

select is(
  (select string_agg(tb.name || '=' || b.balance_cents::text, ',' order by tb.name)
     from public.household_member_balance_breakdown('dd000000-0000-0000-0000-00000000000a') b
     join public.tracked_balances tb on tb.id = b.tracked_balance_id
    where b.member_id = 'dd200000-0000-0000-0000-000000000002'),
  'Car=15000,Everyday=0',
  'WE7: after the transfer Everyday went UP by $150 (to 0) and Car went DOWN by $150'
);

select is(
  (select balance_cents from public.household_member_balances('dd000000-0000-0000-0000-00000000000a')
    where member_id = 'dd200000-0000-0000-0000-000000000002'),
  15000::bigint,
  'WE8: C1''s total is unchanged by the transfer'
);

select is(
  (select m.name || '/' || t.amount_cents::text || '/' || t.occurred_on::text || '/' || t.note || '/' || (t.voided_at is null)::text
     from public.balance_transfers t
     join public.household_members m on m.id = t.created_by
    where t.id = current_setting('cb3.we_transfer')::uuid),
  'P1/15000/2026-10-03/move old payments to Car/true',
  'WE9: the stored row carries amount, date, note and created_by = the calling Parent'
);

-- C2: a transfer onto a balance with no other activity, pushing it negative.
select lives_ok(
  $$ select public.record_balance_transfer('dd200000-0000-0000-0000-000000000003',
       'dd400000-0000-0000-0000-000000000001', 'dd400000-0000-0000-0000-000000000002', 500, '2026-10-03') $$,
  'WE10: the Parent moves $5 of C2''s credit from Car to College (positional call, no note)'
);

select is(
  (select string_agg(tb.name || '=' || b.balance_cents::text, ',' order by tb.name)
     from public.household_member_balance_breakdown('dd000000-0000-0000-0000-00000000000a') b
     join public.tracked_balances tb on tb.id = b.tracked_balance_id
    where b.member_id = 'dd200000-0000-0000-0000-000000000003'),
  'Car=500,College=-500,Everyday=3000',
  'WE11: balances touched only by a transfer appear as rows; a negative (credit) balance is allowed'
);

select is_empty(
  $$ select t.member_id
       from public.household_member_balances('dd000000-0000-0000-0000-00000000000a') t
       left join (select member_id, sum(balance_cents) as s
                    from public.household_member_balance_breakdown('dd000000-0000-0000-0000-00000000000a')
                   group by member_id) d using (member_id)
      where d.s is distinct from t.balance_cents $$,
  'WE12: per member, the breakdown still sums exactly to household_member_balances'
);

reset role;

select is(
  (select count(*) from public.ledger_transactions where household_id = 'dd000000-0000-0000-0000-00000000000a'),
  4::bigint,
  'WE13: a transfer is not a ledger row (3 fixture expenses + 1 payment only)'
);

-- B: one transfer for C3, used by the cross-household tests.
set local role authenticated;
set local request.jwt.claims to '{"sub":"dd100000-0000-0000-0000-000000000005","role":"authenticated"}';

select isnt(
  set_config('cb3.b_transfer', (select id::text from public.record_balance_transfer(
    'dd200000-0000-0000-0000-000000000006', current_setting('cb3.b_everyday')::uuid,
    'dd400000-0000-0000-0000-00000000000b', 100, '2026-10-03')), true),
  null,
  'WE14: the Parent of B records a transfer for their own child'
);

reset role;

-- ---------------------------------------------------------------------------
-- AU: audit
-- ---------------------------------------------------------------------------

select is(
  (select (new_values ->> 'amount_cents') || '/' || (new_values ->> 'from_tracked_balance_id')
          || '/' || (new_values ->> 'to_tracked_balance_id') || '/' || actor_user_id::text
     from public.audit_log
    where entity_type = 'balance_transfers' and action = 'insert'
      and entity_id = current_setting('cb3.we_transfer')::uuid),
  '15000/' || current_setting('cb3.a_everyday') || '/dd400000-0000-0000-0000-000000000001/dd100000-0000-0000-0000-000000000001',
  'AU1: recording a transfer writes an insert audit row carrying the row and the acting user'
);

select is(
  (select count(*) from public.audit_log
    where household_id = 'dd000000-0000-0000-0000-00000000000a' and entity_type = 'balance_transfers'),
  2::bigint,
  'AU2: one audit row per recorded transfer in household A'
);

-- ---------------------------------------------------------------------------
-- R: rejected transfers (Parent) -- nothing written
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"dd100000-0000-0000-0000-000000000001","role":"authenticated"}';

select throws_ok(
  $$ select public.record_balance_transfer('dd200000-0000-0000-0000-000000000002',
       'dd400000-0000-0000-0000-000000000001', 'dd400000-0000-0000-0000-000000000001', 100, '2026-10-03') $$,
  '23514', 'cannot move money from a balance to itself',
  'R1: from = to is rejected'
);

select throws_ok(
  $$ select public.record_balance_transfer('dd200000-0000-0000-0000-000000000002',
       'dd400000-0000-0000-0000-000000000001', 'dd400000-0000-0000-0000-00000000000b', 100, '2026-10-03') $$,
  '23514', 'no such balance in this household: dd400000-0000-0000-0000-00000000000b',
  'R2: another household''s balance (as to) is rejected'
);

select throws_ok(
  $$ select public.record_balance_transfer('dd200000-0000-0000-0000-000000000002',
       'dd400000-0000-0000-0000-00000000000b', 'dd400000-0000-0000-0000-000000000001', 100, '2026-10-03') $$,
  '23514', 'no such balance in this household: dd400000-0000-0000-0000-00000000000b',
  'R3: another household''s balance (as from) is rejected'
);

select throws_ok(
  $$ select public.record_balance_transfer('dd200000-0000-0000-0000-000000000002',
       'dd400000-0000-0000-0000-000000000001', 'dd400000-0000-0000-0000-0000000000ff', 100, '2026-10-03') $$,
  '23514', 'no such balance in this household: dd400000-0000-0000-0000-0000000000ff',
  'R4: a nonexistent balance gets the same rejection as a foreign one'
);

select throws_ok(
  $$ select public.record_balance_transfer('dd200000-0000-0000-0000-000000000002',
       'dd400000-0000-0000-0000-000000000003', 'dd400000-0000-0000-0000-000000000001', 100, '2026-10-03') $$,
  '23514', 'balance "Old" is archived and cannot be used in a transfer',
  'R5: an archived from balance is rejected'
);

select throws_ok(
  $$ select public.record_balance_transfer('dd200000-0000-0000-0000-000000000002',
       'dd400000-0000-0000-0000-000000000001', 'dd400000-0000-0000-0000-000000000003', 100, '2026-10-03') $$,
  '23514', 'balance "Old" is archived and cannot be used in a transfer',
  'R6: an archived to balance is rejected'
);

select throws_ok(
  $$ select public.record_balance_transfer('dd200000-0000-0000-0000-000000000002',
       'dd400000-0000-0000-0000-000000000001', 'dd400000-0000-0000-0000-000000000002', 0, '2026-10-03') $$,
  '23514', 'transfer amount_cents must be positive, got 0',
  'R7: a zero amount is rejected'
);

select throws_ok(
  $$ select public.record_balance_transfer('dd200000-0000-0000-0000-000000000002',
       'dd400000-0000-0000-0000-000000000001', 'dd400000-0000-0000-0000-000000000002', -100, '2026-10-03') $$,
  '23514', 'transfer amount_cents must be positive, got -100',
  'R8: a negative amount is rejected'
);

select throws_ok(
  $$ select public.record_balance_transfer('dd200000-0000-0000-0000-000000000004',
       'dd400000-0000-0000-0000-000000000001', 'dd400000-0000-0000-0000-000000000002', 100, '2026-10-03') $$,
  '42501', 'household member dd200000-0000-0000-0000-000000000004 is not active',
  'R9: an inactive (archived) member is rejected'
);

select throws_ok(
  $$ select public.record_balance_transfer('dd200000-0000-0000-0000-000000000002',
       null, 'dd400000-0000-0000-0000-000000000002', 100, '2026-10-03') $$,
  '23514', 'both a from balance and a to balance are required',
  'R10: a missing balance id is rejected'
);

reset role;

select is(
  (select count(*) from public.balance_transfers where household_id = 'dd000000-0000-0000-0000-00000000000a'),
  2::bigint,
  'RN1: no transfer was written by any rejected call'
);

select is(
  (select count(*) from public.audit_log
    where household_id = 'dd000000-0000-0000-0000-00000000000a' and entity_type = 'balance_transfers'),
  2::bigint,
  'RN2: no audit row was written by any rejected call'
);

-- ---------------------------------------------------------------------------
-- W: direct writes by a Parent
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"dd100000-0000-0000-0000-000000000001","role":"authenticated"}';

select throws_ok(
  $$ insert into public.balance_transfers
       (household_id, member_id, from_tracked_balance_id, to_tracked_balance_id, amount_cents, occurred_on, created_by)
     values ('dd000000-0000-0000-0000-00000000000a', 'dd200000-0000-0000-0000-000000000002',
             'dd400000-0000-0000-0000-000000000001', 'dd400000-0000-0000-0000-000000000002', 1, '2026-10-03',
             'dd200000-0000-0000-0000-000000000001') $$,
  '42501', null,
  'W1: a Parent cannot INSERT a transfer directly (no audit would be written)'
);

select throws_ok(
  $$ update public.balance_transfers set amount_cents = 1
      where id = current_setting('cb3.we_transfer')::uuid $$,
  '42501', null,
  'W2: a Parent cannot UPDATE a transfer''s amount directly'
);

select throws_ok(
  $$ update public.balance_transfers
        set voided_at = now(), voided_by = 'dd200000-0000-0000-0000-000000000001', void_reason = 'x'
      where id = current_setting('cb3.we_transfer')::uuid $$,
  '42501', null,
  'W3: a Parent cannot void directly either (only through void_balance_transfer, which audits)'
);

select throws_ok(
  $$ delete from public.balance_transfers where id = current_setting('cb3.we_transfer')::uuid $$,
  '42501', null,
  'W4: a Parent cannot DELETE a transfer directly'
);

-- ---------------------------------------------------------------------------
-- CH: Child
-- ---------------------------------------------------------------------------

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"dd100000-0000-0000-0000-000000000002","role":"authenticated"}';

select throws_ok(
  $$ select public.record_balance_transfer('dd200000-0000-0000-0000-000000000002',
       'dd400000-0000-0000-0000-000000000001', current_setting('cb3.a_everyday')::uuid, 100, '2026-10-03') $$,
  '42501', 'only an active Parent may move money between balances',
  'CH1: a Child cannot record a transfer for themselves'
);

select throws_ok(
  $$ select public.record_balance_transfer('dd200000-0000-0000-0000-000000000002',
       'dd400000-0000-0000-0000-00000000000b', 'dd400000-0000-0000-0000-000000000001', 0, '2026-10-03') $$,
  '23514', 'transfer amount_cents must be positive, got 0',
  'CH2: a Child gets only the content-free amount check, never balance details'
);

select throws_ok(
  $$ select public.record_balance_transfer('dd200000-0000-0000-0000-000000000002',
       'dd400000-0000-0000-0000-00000000000b', 'dd400000-0000-0000-0000-000000000001', 100, '2026-10-03') $$,
  '42501', 'only an active Parent may move money between balances',
  'CH3: authorization is checked before balances (a Child learns nothing about them)'
);

select throws_ok(
  $$ select public.void_balance_transfer(current_setting('cb3.we_transfer')::uuid, 'child wants it gone') $$,
  '42501', 'only an active Parent of this transfer''s household may void it',
  'CH4: a Child cannot void a transfer'
);

select throws_ok(
  $$ insert into public.balance_transfers
       (household_id, member_id, from_tracked_balance_id, to_tracked_balance_id, amount_cents, occurred_on, created_by)
     values ('dd000000-0000-0000-0000-00000000000a', 'dd200000-0000-0000-0000-000000000002',
             'dd400000-0000-0000-0000-000000000001', current_setting('cb3.a_everyday')::uuid, 1, '2026-10-03',
             'dd200000-0000-0000-0000-000000000002') $$,
  '42501', null,
  'CH5: a Child cannot INSERT a transfer directly'
);

select throws_ok(
  $$ update public.balance_transfers set amount_cents = 1
      where id = current_setting('cb3.we_transfer')::uuid $$,
  '42501', null,
  'CH6: a Child cannot UPDATE a transfer directly'
);

select throws_ok(
  $$ delete from public.balance_transfers where id = current_setting('cb3.we_transfer')::uuid $$,
  '42501', null,
  'CH7: a Child cannot DELETE a transfer directly'
);

select is(
  (select string_agg(member_id::text || '=' || amount_cents::text, ',') from public.balance_transfers),
  'dd200000-0000-0000-0000-000000000002=15000',
  'CH8: C1 reads exactly their own single transfer'
);

select is(
  (select string_agg(distinct b.member_id::text, ',')
     from public.household_member_balance_breakdown('dd000000-0000-0000-0000-00000000000a') b),
  'dd200000-0000-0000-0000-000000000002',
  'CH9: C1''s breakdown shows only C1'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"dd100000-0000-0000-0000-000000000003","role":"authenticated"}';

select is(
  (select string_agg(member_id::text || '=' || amount_cents::text, ',') from public.balance_transfers),
  'dd200000-0000-0000-0000-000000000003=500',
  'CH10: C2 reads only their own transfer'
);

reset role;

select is(
  (select count(*) from public.balance_transfers where household_id = 'dd000000-0000-0000-0000-00000000000a'),
  2::bigint,
  'CH11: after every Child attempt, household A still has exactly 2 transfers'
);

-- ---------------------------------------------------------------------------
-- X: Parent reads, cross-household, outsider, anon
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"dd100000-0000-0000-0000-000000000001","role":"authenticated"}';

select is(
  (select count(*) from public.balance_transfers),
  2::bigint,
  'X1: the Parent of A reads both of A''s transfers and none of B''s'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"dd100000-0000-0000-0000-000000000005","role":"authenticated"}';

select is(
  (select count(*) from public.balance_transfers where household_id = 'dd000000-0000-0000-0000-00000000000a'),
  0::bigint,
  'X2: the Parent of B reads none of household A''s transfers'
);

select throws_ok(
  $$ select public.record_balance_transfer('dd200000-0000-0000-0000-000000000002',
       'dd400000-0000-0000-0000-000000000001', 'dd400000-0000-0000-0000-000000000002', 100, '2026-10-03') $$,
  '42501', 'only an active Parent may move money between balances',
  'X3: the Parent of B cannot record a transfer for A''s child'
);

select throws_ok(
  $$ select public.record_balance_transfer('dd200000-0000-0000-0000-000000000006',
       current_setting('cb3.b_everyday')::uuid, 'dd400000-0000-0000-0000-000000000001', 100, '2026-10-03') $$,
  '23514', 'no such balance in this household: dd400000-0000-0000-0000-000000000001',
  'X4: the Parent of B cannot move their own child''s money onto A''s balance'
);

select throws_ok(
  $$ select public.void_balance_transfer(current_setting('cb3.we_transfer')::uuid, 'not mine') $$,
  '42501', 'only an active Parent of this transfer''s household may void it',
  'X5: the Parent of B cannot void A''s transfer'
);

select throws_ok(
  $$ select public.void_balance_transfer('dd600000-0000-0000-0000-0000000000ff', 'nothing') $$,
  '42501', 'only an active Parent of this transfer''s household may void it',
  'X6: a nonexistent transfer gets the same rejection as a foreign one'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"dd100000-0000-0000-0000-000000000007","role":"authenticated"}';

select is(
  (select count(*) from public.balance_transfers),
  0::bigint,
  'X7: an authenticated non-member reads no transfers'
);

reset role;
set local role anon;
set local request.jwt.claims to '{"role":"anon"}';

select throws_ok(
  $$ select count(*) from public.balance_transfers $$,
  '42501', null,
  'X8: anon cannot read balance_transfers'
);

select throws_ok(
  $$ insert into public.balance_transfers
       (household_id, member_id, from_tracked_balance_id, to_tracked_balance_id, amount_cents, occurred_on, created_by)
     values ('dd000000-0000-0000-0000-00000000000a', 'dd200000-0000-0000-0000-000000000002',
             'dd400000-0000-0000-0000-000000000001', 'dd400000-0000-0000-0000-000000000002', 1, '2026-10-03',
             'dd200000-0000-0000-0000-000000000001') $$,
  '42501', null,
  'X9: anon cannot INSERT a transfer'
);

select throws_ok(
  $$ select public.record_balance_transfer('dd200000-0000-0000-0000-000000000002',
       'dd400000-0000-0000-0000-000000000001', 'dd400000-0000-0000-0000-000000000002', 100, '2026-10-03') $$,
  '42501', null,
  'X10: anon cannot call record_balance_transfer'
);

select throws_ok(
  $$ select public.void_balance_transfer(current_setting('cb3.we_transfer')::uuid, 'anon') $$,
  '42501', null,
  'X11: anon cannot call void_balance_transfer'
);

reset role;

-- ---------------------------------------------------------------------------
-- V: voiding
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"dd100000-0000-0000-0000-000000000001","role":"authenticated"}';

select throws_ok(
  $$ select public.void_balance_transfer(current_setting('cb3.we_transfer')::uuid, '   ') $$,
  '23514', 'void_reason is required',
  'V1: a blank void reason is rejected'
);

select throws_ok(
  $$ select public.void_balance_transfer(current_setting('cb3.we_transfer')::uuid, null) $$,
  '23514', 'void_reason is required',
  'V2: a NULL void reason is rejected'
);

select is(
  (select voided_by::text || '/' || void_reason
     from public.void_balance_transfer(current_setting('cb3.we_transfer')::uuid, 'wrong amount')),
  'dd200000-0000-0000-0000-000000000001/wrong amount',
  'V3: a Parent voids the transfer; voided_by is the calling Parent'
);

select is(
  (select string_agg(tb.name || '=' || b.balance_cents::text, ',' order by tb.name)
     from public.household_member_balance_breakdown('dd000000-0000-0000-0000-00000000000a') b
     join public.tracked_balances tb on tb.id = b.tracked_balance_id
    where b.member_id = 'dd200000-0000-0000-0000-000000000002'),
  'Car=30000,Everyday=-15000',
  'V4: the void restores the breakdown to before the transfer'
);

select is_empty(
  $$ select t.member_id
       from public.household_member_balances('dd000000-0000-0000-0000-00000000000a') t
       left join (select member_id, sum(balance_cents) as s
                    from public.household_member_balance_breakdown('dd000000-0000-0000-0000-00000000000a')
                   group by member_id) d using (member_id)
      where d.s is distinct from t.balance_cents $$,
  'V5: after the void, every member''s breakdown still sums to the total'
);

select throws_ok(
  $$ select public.void_balance_transfer(current_setting('cb3.we_transfer')::uuid, 'again') $$,
  '23514', 'balance transfer ' || current_setting('cb3.we_transfer') || ' is already voided',
  'V6: voiding twice is rejected'
);

reset role;

select is(
  (select (old_values ->> 'voided_at') is null
          and (new_values ->> 'void_reason') = 'wrong amount'
          and actor_user_id = 'dd100000-0000-0000-0000-000000000001'
     from public.audit_log
    where entity_type = 'balance_transfers' and action = 'void'
      and entity_id = current_setting('cb3.we_transfer')::uuid),
  true,
  'V7: the void wrote an audit row with old and new values'
);

select is(
  (select count(*) from public.audit_log
    where household_id = 'dd000000-0000-0000-0000-00000000000a'
      and entity_type = 'balance_transfers' and action = 'void'),
  1::bigint,
  'V8: exactly one void audit row (the rejected voids wrote none)'
);

-- ---------------------------------------------------------------------------
-- D: declarative and trigger enforcement, even for postgres
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ update public.balance_transfers set amount_cents = 1
      where id = (select id from public.balance_transfers
                   where member_id = 'dd200000-0000-0000-0000-000000000003') $$,
  '23514', 'balance transfers cannot be changed; only voiding is allowed',
  'D1: even postgres cannot change a live transfer''s amount'
);

select throws_ok(
  $$ update public.balance_transfers
        set from_tracked_balance_id = to_tracked_balance_id, to_tracked_balance_id = from_tracked_balance_id
      where id = (select id from public.balance_transfers
                   where member_id = 'dd200000-0000-0000-0000-000000000003') $$,
  '23514', 'balance transfers cannot be changed; only voiding is allowed',
  'D2: even postgres cannot flip a live transfer''s direction'
);

select throws_ok(
  $$ update public.balance_transfers set voided_at = null, voided_by = null, void_reason = null
      where id = current_setting('cb3.we_transfer')::uuid $$,
  '23514', 'balance transfer ' || current_setting('cb3.we_transfer') || ' is already voided and cannot be changed',
  'D3: even postgres cannot un-void a transfer'
);

select throws_ok(
  $$ delete from public.balance_transfers where id = current_setting('cb3.we_transfer')::uuid $$,
  '23514', 'balance transfers cannot be deleted; void them instead',
  'D4: even postgres cannot DELETE a transfer on its own'
);

select throws_ok(
  $$ insert into public.balance_transfers
       (household_id, member_id, from_tracked_balance_id, to_tracked_balance_id, amount_cents, occurred_on, created_by)
     values ('dd000000-0000-0000-0000-00000000000a', 'dd200000-0000-0000-0000-000000000002',
             'dd400000-0000-0000-0000-000000000001', 'dd400000-0000-0000-0000-000000000001', 1, '2026-10-03',
             'dd200000-0000-0000-0000-000000000001') $$,
  '23514', null,
  'D5: from = to is refused by the table itself'
);

select throws_ok(
  $$ insert into public.balance_transfers
       (household_id, member_id, from_tracked_balance_id, to_tracked_balance_id, amount_cents, occurred_on, created_by)
     values ('dd000000-0000-0000-0000-00000000000a', 'dd200000-0000-0000-0000-000000000002',
             'dd400000-0000-0000-0000-000000000001', 'dd400000-0000-0000-0000-000000000002', 0, '2026-10-03',
             'dd200000-0000-0000-0000-000000000001') $$,
  '23514', null,
  'D6: a zero amount is refused by the table itself'
);

select throws_ok(
  $$ insert into public.balance_transfers
       (household_id, member_id, from_tracked_balance_id, to_tracked_balance_id, amount_cents, occurred_on, created_by)
     values ('dd000000-0000-0000-0000-00000000000a', 'dd200000-0000-0000-0000-000000000002',
             'dd400000-0000-0000-0000-000000000001', 'dd400000-0000-0000-0000-00000000000b', 1, '2026-10-03',
             'dd200000-0000-0000-0000-000000000001') $$,
  '23503', null,
  'D7: a balance from another household is refused by the composite FK'
);

select throws_ok(
  $$ insert into public.balance_transfers
       (household_id, member_id, from_tracked_balance_id, to_tracked_balance_id, amount_cents, occurred_on, created_by)
     values ('dd000000-0000-0000-0000-00000000000a', 'dd200000-0000-0000-0000-000000000006',
             'dd400000-0000-0000-0000-000000000001', 'dd400000-0000-0000-0000-000000000002', 1, '2026-10-03',
             'dd200000-0000-0000-0000-000000000001') $$,
  '23503', null,
  'D8: a member from another household is refused by the composite FK'
);

select throws_ok(
  $$ insert into public.balance_transfers
       (household_id, member_id, from_tracked_balance_id, to_tracked_balance_id, amount_cents, occurred_on, created_by)
     values ('dd000000-0000-0000-0000-00000000000a', 'dd200000-0000-0000-0000-000000000002',
             'dd400000-0000-0000-0000-000000000001', 'dd400000-0000-0000-0000-000000000002', 1, '2026-10-03',
             'dd200000-0000-0000-0000-000000000005') $$,
  '23503', null,
  'D9: created_by from another household is refused by the composite FK'
);

select throws_ok(
  $$ update public.balance_transfers set voided_at = now()
      where id = (select id from public.balance_transfers
                   where member_id = 'dd200000-0000-0000-0000-000000000003') $$,
  '23514', null,
  'D10: a partial void (voided_at only) is refused by the all-or-nothing CHECK'
);

-- Household C: a transfer, then the whole household is deleted.
insert into public.balance_transfers
  (household_id, member_id, from_tracked_balance_id, to_tracked_balance_id, amount_cents, occurred_on, created_by)
select 'dd000000-0000-0000-0000-00000000000c', 'dd200000-0000-0000-0000-000000000008',
       tb.id, 'dd400000-0000-0000-0000-00000000000c', 1, '2026-10-03', 'dd200000-0000-0000-0000-000000000008'
from public.tracked_balances tb
where tb.household_id = 'dd000000-0000-0000-0000-00000000000c' and tb.is_everyday;

select lives_ok(
  $$ delete from public.households where id = 'dd000000-0000-0000-0000-00000000000c' $$,
  'D11: deleting a whole household (owner-only) still cascades through its transfers'
);

select is(
  (select count(*) from public.balance_transfers where household_id = 'dd000000-0000-0000-0000-00000000000c'),
  0::bigint,
  'D12: the cascaded transfers are gone'
);

select * from finish();

rollback;
