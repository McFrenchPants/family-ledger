-- Regression tests: N4.1 -- push_subscriptions table and RLS.
--
-- Covers 20260907090000_push_subscriptions.sql.
--
-- Role-switching idiom matches 003_ledger_privilege_escalation.sql,
-- 006_household_members_update_policy.sql, and
-- 007_add_household_member_function.sql: fixtures are created as this
-- file's default role (postgres, which bypasses RLS); each member-scoped
-- block sets `role authenticated` plus `request.jwt.claims` naming that
-- member's own auth.users id, then `reset role` returns to postgres before
-- the next block or before a postgres-only read of the true
-- (RLS-unfiltered) table state.
--
-- Self-contained: creates its own fixtures, depends on nothing in seed.sql,
-- and the whole file runs inside begin/rollback so the database is left
-- exactly as it was found.
--
-- Run with: npm run test:db  (wraps `npx supabase test db --local`)

begin;

create extension if not exists pgtap with schema extensions;
set local search_path to extensions, public, pg_catalog;

select plan(18);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
--
-- Household A: Parent (PA), three Children (CA1, CA2, CA3 -- CA3 never gets
-- a subscription, used to prove household_member_push_status reports an
-- accurate `false`).
-- Household B: Parent (PB) -- used for the cross-household rejection case.
--
-- Two push_subscriptions rows exist from the start (inserted directly as
-- postgres, bypassing RLS, simulating "already registered devices"): CA1's
-- and CA2's. CA1's own INSERT policy is proven separately, by CA1 adding a
-- SECOND row of their own below.

insert into public.households (id, name, timezone, child_expense_scope) values
  ('a0000000-0000-0000-0000-0000000000a1', 'Household A (N4.1)', 'America/Chicago', 'any_member'),
  ('a0000000-0000-0000-0000-0000000000b1', 'Household B (N4.1)', 'Europe/Paris', 'any_member');

insert into auth.users (id, email) values
  ('a1000000-0000-0000-0000-00000000a001', 'pa-n41@example.test'),
  ('a1000000-0000-0000-0000-00000000a002', 'ca1-n41@example.test'),
  ('a1000000-0000-0000-0000-00000000a003', 'ca2-n41@example.test'),
  ('a1000000-0000-0000-0000-00000000a004', 'ca3-n41@example.test'),
  ('a1000000-0000-0000-0000-00000000b001', 'pb-n41@example.test');

insert into public.household_members (id, household_id, user_id, name, role, status) values
  ('a2000000-0000-0000-0000-00000000a001', 'a0000000-0000-0000-0000-0000000000a1',
   'a1000000-0000-0000-0000-00000000a001', 'Parent A',  'parent', 'active'),
  ('a2000000-0000-0000-0000-00000000a002', 'a0000000-0000-0000-0000-0000000000a1',
   'a1000000-0000-0000-0000-00000000a002', 'Child A1',  'child',  'active'),
  ('a2000000-0000-0000-0000-00000000a003', 'a0000000-0000-0000-0000-0000000000a1',
   'a1000000-0000-0000-0000-00000000a003', 'Child A2',  'child',  'active'),
  ('a2000000-0000-0000-0000-00000000a004', 'a0000000-0000-0000-0000-0000000000a1',
   'a1000000-0000-0000-0000-00000000a004', 'Child A3',  'child',  'active'),
  ('a2000000-0000-0000-0000-00000000b001', 'a0000000-0000-0000-0000-0000000000b1',
   'a1000000-0000-0000-0000-00000000b001', 'Parent B',  'parent', 'active');

insert into public.push_subscriptions (id, household_member_id, endpoint, p256dh, auth) values
  ('a3000000-0000-0000-0000-00000000a001', 'a2000000-0000-0000-0000-00000000a002', 'ep-ca1-1', 'p256dh-ca1-1', 'auth-ca1-1'),
  ('a3000000-0000-0000-0000-00000000a002', 'a2000000-0000-0000-0000-00000000a003', 'ep-ca2-1', 'p256dh-ca2-1', 'auth-ca2-1');

