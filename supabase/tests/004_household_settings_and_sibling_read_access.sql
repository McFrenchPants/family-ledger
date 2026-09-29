-- Regression tests: household settings read access (households SELECT) and
-- scope-conditional sibling read access (household_members' third policy).
--
-- Covers 20260905020000_household_settings_and_sibling_read_access.sql, which
-- closed two gaps discovered while implementing S2.5 (Add Expense): no caller
-- could read households.timezone/child_expense_scope at all, and a Child in
-- an 'any_member' household could not see their siblings to build a sibling
-- selector.
--
-- Role-switching idiom matches 003_ledger_privilege_escalation.sql: fixtures
-- run as this file's default role (postgres); each Child/Parent-scoped block
-- sets `role authenticated` plus `request.jwt.claims` naming that member's
-- own auth.users id, then `reset role` returns to postgres before the next
-- block or before a postgres-only mutation (e.g. toggling child_expense_scope,
-- which households has no UPDATE policy for -- only an elevated role can
-- flip it in this test, matching Case 9 of 003).
--
-- Self-contained: creates its own fixtures, depends on nothing in seed.sql,
-- and the whole file runs inside begin/rollback so the database is left
-- exactly as it was found.
--
-- Run with: npm run test:db  (wraps `npx supabase test db --local`)

begin;

create extension if not exists pgtap with schema extensions;
set local search_path to extensions, public, pg_catalog;

select plan(19);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
--
-- Household A ('any_member'): Parent P1, children C1 and C2 (siblings).
-- Household B ('self_only'): Parent P2, child C3. Used both for
-- cross-household isolation and as the 'self_only' case for the sibling
-- policy's mutation-proofing (Criterion 5).

insert into public.households (id, name, timezone, child_expense_scope) values
  ('60000000-0000-0000-0000-00000000000a', 'Household A (any_member)', 'America/Chicago', 'any_member'),
  ('60000000-0000-0000-0000-00000000000b', 'Household B (self_only)', 'Europe/Paris', 'self_only');

insert into auth.users (id, email) values
  ('70000000-0000-0000-0000-000000000001', 'p1-settings@example.test'),
  ('70000000-0000-0000-0000-000000000002', 'c1-settings@example.test'),
  ('70000000-0000-0000-0000-000000000003', 'c2-settings@example.test'),
  ('70000000-0000-0000-0000-000000000004', 'p2-settings@example.test'),
  ('70000000-0000-0000-0000-000000000005', 'c3-settings@example.test');

insert into public.household_members (id, household_id, user_id, name, role, status) values
  ('80000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-00000000000a',
   '70000000-0000-0000-0000-000000000001', 'Parent One',  'parent', 'active'),
  ('80000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-00000000000a',
   '70000000-0000-0000-0000-000000000002', 'Child One',   'child',  'active'),
  ('80000000-0000-0000-0000-000000000003', '60000000-0000-0000-0000-00000000000a',
   '70000000-0000-0000-0000-000000000003', 'Child Two',   'child',  'active'),
  ('80000000-0000-0000-0000-000000000004', '60000000-0000-0000-0000-00000000000b',
   '70000000-0000-0000-0000-000000000004', 'Parent Two',  'parent', 'active'),
  ('80000000-0000-0000-0000-000000000005', '60000000-0000-0000-0000-00000000000b',
   '70000000-0000-0000-0000-000000000005', 'Child Three', 'child',  'active');

-- ---------------------------------------------------------------------------
-- Criterion 2: Child reads households -- own household visible, others not.
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"70000000-0000-0000-0000-000000000002","role":"authenticated"}';

select is(
  (select count(*) from public.households where id = '60000000-0000-0000-0000-00000000000a'),
  1::bigint,
  'Criterion 2a: Child reading their OWN household returns exactly one row'
);

select is(
  (select timezone from public.households where id = '60000000-0000-0000-0000-00000000000a'),
  'America/Chicago',
  'Criterion 2b: Child reads the correct timezone for their own household'
);

select is(
  (select child_expense_scope from public.households where id = '60000000-0000-0000-0000-00000000000a'),
  'any_member',
  'Criterion 2c: Child reads the correct child_expense_scope for their own household'
);

select is(
  (select count(*) from public.households where id = '60000000-0000-0000-0000-00000000000b'),
  0::bigint,
  'Criterion 2d: Child reading a DIFFERENT household returns zero rows'
);

reset role;

-- ---------------------------------------------------------------------------
-- Criterion 3: Parent reads households -- own household visible, others not.
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"70000000-0000-0000-0000-000000000001","role":"authenticated"}';

select is(
  (select count(*) from public.households where id = '60000000-0000-0000-0000-00000000000a'),
  1::bigint,
  'Criterion 3a: Parent reading their OWN household returns exactly one row'
);

select is(
  (select timezone from public.households where id = '60000000-0000-0000-0000-00000000000a'),
  'America/Chicago',
  'Criterion 3b: Parent reads the correct timezone for their own household'
);

select is(
  (select count(*) from public.households where id = '60000000-0000-0000-0000-00000000000b'),
  0::bigint,
  'Criterion 3c: Parent reading a DIFFERENT household returns zero rows'
);

