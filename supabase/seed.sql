-- Family Ledger: local development seed data.
--
-- Loaded automatically by `supabase db reset` (see config.toml [db.seed]).
-- LOCAL DEVELOPMENT ONLY -- never run against the hosted project.
--
-- Rules this file follows:
--   * Placeholder names only. This is a committed fixture in a public repo;
--     nothing here resembles real household information.
--   * Fixed UUIDs, not gen_random_uuid(), so repeated resets produce byte-for-
--     byte identical data and app code can hard-code ids while developing.
--   * Idempotent: every insert is `on conflict ... do update`, so re-running
--     this file converges on the same state instead of erroring or duplicating.
--   * `user_id` is null on every member (status 'invited'). Linking members to
--     real auth.users rows is the auth phase's work; no hand-crafted auth rows
--     with fabricated password hashes are created here. Null user_id also means
--     nothing here can collide with the partial unique index on
--     (household_id, user_id) where user_id is not null.
--   * Only households / household_members exist at this point. No ledger,
--     transaction or payment-plan rows -- those tables do not exist yet.

-- ---------------------------------------------------------------------------
-- Household
-- ---------------------------------------------------------------------------

insert into public.households (id, name, timezone)
values (
  '00000000-0000-4000-8000-000000000001',
  'Example Household',
  'America/Chicago'   -- a real IANA zone; validated by the households trigger
)
on conflict (id) do update
  set name = excluded.name,
      timezone = excluded.timezone;

-- ---------------------------------------------------------------------------
-- Members: two parents, three children. All 'invited', all user_id null.
-- ---------------------------------------------------------------------------

insert into public.household_members (id, household_id, user_id, name, role, status)
values
  ('00000000-0000-4000-8000-000000000101',
   '00000000-0000-4000-8000-000000000001', null, 'Parent One',  'parent', 'invited'),
  ('00000000-0000-4000-8000-000000000102',
   '00000000-0000-4000-8000-000000000001', null, 'Parent Two',  'parent', 'invited'),
  ('00000000-0000-4000-8000-000000000201',
   '00000000-0000-4000-8000-000000000001', null, 'Child One',   'child',  'invited'),
  ('00000000-0000-4000-8000-000000000202',
   '00000000-0000-4000-8000-000000000001', null, 'Child Two',   'child',  'invited'),
  ('00000000-0000-4000-8000-000000000203',
   '00000000-0000-4000-8000-000000000001', null, 'Child Three', 'child',  'invited')
on conflict (id) do update
  set household_id = excluded.household_id,
      user_id = excluded.user_id,
      name = excluded.name,
      role = excluded.role,
      status = excluded.status;
