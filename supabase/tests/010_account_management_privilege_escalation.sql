-- Regression tests: account management -- controlled role / status changes
-- for household_members (public.change_household_member_role,
-- public.set_household_member_status, the column-level UPDATE hardening and
-- the trigger gate).
--
-- Covers 20260908090000_account_management_member_changes.sql.
--
-- Role-switching idiom matches 003_ledger_privilege_escalation.sql and
-- 007_add_household_member_function.sql: fixtures run as this file's default
-- role (postgres); each persona block sets `role authenticated` (or `anon`)
-- plus `request.jwt.claims` naming that person's auth.users id, then
-- `reset role` returns to postgres before the next block or before a
-- postgres-only read of the true (RLS-unfiltered) table state.
--
-- Every audit_log assertion filters on this file's own entity ids so rows
-- already present in a developer's local database cannot disturb the counts.
--
-- Self-contained: creates its own fixtures, depends on nothing in seed.sql,
-- and the whole file runs inside begin/rollback.
--
-- Run with: npm run test:db  (wraps `npx supabase test db --local`)

begin;

create extension if not exists pgtap with schema extensions;
set local search_path to extensions, public, pg_catalog;

select plan(87);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
--
-- Household A: P1, P1b (active Parents), C1, C1b (active Children),
--              ARCH (archived Child), INV (invited Child, no login yet).
-- Household B: P2 (the ONLY active Parent), C2.
-- Household C: PC1, PC2 (two active Parents).
-- Household D: G1 (a Child) -- used only for the postgres-level trigger tests.
-- NOUSER: a real auth user with no membership anywhere.

insert into public.households (id, name, timezone, child_expense_scope) values
  ('a0000000-0000-0000-0000-00000000000a', 'Household A', 'America/Chicago', 'any_member'),
  ('a0000000-0000-0000-0000-00000000000b', 'Household B', 'Europe/Paris', 'any_member'),
  ('a0000000-0000-0000-0000-00000000000c', 'Household C', 'Europe/Paris', 'any_member'),
  ('a0000000-0000-0000-0000-00000000000d', 'Household D', 'Europe/Paris', 'any_member');

insert into auth.users (id, email) values
  ('a1000000-0000-0000-0000-000000000001', 'p1-am2@example.test'),
  ('a1000000-0000-0000-0000-000000000002', 'p1b-am2@example.test'),
  ('a1000000-0000-0000-0000-000000000003', 'c1-am2@example.test'),
  ('a1000000-0000-0000-0000-000000000004', 'c1b-am2@example.test'),
  ('a1000000-0000-0000-0000-000000000005', 'arch-am2@example.test'),
  ('a1000000-0000-0000-0000-000000000007', 'p2-am2@example.test'),
  ('a1000000-0000-0000-0000-000000000008', 'c2-am2@example.test'),
  ('a1000000-0000-0000-0000-000000000009', 'pc1-am2@example.test'),
  ('a1000000-0000-0000-0000-000000000010', 'pc2-am2@example.test'),
  ('a1000000-0000-0000-0000-000000000011', 'nouser-am2@example.test'),
  ('a1000000-0000-0000-0000-000000000013', 'g1-am2@example.test');