reset role;

-- ---------------------------------------------------------------------------
-- Criterion 4: Child in an 'any_member' household sees every active member
-- of their household, siblings included.
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"70000000-0000-0000-0000-000000000002","role":"authenticated"}';

select is(
  (select count(*) from public.household_members where household_id = '60000000-0000-0000-0000-00000000000a'),
  3::bigint,
  'Criterion 4a: Child in an any_member household sees all 3 active members (self + parent + sibling)'
);

select ok(
  (select count(*) from public.household_members
    where id = '80000000-0000-0000-0000-000000000003') = 1,
  'Criterion 4b: Child in an any_member household specifically sees their SIBLING''s row (behavior change from S2.1)'
);

reset role;

-- ---------------------------------------------------------------------------
-- Criterion 5 (mutation-proofing -- the case that must NOT change): a Child
-- in a 'self_only' household still sees only their own row.
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"70000000-0000-0000-0000-000000000005","role":"authenticated"}';

select is(
  (select count(*) from public.household_members where household_id = '60000000-0000-0000-0000-00000000000b'),
  1::bigint,
  'Criterion 5a: Child in a self_only household sees exactly ONE household_members row'
);

select is(
  (select id from public.household_members where household_id = '60000000-0000-0000-0000-00000000000b'),
  '80000000-0000-0000-0000-000000000005',
  'Criterion 5b: the one row a self_only Child sees is their OWN row, not the sibling parent''s'
);

reset role;

-- Toggle household A to self_only and repeat Criterion 4's Child query: the
-- new policy's grant must disappear along with the scope change, proving the
-- conditional genuinely depends on child_expense_scope rather than being a
-- blanket widening that happens to look conditional. This directly
-- mutation-tests the `exists (select ... child_expense_scope = 'any_member')`
-- predicate: if that predicate were dropped (unconditional sibling read),
-- this assertion would fail to catch it turning the toggle into a no-op.

update public.households
   set child_expense_scope = 'self_only'
 where id = '60000000-0000-0000-0000-00000000000a';

set local role authenticated;
set local request.jwt.claims to '{"sub":"70000000-0000-0000-0000-000000000002","role":"authenticated"}';

select is(
  (select count(*) from public.household_members where household_id = '60000000-0000-0000-0000-00000000000a'),
  1::bigint,
  'Criterion 5c: toggling household A to self_only removes the Child''s sibling visibility (only their own row remains)'
);

reset role;

update public.households
   set child_expense_scope = 'any_member'
 where id = '60000000-0000-0000-0000-00000000000a';

set local role authenticated;
set local request.jwt.claims to '{"sub":"70000000-0000-0000-0000-000000000002","role":"authenticated"}';

select is(
  (select count(*) from public.household_members where household_id = '60000000-0000-0000-0000-00000000000a'),
  3::bigint,
  'Criterion 5d: toggling household A back to any_member restores the Child''s sibling visibility'
);

reset role;

-- ---------------------------------------------------------------------------
-- Criterion 6: anon cannot read either table.
-- ---------------------------------------------------------------------------

select is(
  has_table_privilege('anon', 'public.households', 'SELECT'),
  true,
  'Criterion 6a: anon retains the table-level SELECT grant on households (RLS, not the grant, is the enforcement)'
);

set local role anon;

select is(
  (select count(*) from public.households),
  0::bigint,
  'Criterion 6b: anon reads zero rows from households despite the table-level grant'
);

select is(
  (select count(*) from public.household_members),
  0::bigint,
  'Criterion 6c: anon reads zero rows from household_members despite the table-level grant'
);

reset role;

-- ---------------------------------------------------------------------------
-- Structural assertion: S2.1's two existing policies are untouched, and
-- exactly one new policy was added to household_members.
-- ---------------------------------------------------------------------------

-- NOTE (M6.1): this count was 3 when this file was first written (S2.1's two
-- plus this migration's one). M6.1's household_members_update_policy
-- migration added a 4th SELECT policy (household_members_select_parent_any_
-- status) -- required for its Parent UPDATE policy to function at all under
-- Postgres's implicit SELECT/WITH CHECK combination for UPDATE, see that
-- migration's own comment. Bumped here rather than left to silently drift.
select is(
  (select count(*) from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'household_members' and cmd = 'SELECT'),
  4::bigint,
  'Structural: household_members now carries exactly 4 SELECT policies (S2.1''s two, S2.5''s one, M6.1''s one)'
);

select ok(
  exists (
    select 1 from pg_catalog.pg_policies
     where schemaname = 'public' and tablename = 'household_members'
       and policyname = 'household_members_select_self'
  )
  and exists (
    select 1 from pg_catalog.pg_policies
     where schemaname = 'public' and tablename = 'household_members'
       and policyname = 'household_members_select_parent_active_members'
  ),
  'Structural: both of S2.1''s original policies still exist by name, untouched'
);

select is(
  (select count(*) from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'households'),
  1::bigint,
  'Structural: households carries exactly 1 policy total (the new SELECT policy; no write policy was added)'
);

select * from finish();

rollback;