-- ---------------------------------------------------------------------------
-- Criterion 1: a member can INSERT a subscription row for their own active
-- member record.
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"a1000000-0000-0000-0000-00000000a002","role":"authenticated"}';

insert into public.push_subscriptions (household_member_id, endpoint, p256dh, auth)
values ('a2000000-0000-0000-0000-00000000a002', 'ep-ca1-2', 'p256dh-ca1-2', 'auth-ca1-2');

reset role;

select is(
  (select count(*) from public.push_subscriptions
    where household_member_id = 'a2000000-0000-0000-0000-00000000a002'),
  2::bigint,
  'Criterion 1: a member can INSERT a subscription row for their own active member record'
);

-- ---------------------------------------------------------------------------
-- Criterion 2: a member cannot SELECT another household member's row
-- (including another member of their own household).
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"a1000000-0000-0000-0000-00000000a002","role":"authenticated"}';

select is(
  (select count(*) from public.push_subscriptions
    where household_member_id = 'a2000000-0000-0000-0000-00000000a003'),
  0::bigint,
  'Criterion 2: a member cannot SELECT another (sibling) member''s subscription row'
);

reset role;

-- ---------------------------------------------------------------------------
-- Criterion 3: a member cannot INSERT a subscription row for another
-- household member.
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"a1000000-0000-0000-0000-00000000a002","role":"authenticated"}';

select throws_ok(
  $$ insert into public.push_subscriptions (household_member_id, endpoint, p256dh, auth)
     values ('a2000000-0000-0000-0000-00000000a003', 'ep-evil-insert', 'evil-p256dh', 'evil-auth') $$,
  '42501',
  null,
  'Criterion 3: a member cannot INSERT a subscription row for another member'
);

reset role;

-- ---------------------------------------------------------------------------
-- Criterion 4: a member cannot DELETE another household member's row.
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"a1000000-0000-0000-0000-00000000a002","role":"authenticated"}';

delete from public.push_subscriptions
  where household_member_id = 'a2000000-0000-0000-0000-00000000a003';

reset role;

select is(
  (select count(*) from public.push_subscriptions
    where household_member_id = 'a2000000-0000-0000-0000-00000000a003'),
  1::bigint,
  'Criterion 4: a member''s DELETE against another member''s row affects zero rows (row still exists)'
);

-- ---------------------------------------------------------------------------
-- Criterion 5: re-subscribing the same endpoint (an upsert) updates the
-- existing row rather than creating a duplicate.
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"a1000000-0000-0000-0000-00000000a002","role":"authenticated"}';

insert into public.push_subscriptions (household_member_id, endpoint, p256dh, auth)
values ('a2000000-0000-0000-0000-00000000a002', 'ep-ca1-1', 'p256dh-ca1-1-refreshed', 'auth-ca1-1-refreshed')
on conflict (endpoint) do update
  set p256dh = excluded.p256dh,
      auth = excluded.auth;

reset role;

select is(
  (select count(*) from public.push_subscriptions where endpoint = 'ep-ca1-1'),
  1::bigint,
  'Criterion 5a: re-subscribing an existing endpoint does not create a duplicate row'
);

select is(
  (select p256dh from public.push_subscriptions where endpoint = 'ep-ca1-1'),
  'p256dh-ca1-1-refreshed',
  'Criterion 5b: re-subscribing an existing endpoint updates it in place'
);

-- ---------------------------------------------------------------------------
-- Criterion 6: a different member cannot use the upsert path to overwrite a
-- row they do not own.
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"a1000000-0000-0000-0000-00000000a003","role":"authenticated"}';

select throws_ok(
  $$ insert into public.push_subscriptions (household_member_id, endpoint, p256dh, auth)
     values ('a2000000-0000-0000-0000-00000000a003', 'ep-ca1-1', 'attacker-p256dh', 'attacker-auth')
     on conflict (endpoint) do update
       set p256dh = excluded.p256dh,
           auth = excluded.auth $$,
  '42501',
  null,
  'Criterion 6a: a different member cannot upsert-overwrite an endpoint they do not own'
);

