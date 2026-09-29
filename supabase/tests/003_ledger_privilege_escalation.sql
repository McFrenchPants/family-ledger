-- Regression tests: P1.5 -- Child privilege-escalation and ledger integrity.
--
-- This is the suite that gates Stage 2 (the UI layer): nothing proceeds past
-- Phase 1 until every case here is green. It covers the write-time RPCs
-- (20260904233000_ledger_write_functions.sql), the RLS policies
-- (20260904230000_ledger_rls_policies.sql), the balance view
-- (20260905010000_ledger_member_balances.sql), and the P1.1 schema
-- constraints (20260904223000_ledger_schema.sql) -- specifically the "a
-- Child must never be able to reduce a balance" standing rule, checked from
-- every angle: through the RPCs, through a hypothetical RPC bypass, and
-- through raw table access.
--
-- Role-switching within pgTAP's superuser-only constraint (see CLAUDE.md's
-- testing section): fixtures and any schema-level setup run as this file's
-- default role (postgres, via `npx supabase test db --local`). Each
-- Child/Parent-scoped block does:
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<household_members.user_id>","role":"authenticated"}';
--   ... pgTAP assertions, which run fine under a non-superuser role ...
--   reset role;
-- `reset role` returns to postgres before the next block, so blocks can
-- freely alternate between "as postgres" (schema mutations, direct
-- superuser-bypass inserts) and "as a specific household member".
--
-- Self-contained: creates its own fixtures, depends on nothing in seed.sql,
-- and the whole file runs inside begin/rollback so the database is left
-- exactly as it was found.
--
-- Run with: npm run test:db  (wraps `npx supabase test db --local`)

begin;

create extension if not exists pgtap with schema extensions;
set local search_path to extensions, public, pg_catalog;

select plan(35);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
--
-- Household A: Parent P1, children C1 and C2 (siblings).
-- Household B: Parent P2, child C3. Used only to prove cross-household
-- isolation -- nothing in household B is otherwise exercised.

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

insert into public.categories (id, household_id, name) values
  ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000a', 'Household A category'),
  ('40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-00000000000b', 'Household B category');

-- Baseline ledger rows, inserted directly as the superuser role -- i.e.
-- bypassing every RPC -- purely to have pre-existing data for the read/void
-- tests below. This does not exercise the RPC's own INSERT authorization (it
-- is the same "elevated role" scenario Case 4 uses deliberately).
insert into public.ledger_transactions
  (id, household_id, member_id, amount_cents, type, description, occurred_on, created_by) values
  ('50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000a',
   '30000000-0000-0000-0000-000000000002', 1000, 'expense', 'Baseline expense for C1',
   current_date, '30000000-0000-0000-0000-000000000001'),
  ('50000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-00000000000a',
   '30000000-0000-0000-0000-000000000003', 500, 'expense', 'Baseline expense for C2',
   current_date, '30000000-0000-0000-0000-000000000001'),
  ('50000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-00000000000b',
   '30000000-0000-0000-0000-000000000005', 700, 'expense', 'Baseline expense for C3',
   current_date, '30000000-0000-0000-0000-000000000004');

-- ---------------------------------------------------------------------------
-- Case 1: Child attempts record_payment -- rejected, no new rows anywhere.
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"20000000-0000-0000-0000-000000000002","role":"authenticated"}';

select throws_ok(
  $$ select public.record_payment('30000000-0000-0000-0000-000000000002', -100, 'child payment attempt', current_date) $$,
  '42501',
  null,
  'Case 1: Child record_payment against their own member_id is rejected (Parent-only)'
);

-- The "no new row" checks must run as an elevated (RLS-bypassing) role: a
-- Child's OWN count(*) is itself RLS-filtered to their own rows, which would
-- make this assertion pass even if a stray row landed in another member's
-- name. reset role (back to postgres) to see the true, unfiltered table
-- count, then switch back to the Child persona for the next case.
reset role;

select is(
  (select count(*) from public.ledger_transactions),
  3::bigint,
  'Case 1: no new ledger_transactions row after the rejected Child record_payment'
);

select is(
  (select count(*) from public.audit_log),
  0::bigint,
  'Case 1: no new audit_log row after the rejected Child record_payment'
);

set local role authenticated;
set local request.jwt.claims to '{"sub":"20000000-0000-0000-0000-000000000002","role":"authenticated"}';

