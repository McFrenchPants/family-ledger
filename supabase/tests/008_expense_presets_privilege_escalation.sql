-- Regression tests: C2 -- expense_presets privilege-escalation and integrity.
--
-- Covers the RLS policies and composite FK added by
-- 20260906120000_expense_presets.sql. Mirrors
-- 003_ledger_privilege_escalation.sql's structure and role-switching
-- convention (see that file's header for the full rationale of why each
-- block does `set local role authenticated; set local request.jwt.claims ...
-- ; ... ; reset role;`).
--
-- Self-contained: creates its own fixtures, depends on nothing in seed.sql,
-- and the whole file runs inside begin/rollback so the database is left
-- exactly as it was found.
--
-- Run with: npm run test:db  (wraps `npx supabase test db --local`)

begin;

create extension if not exists pgtap with schema extensions;
set local search_path to extensions, public, pg_catalog;

select plan(10);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
--
-- Household A: Parent P1, child C1.
-- Household B: Parent P2, child C3. Used only to prove the composite FK
-- rejects a category from a different household.

insert into public.households (id, name, timezone, child_expense_scope) values
  ('10000000-0000-0000-0000-00000000000a', 'Household A', 'America/Chicago', 'any_member'),
  ('10000000-0000-0000-0000-00000000000b', 'Household B', 'Europe/Paris', 'any_member');

insert into auth.users (id, email) values
  ('20000000-0000-0000-0000-000000000001', 'p1@example.test'),
  ('20000000-0000-0000-0000-000000000002', 'c1@example.test'),
  ('20000000-0000-0000-0000-000000000004', 'p2@example.test');

insert into public.household_members (id, household_id, user_id, name, role, status) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000a',
   '20000000-0000-0000-0000-000000000001', 'Parent One', 'parent', 'active'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-00000000000a',
   '20000000-0000-0000-0000-000000000002', 'Child One',  'child',  'active'),
  ('30000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-00000000000b',
   '20000000-0000-0000-0000-000000000004', 'Parent Two', 'parent', 'active');

insert into public.categories (id, household_id, name) values
  ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000a', 'Household A category'),
  ('40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-00000000000b', 'Household B category');

-- ---------------------------------------------------------------------------
-- Case 1: Parent can insert a preset for their own household.
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"20000000-0000-0000-0000-000000000001","role":"authenticated"}';

create temp table tmp_case1_insert as
with ins as (
  insert into public.expense_presets (household_id, label, amount_cents, category_id)
  values ('10000000-0000-0000-0000-00000000000a', 'School lunch', 500,
          '40000000-0000-0000-0000-000000000001')
  returning id, label, amount_cents
)
select * from ins;

select ok(
  (select count(*) from tmp_case1_insert) = 1
  and exists (select 1 from tmp_case1_insert where label = 'School lunch' and amount_cents = 500),
  'Case 1: Parent can insert an expense_presets row for their own household'
);

reset role;

-- ---------------------------------------------------------------------------
-- Case 2: Parent can update and deactivate a preset.
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"20000000-0000-0000-0000-000000000001","role":"authenticated"}';

create temp table tmp_case2_update as
with upd as (
  update public.expense_presets
     set active = false, amount_cents = 600
   where id = (select id from tmp_case1_insert)
  returning active, amount_cents
)
select * from upd;

select ok(
  (select count(*) from tmp_case2_update) = 1
  and exists (select 1 from tmp_case2_update where active = false and amount_cents = 600),
  'Case 2: Parent can update and deactivate their own household''s preset'
);

reset role;

-- ---------------------------------------------------------------------------
-- Case 3: Child cannot insert a preset. RLS carries no INSERT policy for a
-- Child (expense_presets_insert_parent_only is Parent-only), so the attempt
-- affects zero rows -- not a grant-layer error, since authenticated carries
-- table-level INSERT/UPDATE/DELETE grants by default (Supabase's standard
-- privileges); RLS is the only thing stopping this.
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"20000000-0000-0000-0000-000000000002","role":"authenticated"}';

select throws_ok(
  $$
    insert into public.expense_presets (household_id, label, amount_cents)
    values ('10000000-0000-0000-0000-00000000000a', 'Child-inserted preset', 100)
  $$,
  '42501',
  null,
  'Case 3: Child INSERT of an expense_presets row is rejected (no INSERT policy for Child)'
);

reset role;

select is(
  (select count(*) from public.expense_presets where label = 'Child-inserted preset'),
  0::bigint,
  'Case 3: no expense_presets row was created by the rejected Child insert'
);

-- ---------------------------------------------------------------------------
-- Case 4: Child cannot update a preset (their own household's, most
-- favorable case for an attacker).
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"20000000-0000-0000-0000-000000000002","role":"authenticated"}';

create temp table tmp_case4_update as
with upd as (
  update public.expense_presets
     set label = 'HACKED BY CHILD'
   where id = (select id from tmp_case1_insert)
  returning 1
)
select count(*) as affected from upd;

select is(
  (select affected from tmp_case4_update),
  0::bigint,
  'Case 4: Child direct UPDATE of an expense_presets row affects zero rows (no UPDATE policy for Child)'
);

reset role;

-- ---------------------------------------------------------------------------
-- Case 5: Child cannot delete a preset.
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"20000000-0000-0000-0000-000000000002","role":"authenticated"}';

create temp table tmp_case5_delete as
with del as (
  delete from public.expense_presets
   where id = (select id from tmp_case1_insert)
  returning 1
)
select count(*) as affected from del;

select is(
  (select affected from tmp_case5_delete),
  0::bigint,
  'Case 5: Child direct DELETE of an expense_presets row affects zero rows (no DELETE policy for Child)'
);

reset role;

-- Confirm the row is still there (positive control that Case 4/5 truly did
-- nothing, not merely that RLS hid the result from the Child).
select ok(
  exists (select 1 from public.expense_presets where id = (select id from tmp_case1_insert)),
  'Case 5 (positive control): the preset targeted by cases 4-5 still exists after both rejected writes'
);

-- ---------------------------------------------------------------------------
-- Case 6: composite FK rejects a category_id belonging to a DIFFERENT
-- household, even when household_id itself is valid. Run as postgres --
-- this is testing the constraint itself, not RLS/grants.
-- ---------------------------------------------------------------------------

select throws_ok(
  $$
    insert into public.expense_presets (household_id, label, amount_cents, category_id)
    values ('10000000-0000-0000-0000-00000000000a', 'Cross-household category preset', 200,
            '40000000-0000-0000-0000-000000000002')
  $$,
  '23503',
  null,
  'Case 6: expense_presets_category_household_fk rejects a category_id from a different household'
);

-- ---------------------------------------------------------------------------
-- Case 7: structural assertions -- RLS is enabled, and only the four
-- expected policies exist (no stray permissive policy grants Child writes).
-- ---------------------------------------------------------------------------

select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = to_regclass('public.expense_presets')),
  'Case 7a: RLS is enabled on public.expense_presets'
);

select is(
  (select count(*) from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'expense_presets'),
  4::bigint,
  'Case 7b: exactly the four expected policies exist on expense_presets'
);

select * from finish();

rollback;