reset role;

select is(
  (select p256dh from public.push_subscriptions where endpoint = 'ep-ca1-1'),
  'p256dh-ca1-1-refreshed',
  'Criterion 6b: the attempted cross-member upsert left the target row unchanged'
);

select is(
  (select household_member_id from public.push_subscriptions where endpoint = 'ep-ca1-1'),
  'a2000000-0000-0000-0000-00000000a002'::uuid,
  'Criterion 6c: the attempted cross-member upsert did not reassign ownership of the row'
);

-- ---------------------------------------------------------------------------
-- Criterion 7: a Parent can query household_member_push_status for their own
-- household's members and see accurate existence info.
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"a1000000-0000-0000-0000-00000000a001","role":"authenticated"}';

select is(
  (select has_subscription from public.household_member_push_status
    where household_member_id = 'a2000000-0000-0000-0000-00000000a002'),
  true,
  'Criterion 7a: Parent sees has_subscription = true for a child with a subscription'
);

select is(
  (select has_subscription from public.household_member_push_status
    where household_member_id = 'a2000000-0000-0000-0000-00000000a003'),
  true,
  'Criterion 7b: Parent sees has_subscription = true for a child with a (surviving) subscription'
);

select is(
  (select has_subscription from public.household_member_push_status
    where household_member_id = 'a2000000-0000-0000-0000-00000000a004'),
  false,
  'Criterion 7c: Parent sees has_subscription = false for a child with no subscription'
);

-- ---------------------------------------------------------------------------
-- Criterion 8: querying/selecting raw p256dh/auth values for another member
-- is rejected, both via the view (which never exposes them) and via direct
-- table access.
-- ---------------------------------------------------------------------------

select isnt(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'household_member_push_status'
      and column_name in ('p256dh', 'auth')
  ),
  true,
  'Criterion 8a: household_member_push_status does not expose p256dh/auth columns at all'
);

select is(
  (select count(*) from public.push_subscriptions
    where household_member_id = 'a2000000-0000-0000-0000-00000000a002'),
  0::bigint,
  'Criterion 8b: a Parent''s direct SELECT against push_subscriptions for a child''s row returns zero rows (no Parent-visibility policy exists on the base table)'
);

reset role;

-- ---------------------------------------------------------------------------
-- Criterion 9: a Parent of household B cannot see household A's members'
-- push status via the view.
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"a1000000-0000-0000-0000-00000000b001","role":"authenticated"}';

select is(
  (select count(*) from public.household_member_push_status
    where household_member_id in (
      'a2000000-0000-0000-0000-00000000a002',
      'a2000000-0000-0000-0000-00000000a003',
      'a2000000-0000-0000-0000-00000000a004'
    )),
  0::bigint,
  'Criterion 9: a Parent of a different household sees zero rows for another household''s members via the view'
);

reset role;

-- ---------------------------------------------------------------------------
-- Criterion 10: no audit_log row appears after a subscribe/unsubscribe
-- write -- deliberate, per this migration's design.
-- ---------------------------------------------------------------------------

select is(
  (select count(*) from public.audit_log where entity_type = 'push_subscriptions'),
  0::bigint,
  'Criterion 10: subscribing/unsubscribing writes no audit_log row'
);

-- ---------------------------------------------------------------------------
-- Structural assertions
-- ---------------------------------------------------------------------------

select is(
  (select count(*) from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'push_subscriptions'),
  4::bigint,
  'Structural: push_subscriptions carries exactly four RLS policies (select/insert/update/delete, all owner-scoped)'
);

select ok(
  exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'push_subscriptions' and c.relrowsecurity
  ),
  'Structural: push_subscriptions has row level security enabled'
);

select * from finish();

rollback;