-- ---------------------------------------------------------------------------
-- Case 2: Child attempts record_adjustment -- rejected, no new rows anywhere.
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select public.record_adjustment('30000000-0000-0000-0000-000000000002', -50, 'child adjustment attempt', current_date) $$,
  '42501',
  null,
  'Case 2: Child record_adjustment against their own member_id is rejected (Parent-only)'
);

reset role;

select is(
  (select count(*) from public.ledger_transactions),
  3::bigint,
  'Case 2: no new ledger_transactions row after the rejected Child record_adjustment'
);

select is(
  (select count(*) from public.audit_log),
  0::bigint,
  'Case 2: no new audit_log row after the rejected Child record_adjustment'
);

set local role authenticated;
set local request.jwt.claims to '{"sub":"20000000-0000-0000-0000-000000000002","role":"authenticated"}';

-- ---------------------------------------------------------------------------
-- Case 3: Child attempts a negative-amount "expense" via record_expense.
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select public.record_expense('30000000-0000-0000-0000-000000000002', -20, 'negative expense attempt', current_date) $$,
  '23514',
  null,
  'Case 3: Child record_expense with a non-positive amount is rejected (check_violation)'
);

-- ---------------------------------------------------------------------------
-- Case 5: Child attempts void_ledger_transaction, on a sibling's row and on
-- their own -- both rejected. void_ledger_transaction is Parent-only
-- regardless of whose transaction it is.
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select public.void_ledger_transaction('50000000-0000-0000-0000-000000000002', 'child void of sibling row') $$,
  '42501',
  null,
  'Case 5a: Child void_ledger_transaction on a sibling''s transaction is rejected'
);

select throws_ok(
  $$ select public.void_ledger_transaction('50000000-0000-0000-0000-000000000001', 'child void of own row') $$,
  '42501',
  null,
  'Case 5b: Child void_ledger_transaction on their OWN transaction is rejected'
);

-- ---------------------------------------------------------------------------
-- Case 6: Child attempts a direct UPDATE/DELETE on ledger_transactions,
-- bypassing the RPCs entirely. authenticated carries table-level UPDATE/
-- DELETE grants (Supabase's default privileges), so this is not a permission-
-- denied error -- it is RLS filtering the target row set to nothing, because
-- ledger_transactions carries no UPDATE or DELETE policy for any role. Zero
-- rows affected, on the Child's OWN row (the most favorable case for an
-- attacker).
-- ---------------------------------------------------------------------------

-- A data-modifying WITH clause must be the top level of its own statement
-- (Postgres rejects one nested inside another expression), so the
-- UPDATE/DELETE + row count is captured via CREATE TEMP TABLE AS, then
-- checked with a plain is().

create temp table tmp_case6a as
with upd as (
  update public.ledger_transactions
     set description = 'HACKED BY CHILD'
   where id = '50000000-0000-0000-0000-000000000001'
   returning 1
)
select count(*) as affected from upd;

select is(
  (select affected from tmp_case6a),
  0::bigint,
  'Case 6a: Child direct UPDATE on their own ledger_transactions row affects zero rows (no UPDATE policy)'
);

create temp table tmp_case6b as
with del as (
  delete from public.ledger_transactions
   where id = '50000000-0000-0000-0000-000000000001'
   returning 1
)
select count(*) as affected from del;

select is(
  (select affected from tmp_case6b),
  0::bigint,
  'Case 6b: Child direct DELETE of their own ledger_transactions row affects zero rows (no DELETE policy)'
);

-- ---------------------------------------------------------------------------
-- Case 7: Child attempts to read another household's data -- zero rows, not
-- an error (no existence leak).
-- ---------------------------------------------------------------------------

select is(
  (select count(*) from public.ledger_transactions where household_id = '10000000-0000-0000-0000-00000000000b'),
  0::bigint,
  'Case 7a: Child sees zero rows of another household''s ledger_transactions'
);

select is(
  (select count(*) from public.categories where household_id = '10000000-0000-0000-0000-00000000000b'),
  0::bigint,
  'Case 7b: Child sees zero rows of another household''s categories'
);

select is(
  (select count(*) from public.household_member_balances('10000000-0000-0000-0000-00000000000b')),
  0::bigint,
  'Case 7c: Child gets zero rows from another household''s household_member_balances'
);

-- ---------------------------------------------------------------------------
-- Case 8: Child attempts to read a SIBLING's ledger_transactions in the same
-- household -- zero rows. Paired with a positive control (their own row IS
-- visible), so a future removal of the self-select policy is provable by
-- mutation, not just assumed.
-- ---------------------------------------------------------------------------