insert into public.household_members (id, household_id, user_id, name, role, status, archived_at) values
  ('a2000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a',
   'a1000000-0000-0000-0000-000000000001', 'P1',   'parent', 'active', null),
  ('a2000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-00000000000a',
   'a1000000-0000-0000-0000-000000000002', 'P1b',  'parent', 'active', null),
  ('a2000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-00000000000a',
   'a1000000-0000-0000-0000-000000000003', 'C1',   'child',  'active', null),
  ('a2000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-00000000000a',
   'a1000000-0000-0000-0000-000000000004', 'C1b',  'child',  'active', null),
  ('a2000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-00000000000a',
   'a1000000-0000-0000-0000-000000000005', 'ARCH', 'child',  'archived', now()),
  ('a2000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-00000000000a',
   null,                                    'INV',  'child',  'invited', null),
  ('a2000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-00000000000b',
   'a1000000-0000-0000-0000-000000000007', 'P2',   'parent', 'active', null),
  ('a2000000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-00000000000b',
   'a1000000-0000-0000-0000-000000000008', 'C2',   'child',  'active', null),
  ('a2000000-0000-0000-0000-000000000009', 'a0000000-0000-0000-0000-00000000000c',
   'a1000000-0000-0000-0000-000000000009', 'PC1',  'parent', 'active', null),
  ('a2000000-0000-0000-0000-000000000010', 'a0000000-0000-0000-0000-00000000000c',
   'a1000000-0000-0000-0000-000000000010', 'PC2',  'parent', 'active', null),
  ('a2000000-0000-0000-0000-000000000013', 'a0000000-0000-0000-0000-00000000000d',
   'a1000000-0000-0000-0000-000000000013', 'G1',   'child',  'active', null);

-- One ledger row for C1b, inserted directly as postgres, to prove an archived
-- member's still-valid token reads nothing.
insert into public.categories (id, household_id, name) values
  ('a3000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'cat A');

insert into public.ledger_transactions
  (id, household_id, member_id, amount_cents, type, description, occurred_on, created_by) values
  ('a4000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a',
   'a2000000-0000-0000-0000-000000000004', 1000, 'expense', 'C1b baseline', current_date,
   'a2000000-0000-0000-0000-000000000001');

-- ---------------------------------------------------------------------------
-- S: structural / privilege assertions
-- ---------------------------------------------------------------------------

select ok(
  not has_table_privilege('authenticated', 'public.household_members', 'UPDATE'),
  'S1: authenticated has no table-wide UPDATE on household_members'
);

select ok(
  has_column_privilege('authenticated', 'public.household_members', 'name', 'UPDATE'),
  'S2: authenticated may still UPDATE household_members.name (rename)'
);

select ok(
  not has_column_privilege('authenticated', 'public.household_members', 'role', 'UPDATE'),
  'S3: authenticated has no UPDATE on household_members.role'
);

select ok(
  not has_column_privilege('authenticated', 'public.household_members', 'status', 'UPDATE'),
  'S4: authenticated has no UPDATE on household_members.status'
);

select ok(
  not has_column_privilege('authenticated', 'public.household_members', 'archived_at', 'UPDATE'),
  'S5: authenticated has no UPDATE on household_members.archived_at'
);

select ok(
  not has_column_privilege('authenticated', 'public.household_members', 'household_id', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.household_members', 'user_id', 'UPDATE'),
  'S6: authenticated has no UPDATE on household_members.household_id / user_id'
);

select ok(
  not has_column_privilege('anon', 'public.household_members', 'name', 'UPDATE'),
  'S7: anon has no UPDATE on household_members.name'
);

select ok(
  not has_function_privilege('anon', 'public.change_household_member_role(uuid,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.set_household_member_status(uuid,text)', 'EXECUTE'),
  'S8: anon cannot EXECUTE either function (revoked from public and anon)'
);

select ok(
  has_function_privilege('authenticated', 'public.change_household_member_role(uuid,text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.set_household_member_status(uuid,text)', 'EXECUTE'),
  'S9: authenticated can EXECUTE both functions'
);

-- ---------------------------------------------------------------------------
-- D: direct UPDATE of protected columns is denied, even for a Parent
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}';

select throws_ok(
  $$ update public.household_members set role = 'parent' where id = 'a2000000-0000-0000-0000-000000000003' $$,
  '42501', null,
  'D1: a Parent cannot directly UPDATE role'
);

select throws_ok(
  $$ update public.household_members set status = 'archived' where id = 'a2000000-0000-0000-0000-000000000003' $$,
  '42501', null,
  'D2: a Parent cannot directly UPDATE status'
);

select throws_ok(
  $$ update public.household_members set archived_at = now() where id = 'a2000000-0000-0000-0000-000000000003' $$,
  '42501', null,
  'D3: a Parent cannot directly UPDATE archived_at'
);

select throws_ok(
  $$ update public.household_members set household_id = 'a0000000-0000-0000-0000-00000000000b' where id = 'a2000000-0000-0000-0000-000000000003' $$,
  '42501', null,
  'D4: a Parent cannot directly UPDATE household_id'
);

select throws_ok(
  $$ update public.household_members set user_id = 'a1000000-0000-0000-0000-000000000011' where id = 'a2000000-0000-0000-0000-000000000003' $$,
  '42501', null,
  'D5: a Parent cannot directly UPDATE user_id'
);

-- Forgery attempt: a Parent sets the trigger's transaction-local setting
-- themselves (set_config is callable) and then tries a direct UPDATE of role.
-- The column privilege must still stop it.
select set_config('family_ledger.role_change_member_id', 'a2000000-0000-0000-0000-000000000003', true);

select throws_ok(
  $$ update public.household_members set role = 'parent' where id = 'a2000000-0000-0000-0000-000000000003' $$,
  '42501', null,
  'D6: forging the trigger setting does not let a Parent directly UPDATE role (column privilege holds)'
);

select set_config('family_ledger.role_change_member_id', '', true);

-- A Child, direct UPDATE of role / status on their own row.
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"a1000000-0000-0000-0000-000000000003","role":"authenticated"}';

