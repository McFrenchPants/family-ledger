-- Regression tests: public.household_members integrity constraints.
--
-- These guard invariants that the next phase's Row Level Security policies are
-- written directly on top of:
--   * household_members_household_id_user_id_key -- the partial unique index
--     that makes "which membership row is this caller?" unambiguous. Two rows
--     for one auth user in one household (say 'parent' and 'child') would make
--     a role lookup non-deterministic, i.e. a privilege-escalation ambiguity.
--   * household_members_role_check / _status_check -- `role` is what every
--     later authorization decision reads.
--
-- Run with: npm run test:db  (wraps `npx supabase test db --local`)
--
-- Self-contained: creates its own fixtures, depends on nothing in seed.sql,
-- and the whole file runs inside begin/rollback so the database is left
-- exactly as it was found.

begin;

-- pgTAP is a *test* dependency, deliberately not part of any migration: the
-- production schema must not carry a test framework. Creating it here inside
-- the transaction means it is rolled back with everything else.
create extension if not exists pgtap with schema extensions;
set local search_path to extensions, public, pg_catalog;

select plan(9);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

insert into public.households (id, name, timezone) values
  ('11111111-1111-1111-1111-111111111111', 'Household A', 'America/Chicago'),
  ('22222222-2222-2222-2222-222222222222', 'Household B', 'Europe/Paris');

-- household_members.user_id is a real FK to auth.users, so linked rows need
-- real auth users. Created in-transaction; rolled back with the rest.
insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'u1@example.test'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'u2@example.test');

insert into public.household_members (id, household_id, user_id, name, role, status) values
  ('a0000000-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Parent One', 'parent', 'active'),
  ('a0000000-0000-0000-0000-000000000002',
   '11111111-1111-1111-1111-111111111111',
   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Child One', 'child', 'active');

-- ---------------------------------------------------------------------------
-- Structural assertions: the index must exist, be unique, and be partial.
-- ---------------------------------------------------------------------------

select has_index(
  'public', 'household_members', 'household_members_household_id_user_id_key',
  array['household_id', 'user_id'],
  'partial unique index on (household_id, user_id) exists'
);

-- to_regclass (not ::regclass) so that if the index has been dropped these
-- assertions fail cleanly instead of raising and aborting the whole file --
-- the behavioural assertions below must still get a chance to report.
select is(
  (select i.indisunique
     from pg_catalog.pg_index i
    where i.indexrelid = pg_catalog.to_regclass('public.household_members_household_id_user_id_key')),
  true,
  'household_members_household_id_user_id_key is UNIQUE'
);

-- If the WHERE clause were dropped the index would be over-broad; if it were
-- changed the null-user_id rows below would start colliding.
select is(
  (select pg_catalog.pg_get_expr(i.indpred, i.indrelid)
     from pg_catalog.pg_index i
    where i.indexrelid = pg_catalog.to_regclass('public.household_members_household_id_user_id_key')),
  '(user_id IS NOT NULL)',
  'index carries the `where user_id is not null` partial predicate'
);

-- ---------------------------------------------------------------------------
-- Behavioural assertions
-- ---------------------------------------------------------------------------

-- 1. Two membership rows for the same auth user in the same household: the
--    ambiguity that would let one user resolve to two different roles.
select throws_ok(
  $$
    insert into public.household_members (household_id, user_id, name, role, status)
    values ('11111111-1111-1111-1111-111111111111',
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Parent One Again', 'child', 'active')
  $$,
  '23505',
  null,
  'INSERT of a duplicate (household_id, user_id) is rejected with unique_violation'
);

-- 2. The escalation path proper: an existing second row is *repointed* at an
--    already-linked user_id. An insert-only guard would miss this.
select throws_ok(
  $$
    update public.household_members
       set user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
     where id = 'a0000000-0000-0000-0000-000000000002'
  $$,
  '23505',
  null,
  'UPDATE repointing a row at an already-linked user_id is rejected with unique_violation'
);

-- 3. The index is scoped to one household, not global: the same person may
--    belong to a second household.
select lives_ok(
  $$
    insert into public.household_members (household_id, user_id, name, role, status)
    values ('22222222-2222-2222-2222-222222222222',
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Parent One Elsewhere', 'parent', 'active')
  $$,
  'the same user_id in a DIFFERENT household is allowed (index is per-household)'
);

-- 4. The partial predicate: unlinked (invited/archived) people have no auth
--    user yet, and any number of them may coexist in one household.
select lives_ok(
  $$
    insert into public.household_members (household_id, user_id, name, role, status)
    values ('11111111-1111-1111-1111-111111111111', null, 'Invited Kid A', 'child', 'invited'),
           ('11111111-1111-1111-1111-111111111111', null, 'Invited Kid B', 'child', 'invited'),
           ('11111111-1111-1111-1111-111111111111', null, 'Archived Kid',  'child', 'archived')
  $$,
  'multiple rows with user_id IS NULL in one household are allowed'
);

-- ---------------------------------------------------------------------------
-- role / status check constraints
-- ---------------------------------------------------------------------------

select throws_ok(
  $$
    insert into public.household_members (household_id, user_id, name, role, status)
    values ('11111111-1111-1111-1111-111111111111', null, 'Bogus', 'admin', 'active')
  $$,
  '23514',
  null,
  'a role outside (parent, child) is rejected by household_members_role_check'
);

select throws_ok(
  $$
    insert into public.household_members (household_id, user_id, name, role, status)
    values ('11111111-1111-1111-1111-111111111111', null, 'Bogus', 'child', 'suspended')
  $$,
  '23514',
  null,
  'a status outside (active, invited, archived) is rejected by household_members_status_check'
);

select * from finish();

rollback;