select is(
  (select count(*) from public.ledger_transactions where member_id = '30000000-0000-0000-0000-000000000003'),
  0::bigint,
  'Case 8: Child sees zero rows of a sibling''s ledger_transactions in the SAME household'
);

select ok(
  (select count(*) from public.ledger_transactions where member_id = '30000000-0000-0000-0000-000000000002') >= 1,
  'Case 8 (positive control): Child DOES see their own ledger_transactions rows'
);

-- ---------------------------------------------------------------------------
-- Case 10: Child attempts to write to audit_log directly, in any form.
-- authenticated carries only SELECT on audit_log (P1.2's explicit revoke), so
-- both INSERT and UPDATE fail at the grant layer before RLS is even
-- consulted.
-- ---------------------------------------------------------------------------

select throws_ok(
  $$
    insert into public.audit_log (household_id, actor_user_id, entity_type, entity_id, action, new_values)
    values ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-000000000002',
            'ledger_transactions', '50000000-0000-0000-0000-000000000001', 'insert', '{"amount_cents": 999999}'::jsonb)
  $$,
  '42501',
  null,
  'Case 10a: Child direct INSERT of a fabricated audit_log row is rejected (no INSERT grant)'
);

select throws_ok(
  $$
    update public.audit_log
       set new_values = '{"tampered": true}'::jsonb
     where id = '50000000-0000-0000-0000-000000000001'
  $$,
  '42501',
  null,
  'Case 10b: Child direct UPDATE of audit_log is rejected (no UPDATE grant)'
);

reset role;

-- ---------------------------------------------------------------------------
-- Case 4: type/sign mismatch at the raw table level, bypassing the RPC
-- entirely -- simulating "what if someone got past the RPC" via a direct
-- INSERT as an elevated/superuser role. Rejected by
-- ledger_transactions_amount_sign_check (a positive amount tagged 'payment').
-- Run as postgres deliberately: this is not testing RLS or grants, it is
-- testing that the CHECK constraint itself is the backstop even when every
-- higher layer is bypassed.
-- ---------------------------------------------------------------------------

select throws_ok(
  $$
    insert into public.ledger_transactions
      (household_id, member_id, amount_cents, type, description, occurred_on, created_by)
    values
      ('10000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-000000000002',
       500, 'payment', 'sign mismatch bypass attempt', current_date,
       '30000000-0000-0000-0000-000000000001')
  $$,
  '23514',
  null,
  'Case 4: a positive amount tagged ''payment'', inserted directly as an elevated role, is rejected by ledger_transactions_amount_sign_check'
);

-- ---------------------------------------------------------------------------
-- Case 9: child_expense_scope actually changes behavior, not just exists.
-- Toggle to 'self_only' (as postgres -- households carries no UPDATE policy
-- either, so only an elevated role can flip it in this test), then as C1
-- attempt to expense a SIBLING (M_C2): rejected. Toggle back to
-- 'any_member' and repeat the identical call: succeeds.
-- ---------------------------------------------------------------------------

update public.households
   set child_expense_scope = 'self_only'
 where id = '10000000-0000-0000-0000-00000000000a';

set local role authenticated;
set local request.jwt.claims to '{"sub":"20000000-0000-0000-0000-000000000002","role":"authenticated"}';

select throws_ok(
  $$ select public.record_expense('30000000-0000-0000-0000-000000000003', 150, 'sibling expense under self_only', current_date) $$,
  '42501',
  null,
  'Case 9a: Child record_expense for a DIFFERENT member is rejected when the household is self_only'
);

reset role;

update public.households
   set child_expense_scope = 'any_member'
 where id = '10000000-0000-0000-0000-00000000000a';

set local role authenticated;
set local request.jwt.claims to '{"sub":"20000000-0000-0000-0000-000000000002","role":"authenticated"}';

select lives_ok(
  $$ select public.record_expense('30000000-0000-0000-0000-000000000003', 150, 'sibling expense under any_member', current_date) $$,
  'Case 9b: the IDENTICAL record_expense call succeeds once the household toggles to any_member'
);

reset role;

-- ---------------------------------------------------------------------------
-- Case 11: Parent performing each legitimate action succeeds and produces
-- the expected balance and audit effects.
--
-- Sequence for member M_C1: void the 1000-cent baseline expense, then record
-- an expense (+300), a payment (-200), and an adjustment (-100). Net result:
-- the baseline is excluded (voided) and 300 - 200 - 100 = 0, so the final
-- balance for M_C1 is exactly 0 -- a clean, unambiguous expected value.
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"20000000-0000-0000-0000-000000000001","role":"authenticated"}';