select throws_ok(
  $$ update public.household_members set role = 'parent' where id = 'a2000000-0000-0000-0000-000000000003' $$,
  '42501', null,
  'D7: a Child cannot directly UPDATE their own role (self-promotion)'
);

select throws_ok(
  $$ update public.household_members set status = 'archived' where id = 'a2000000-0000-0000-0000-000000000003' $$,
  '42501', null,
  'D8: a Child cannot directly UPDATE status'
);

reset role;

-- Rename by a Parent still works and still audits exactly once.
set local role authenticated;
set local request.jwt.claims to '{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}';

update public.household_members set name = 'C1 Renamed'
 where id = 'a2000000-0000-0000-0000-000000000003';

reset role;

select is(
  (select name from public.household_members where id = 'a2000000-0000-0000-0000-000000000003'),
  'C1 Renamed',
  'D9: a Parent can still rename a member of their household'
);

select is(
  (select count(*) from public.audit_log
    where entity_id = 'a2000000-0000-0000-0000-000000000003' and action = 'renamed'),
  1::bigint,
  'D10: the rename wrote exactly one audit_log ''renamed'' row'
);

-- Post-condition of every denied direct UPDATE above.
select is(
  (select role || '/' || status from public.household_members where id = 'a2000000-0000-0000-0000-000000000003'),
  'child/active',
  'D11: C1 is still child/active after all the denied direct UPDATEs'
);

-- ---------------------------------------------------------------------------
-- T: trigger gate, exercised as postgres (which HAS column privileges, so
-- only the trigger stands in the way)
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ update public.household_members set role = 'parent' where id = 'a2000000-0000-0000-0000-000000000013' $$,
  '42501',
  'household_members.role can only be changed through change_household_member_role (was child, attempted parent)',
  'T1: even a role-privileged writer cannot change role without the function''s gate'
);

select set_config('family_ledger.role_change_member_id', 'a2000000-0000-0000-0000-000000000003', true);

select throws_ok(
  $$ update public.household_members set role = 'parent' where id = 'a2000000-0000-0000-0000-000000000013' $$,
  '42501', null,
  'T2: the gate is bound to one row id -- a setting naming a different member does not open it'
);

select set_config('family_ledger.role_change_member_id', 'a2000000-0000-0000-0000-000000000013', true);

select lives_ok(
  $$ update public.household_members set role = 'parent' where id = 'a2000000-0000-0000-0000-000000000013' $$,
  'T3: with the gate open for exactly that row, the role change goes through'
);