create temp table tmp_case11_void as
select * from public.void_ledger_transaction('50000000-0000-0000-0000-000000000001', 'parent void for case 11');

select ok(
  (select voided_at is not null and voided_by is not null and void_reason is not null from tmp_case11_void),
  'Case 11a: Parent void_ledger_transaction succeeds and sets voided_at/voided_by/void_reason'
);

select ok(
  exists (
    select 1 from public.audit_log
     where entity_id = '50000000-0000-0000-0000-000000000001'
       and action = 'void'
       and household_id = '10000000-0000-0000-0000-00000000000a'
  ),
  'Case 11b: Parent''s void produced a matching audit_log ''void'' row'
);

create temp table tmp_case11_expense as
select * from public.record_expense(
  '30000000-0000-0000-0000-000000000002', 300, 'Parent expense for case 11', current_date
);

select ok(
  (select count(*) from tmp_case11_expense) = 1
  and exists (select 1 from tmp_case11_expense where amount_cents = 300 and type = 'expense'),
  'Case 11c: Parent record_expense succeeds and returns the expected row'
);

select ok(
  exists (
    select 1 from public.audit_log al
    join tmp_case11_expense t on al.entity_id = t.id
     where al.action = 'insert'
  ),
  'Case 11d: Parent''s record_expense produced a matching audit_log ''insert'' row'
);

create temp table tmp_case11_payment as
select * from public.record_payment(
  '30000000-0000-0000-0000-000000000002', -200, 'Parent payment for case 11', current_date
);

select ok(
  (select count(*) from tmp_case11_payment) = 1
  and exists (select 1 from tmp_case11_payment where amount_cents = -200 and type = 'payment'),
  'Case 11e: Parent record_payment succeeds and returns the expected row'
);

select ok(
  exists (
    select 1 from public.audit_log al
    join tmp_case11_payment t on al.entity_id = t.id
     where al.action = 'insert'
  ),
  'Case 11f: Parent''s record_payment produced a matching audit_log ''insert'' row'
);

create temp table tmp_case11_adjustment as
select * from public.record_adjustment(
  '30000000-0000-0000-0000-000000000002', -100, 'Parent adjustment for case 11', current_date
);

select ok(
  (select count(*) from tmp_case11_adjustment) = 1
  and exists (select 1 from tmp_case11_adjustment where amount_cents = -100 and type = 'adjustment'),
  'Case 11g: Parent record_adjustment succeeds and returns the expected row'
);

select ok(
  exists (
    select 1 from public.audit_log al
    join tmp_case11_adjustment t on al.entity_id = t.id
     where al.action = 'insert'
  ),
  'Case 11h: Parent''s record_adjustment produced a matching audit_log ''insert'' row'
);

select is(
  (select balance_cents from public.household_member_balances('10000000-0000-0000-0000-00000000000a')
    where member_id = '30000000-0000-0000-0000-000000000002'),
  0::bigint,
  'Case 11i: M_C1''s balance is exactly 0 after the voided baseline plus expense(+300)/payment(-200)/adjustment(-100)'
);

reset role;

-- ---------------------------------------------------------------------------
-- Case 12: structural assertions -- RLS is enabled on all three tables, and
-- no permissive policy grants a Child (or anyone else) write access to
-- ledger_transactions/audit_log.
-- ---------------------------------------------------------------------------

select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.categories'::regclass),
  'Case 12a: RLS is enabled on public.categories'
);

select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.ledger_transactions'::regclass),
  'Case 12b: RLS is enabled on public.ledger_transactions'
);

select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.audit_log'::regclass),
  'Case 12c: RLS is enabled on public.audit_log'
);

select is(
  (select count(*) from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'ledger_transactions'
      and cmd in ('INSERT', 'UPDATE', 'DELETE')),
  0::bigint,
  'Case 12d: no INSERT/UPDATE/DELETE policy exists on ledger_transactions for any role (default-deny is the entire enforcement)'
);

select is(
  (select count(*) from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'audit_log'
      and cmd in ('INSERT', 'UPDATE', 'DELETE')),
  0::bigint,
  'Case 12e: no INSERT/UPDATE/DELETE policy exists on audit_log for any role'
);

select * from finish();

rollback;