-- G1 is now household D's only active Parent: demoting it back must be refused
-- by the trigger itself (gate still open), proving the last-Parent rule is a
-- trigger-level invariant that does not depend on the function.
select throws_ok(
  $$ update public.household_members set role = 'child' where id = 'a2000000-0000-0000-0000-000000000013' $$,
  '42501',
  'cannot archive or demote the household''s only active Parent',
  'T4: the trigger refuses to demote the only active Parent even with the gate open'
);

select set_config('family_ledger.role_change_member_id', '', true);

select throws_ok(
  $$ update public.household_members set status = 'archived' where id = 'a2000000-0000-0000-0000-000000000013' $$,
  '42501',
  'cannot archive or demote the household''s only active Parent',
  'T5: the trigger refuses to archive the only active Parent'
);

-- ---------------------------------------------------------------------------
-- R-: change_household_member_role -- negative cases (no state change, no audit)
-- ---------------------------------------------------------------------------

-- A Child: self-promotion.
set local role authenticated;
set local request.jwt.claims to '{"sub":"a1000000-0000-0000-0000-000000000003","role":"authenticated"}';

select throws_ok(
  $$ select public.change_household_member_role('a2000000-0000-0000-0000-000000000003', 'parent') $$,
  '42501',
  'only an active Parent of this member''s household may change member roles',
  'R1: a Child cannot promote themselves'
);

select throws_ok(
  $$ select public.change_household_member_role('a2000000-0000-0000-0000-000000000004', 'parent') $$,
  '42501', null,
  'R2: a Child cannot promote a sibling'
);

select throws_ok(
  $$ select public.change_household_member_role('a2000000-0000-0000-0000-000000000001', 'child') $$,
  '42501', null,
  'R3: a Child cannot demote a Parent'
);

-- Parent of ANOTHER household.
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"a1000000-0000-0000-0000-000000000007","role":"authenticated"}';

select throws_ok(
  $$ select public.change_household_member_role('a2000000-0000-0000-0000-000000000003', 'parent') $$,
  '42501',
  'only an active Parent of this member''s household may change member roles',
  'R4: a Parent of household B cannot promote a household A member'
);

select throws_ok(
  $$ select public.change_household_member_role('a2000000-0000-0000-0000-000000000001', 'child') $$,
  '42501', null,
  'R5: a Parent of household B cannot demote a household A Parent'
);

-- A user with no membership anywhere, and a nonexistent member id: the SAME
-- generic message (nothing reveals whether the member exists).
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"a1000000-0000-0000-0000-000000000011","role":"authenticated"}';

select throws_ok(
  $$ select public.change_household_member_role('a2000000-0000-0000-0000-000000000003', 'parent') $$,
  '42501',
  'only an active Parent of this member''s household may change member roles',
  'R6: a user with no membership at all is rejected'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}';

select throws_ok(
  $$ select public.change_household_member_role('deadbeef-0000-0000-0000-000000000000', 'parent') $$,
  '42501',
  'only an active Parent of this member''s household may change member roles',
  'R7: a nonexistent member id gets the same generic denial (no existence leak)'
);

select throws_ok(
  $$ select public.change_household_member_role(null, 'parent') $$,
  '42501', null,
  'R8: a null member id gets the same generic denial'
);

-- P1 (Parent of A) against household B's member: zero cross-household effect.
select throws_ok(
  $$ select public.change_household_member_role('a2000000-0000-0000-0000-000000000008', 'parent') $$,
  '42501', null,
  'R9: a Parent of household A cannot change a household B member''s role'
);

-- Valid caller, invalid input.
select throws_ok(
  $$ select public.change_household_member_role('a2000000-0000-0000-0000-000000000003', 'admin') $$,
  '23514', 'role must be ''parent'' or ''child'', got admin',
  'R10: an invalid role string is rejected'
);

select throws_ok(
  $$ select public.change_household_member_role('a2000000-0000-0000-0000-000000000003', null) $$,
  '23514', 'role must be ''parent'' or ''child'', got <NULL>',
  'R11: a null role is rejected'
);

select throws_ok(
  $$ select public.change_household_member_role('a2000000-0000-0000-0000-000000000003', 'child') $$,
  '23514', 'member already has role child',
  'R12: a no-op role change is rejected with a clear error'
);

select throws_ok(
  $$ select public.change_household_member_role('a2000000-0000-0000-0000-000000000005', 'parent') $$,
  '23514', null,
  'R13: an archived member''s role cannot be changed'
);

reset role;
set local role anon;
set local request.jwt.claims to '{"role":"anon"}';

select throws_ok(
  $$ select public.change_household_member_role('a2000000-0000-0000-0000-000000000003', 'parent') $$,
  '42501', null,
  'R14: an unauthenticated (anon) caller is rejected'
);

reset role;

select is(
  (select string_agg(id::text || '=' || role, ',' order by id) from public.household_members
    where id in ('a2000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000002',
                 'a2000000-0000-0000-0000-000000000003', 'a2000000-0000-0000-0000-000000000004',
                 'a2000000-0000-0000-0000-000000000005', 'a2000000-0000-0000-0000-000000000007',
                 'a2000000-0000-0000-0000-000000000008')),
  'a2000000-0000-0000-0000-000000000001=parent,a2000000-0000-0000-0000-000000000002=parent,a2000000-0000-0000-0000-000000000003=child,a2000000-0000-0000-0000-000000000004=child,a2000000-0000-0000-0000-000000000005=child,a2000000-0000-0000-0000-000000000007=parent,a2000000-0000-0000-0000-000000000008=child',
  'R15: no role changed anywhere after all the rejected calls'
);

select is(
  (select count(*) from public.audit_log where action = 'role_changed'
     and entity_id in (select id from public.household_members
                        where household_id in ('a0000000-0000-0000-0000-00000000000a',
                                               'a0000000-0000-0000-0000-00000000000b',
                                               'a0000000-0000-0000-0000-00000000000c'))),
  0::bigint,
  'R16: no ''role_changed'' audit row was written by any rejected call'
);

-- ---------------------------------------------------------------------------
-- R+: change_household_member_role -- positive cases
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}';

create temp table tmp_promote as
select * from public.change_household_member_role('a2000000-0000-0000-0000-000000000003', 'parent');

reset role;

select is(
  (select role from tmp_promote),
  'parent',
  'P1: promoting a Child returns the updated row'
);

select is(
  (select role from public.household_members where id = 'a2000000-0000-0000-0000-000000000003'),
  'parent',
  'P2: the member row now holds role parent'
);

select is(
  (select count(*) from public.audit_log
    where entity_id = 'a2000000-0000-0000-0000-000000000003' and action = 'role_changed'),
  1::bigint,
  'P3: exactly one ''role_changed'' audit row'
);

select is(
  (select old_values from public.audit_log
    where entity_id = 'a2000000-0000-0000-0000-000000000003' and action = 'role_changed'),
  '{"role":"child"}'::jsonb,
  'P4: audit old_values is {role: child}'
);

select is(
  (select new_values from public.audit_log
    where entity_id = 'a2000000-0000-0000-0000-000000000003' and action = 'role_changed'),
  '{"role":"parent"}'::jsonb,
  'P5: audit new_values is {role: parent}'
);

select is(
  (select actor_user_id::text || '/' || household_id::text || '/' || entity_type from public.audit_log
    where entity_id = 'a2000000-0000-0000-0000-000000000003' and action = 'role_changed'),
  'a1000000-0000-0000-0000-000000000001/a0000000-0000-0000-0000-00000000000a/household_members',
  'P6: audit row names the acting Parent, the household and the entity type'
);

-- The newly promoted Parent can act as a Parent (promotion is real).
set local role authenticated;
set local request.jwt.claims to '{"sub":"a1000000-0000-0000-0000-000000000003","role":"authenticated"}';

select lives_ok(
  $$ select public.change_household_member_role('a2000000-0000-0000-0000-000000000006', 'parent') $$,
  'P7: the promoted member can now change an INVITED member''s role (invited members are allowed)'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}';

-- A has active Parents P1, P1b, C1 (3): demoting another Parent is allowed.
select lives_ok(
  $$ select public.change_household_member_role('a2000000-0000-0000-0000-000000000002', 'child') $$,
  'P8: demoting another Parent while several exist is allowed'
);

select lives_ok(
  $$ select public.change_household_member_role('a2000000-0000-0000-0000-000000000003', 'child') $$,
  'P9: demoting a second Parent (two remain -> one remains) is allowed'
);

-- P1 is now the only ACTIVE Parent of A (INV is invited, not active).
select throws_ok(
  $$ select public.change_household_member_role('a2000000-0000-0000-0000-000000000001', 'child') $$,
  '42501',
  'cannot archive or demote the household''s only active Parent',
  'P10: a Parent cannot demote themselves when they are the only active Parent'
);

reset role;

select is(
  (select role from public.household_members where id = 'a2000000-0000-0000-0000-000000000001'),
  'parent',
  'P11: P1 is still a Parent after the refused self-demotion'
);

select is(
  (select count(*) from public.audit_log
    where entity_id = 'a2000000-0000-0000-0000-000000000001' and action = 'role_changed'),
  0::bigint,
  'P12: the refused self-demotion wrote no audit row'
);

-- Household C has two Parents: self-demotion is allowed there.
set local role authenticated;
set local request.jwt.claims to '{"sub":"a1000000-0000-0000-0000-000000000009","role":"authenticated"}';

select lives_ok(
  $$ select public.change_household_member_role('a2000000-0000-0000-0000-000000000009', 'child') $$,
  'P13: a Parent may demote themselves when another active Parent remains'
);

reset role;

select is(
  (select string_agg(id::text || '=' || role, ',' order by id) from public.household_members
    where household_id in ('a0000000-0000-0000-0000-00000000000b')),
  'a2000000-0000-0000-0000-000000000007=parent,a2000000-0000-0000-0000-000000000008=child',
  'P14: household B''s members are untouched by everything household A''s Parents did'
);

-- ---------------------------------------------------------------------------
-- S-: set_household_member_status -- negative cases
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"a1000000-0000-0000-0000-000000000004","role":"authenticated"}';

select throws_ok(
  $$ select public.set_household_member_status('a2000000-0000-0000-0000-000000000004', 'archived') $$,
  '42501',
  'only an active Parent of this member''s household may archive or restore members',
  'Q1: a Child cannot archive themselves'
);

select throws_ok(
  $$ select public.set_household_member_status('a2000000-0000-0000-0000-000000000001', 'archived') $$,
  '42501', null,
  'Q2: a Child cannot archive a Parent'
);

select throws_ok(
  $$ select public.set_household_member_status('a2000000-0000-0000-0000-000000000005', 'active') $$,
  '42501', null,
  'Q3: a Child cannot restore an archived member'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"a1000000-0000-0000-0000-000000000007","role":"authenticated"}';

select throws_ok(
  $$ select public.set_household_member_status('a2000000-0000-0000-0000-000000000004', 'archived') $$,
  '42501',
  'only an active Parent of this member''s household may archive or restore members',
  'Q4: a Parent of household B cannot archive a household A member'
);

select throws_ok(
  $$ select public.set_household_member_status('a2000000-0000-0000-0000-000000000005', 'active') $$,
  '42501', null,
  'Q5: a Parent of household B cannot restore a household A member'
);

select throws_ok(
  $$ select public.set_household_member_status('a2000000-0000-0000-0000-000000000007', 'archived') $$,
  '42501',
  'cannot archive or demote the household''s only active Parent',
  'Q6: archiving the only active Parent (self) is refused'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"a1000000-0000-0000-0000-000000000011","role":"authenticated"}';

select throws_ok(
  $$ select public.set_household_member_status('a2000000-0000-0000-0000-000000000004', 'archived') $$,
  '42501', null,
  'Q7: a user with no membership at all is rejected'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}';

select throws_ok(
  $$ select public.set_household_member_status('deadbeef-0000-0000-0000-000000000000', 'archived') $$,
  '42501',
  'only an active Parent of this member''s household may archive or restore members',
  'Q8: a nonexistent member id gets the same generic denial'
);

select throws_ok(
  $$ select public.set_household_member_status('a2000000-0000-0000-0000-000000000008', 'archived') $$,
  '42501', null,
  'Q9: a Parent of household A cannot archive a household B member'
);

select throws_ok(
  $$ select public.set_household_member_status('a2000000-0000-0000-0000-000000000004', 'invited') $$,
  '23514', 'status must be ''active'' or ''archived'', got invited',
  'Q10: ''invited'' is not an allowed target status'
);

select throws_ok(
  $$ select public.set_household_member_status('a2000000-0000-0000-0000-000000000004', null) $$,
  '23514', 'status must be ''active'' or ''archived'', got <NULL>',
  'Q11: a null status is rejected'
);

select throws_ok(
  $$ select public.set_household_member_status('a2000000-0000-0000-0000-000000000005', 'archived') $$,
  '23514', 'member is already archived',
  'Q12: archiving an already-archived member is rejected'
);

select throws_ok(
  $$ select public.set_household_member_status('a2000000-0000-0000-0000-000000000004', 'active') $$,
  '23514', 'only an archived member can be restored',
  'Q13: restoring a member who is not archived is rejected'
);

reset role;
set local role anon;
set local request.jwt.claims to '{"role":"anon"}';

select throws_ok(
  $$ select public.set_household_member_status('a2000000-0000-0000-0000-000000000004', 'archived') $$,
  '42501', null,
  'Q14: an unauthenticated (anon) caller is rejected'
);

reset role;

select is(
  (select string_agg(id::text || '=' || status, ',' order by id) from public.household_members
    where id in ('a2000000-0000-0000-0000-000000000004', 'a2000000-0000-0000-0000-000000000005',
                 'a2000000-0000-0000-0000-000000000007', 'a2000000-0000-0000-0000-000000000008')),
  'a2000000-0000-0000-0000-000000000004=active,a2000000-0000-0000-0000-000000000005=archived,a2000000-0000-0000-0000-000000000007=active,a2000000-0000-0000-0000-000000000008=active',
  'Q15: no status changed after all the rejected calls'
);

select is(
  (select count(*) from public.audit_log
    where action in ('archived', 'restored')
      and entity_id in (select id from public.household_members
                         where household_id in ('a0000000-0000-0000-0000-00000000000a',
                                                'a0000000-0000-0000-0000-00000000000b',
                                                'a0000000-0000-0000-0000-00000000000c'))),
  0::bigint,
  'Q16: no ''archived'' / ''restored'' audit row was written by any rejected call'
);

-- ---------------------------------------------------------------------------
-- S+: set_household_member_status -- positive cases
-- ---------------------------------------------------------------------------

-- Positive control: C1b (still active) can read their own ledger row.
set local role authenticated;
set local request.jwt.claims to '{"sub":"a1000000-0000-0000-0000-000000000004","role":"authenticated"}';

select is(
  (select count(*) from public.ledger_transactions where member_id = 'a2000000-0000-0000-0000-000000000004'),
  1::bigint,
  'A1: (control) an active Child can read their own ledger row'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}';

create temp table tmp_archive as
select * from public.set_household_member_status('a2000000-0000-0000-0000-000000000004', 'archived');

reset role;

select is(
  (select status || '/' || (archived_at is not null)::text from tmp_archive),
  'archived/true',
  'A2: archiving returns the row with status archived and archived_at set'
);

select is(
  (select status || '/' || (archived_at is not null)::text from public.household_members
    where id = 'a2000000-0000-0000-0000-000000000004'),
  'archived/true',
  'A3: the stored row is archived with archived_at set'
);

select is(
  (select count(*) from public.audit_log
    where entity_id = 'a2000000-0000-0000-0000-000000000004' and action = 'archived'),
  1::bigint,
  'A4: archiving wrote exactly one ''archived'' audit row (no double logging)'
);

select is(
  (select actor_user_id::text || '/' || (old_values ->> 'status') || '/' || (new_values ->> 'status')
     from public.audit_log
    where entity_id = 'a2000000-0000-0000-0000-000000000004' and action = 'archived'),
  'a1000000-0000-0000-0000-000000000001/active/archived',
  'A5: the audit row names the acting Parent and the old/new status'
);

select is(
  (select count(*) from public.audit_log where entity_id = 'a2000000-0000-0000-0000-000000000004'),
  1::bigint,
  'A6: archiving wrote only that one audit row of any kind'
);

-- The archived member's still-valid token reads nothing.
set local role authenticated;
set local request.jwt.claims to '{"sub":"a1000000-0000-0000-0000-000000000004","role":"authenticated"}';

select is(
  (select count(*) from public.ledger_transactions where member_id = 'a2000000-0000-0000-0000-000000000004'),
  0::bigint,
  'A7: an archived member can no longer read their ledger rows'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}';

create temp table tmp_restore as
select * from public.set_household_member_status('a2000000-0000-0000-0000-000000000004', 'active');

reset role;

select is(
  (select status || '/' || (archived_at is null)::text from tmp_restore),
  'active/true',
  'A8: restoring returns the row with status active and archived_at cleared'
);

select is(
  (select count(*) from public.audit_log
    where entity_id = 'a2000000-0000-0000-0000-000000000004' and action = 'restored'),
  1::bigint,
  'A9: restoring wrote exactly one ''restored'' audit row'
);

select is(
  (select count(*) from public.audit_log where entity_id = 'a2000000-0000-0000-0000-000000000004'),
  2::bigint,
  'A10: the archive + restore pair wrote exactly two audit rows in total'
);

set local role authenticated;
set local request.jwt.claims to '{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}';

select lives_ok(
  $$ select public.set_household_member_status('a2000000-0000-0000-0000-000000000006', 'archived') $$,
  'A11: an invited member can be archived'
);

-- Household C has PC2 as sole active Parent (PC1 demoted itself above).
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"a1000000-0000-0000-0000-000000000010","role":"authenticated"}';

select throws_ok(
  $$ select public.set_household_member_status('a2000000-0000-0000-0000-000000000010', 'archived') $$,
  '42501',
  'cannot archive or demote the household''s only active Parent',
  'A12: the only active Parent of household C cannot archive themselves'
);

-- Promote PC1 back (PC2 is a Parent), then PC2 may archive themselves.
select lives_ok(
  $$ select public.change_household_member_role('a2000000-0000-0000-0000-000000000009', 'parent') $$,
  'A13: PC2 promotes PC1 back to Parent'
);

select lives_ok(
  $$ select public.set_household_member_status('a2000000-0000-0000-0000-000000000010', 'archived') $$,
  'A14: a Parent may archive themselves when another active Parent remains'
);

-- PC2 is now archived but holds a still-valid token: every function is denied.
select throws_ok(
  $$ select public.change_household_member_role('a2000000-0000-0000-0000-000000000009', 'child') $$,
  '42501', null,
  'A15: an archived Parent cannot change roles (not an ACTIVE Parent any more)'
);

select throws_ok(
  $$ select public.set_household_member_status('a2000000-0000-0000-0000-000000000010', 'active') $$,
  '42501', null,
  'A16: an archived Parent cannot restore themselves'
);

reset role;

select * from finish();

rollback;
