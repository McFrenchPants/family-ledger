-- Family Ledger: initial schema.
--
-- Creates the two foundational tables: households (the tenant boundary) and
-- household_members (people in a household, optionally linked to an auth user).
--
-- RLS is enabled on both tables with ZERO policies. That is deliberate and is
-- the intended end state of this migration: RLS with no policies is
-- default-deny for the anon/authenticated roles. The real authorization policy
-- set is a later phase's work and must not be inferred from this file.

-- ---------------------------------------------------------------------------
-- households
-- ---------------------------------------------------------------------------

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- IANA time zone identifier (e.g. 'Europe/Paris'). All "today" / "due" /
  -- "overdue" calculations are made against this zone, never the server's.
  timezone text not null,
  created_at timestamptz not null default now()
);

comment on table public.households is
  'A household (tenant boundary). All ledger data hangs off a household.';
comment on column public.households.timezone is
  'IANA time zone identifier used for all calendar-date calculations for this household.';

-- ---------------------------------------------------------------------------
-- households.timezone must be a real IANA zone
-- ---------------------------------------------------------------------------
--
-- The household's zone drives every today / due / overdue computation, so an
-- invalid value does not fail loudly at write time -- it silently mis-dates
-- financial obligations later. It has to be rejected at the write.
--
-- A plain CHECK cannot do this: check constraints may not contain subqueries,
-- so `check (timezone in (select name from pg_timezone_names))` is rejected.
-- Wrapping the lookup in a function marked IMMUTABLE so it *can* sit in a
-- CHECK would be a lie -- pg_timezone_names is a view over the OS/embedded tz
-- database, whose contents change when Postgres is upgraded -- and a CHECK
-- built on a falsely-immutable function silently stops being re-evaluated and
-- can make a dump un-restorable. A BEFORE trigger is the honest idiom.

create or replace function public.household_timezone_is_valid()
returns trigger
language plpgsql
-- SECURITY INVOKER (the default) is deliberate: this needs no elevated
-- privileges, and a SECURITY DEFINER function in `public` would be callable
-- by every role. Empty search_path + fully-qualified names so the function
-- cannot be hijacked by a caller-controlled search_path.
set search_path = ''
as $$
begin
  if not exists (
    select 1 from pg_catalog.pg_timezone_names where name = new.timezone
  ) then
    raise exception
      'invalid IANA time zone: %', new.timezone
      using errcode = 'check_violation',
            hint = 'Use an identifier from pg_timezone_names, e.g. America/Chicago.';
  end if;
  return new;
end;
$$;

comment on function public.household_timezone_is_valid() is
  'BEFORE INSERT/UPDATE trigger: rejects households.timezone values that are not real IANA zones.';

-- `create or replace trigger` (Postgres 14+) keeps this file re-runnable, in
-- keeping with the `if not exists` used everywhere else here.
create or replace trigger households_timezone_is_valid
  before insert or update of timezone on public.households
  for each row
  execute function public.household_timezone_is_valid();

-- ---------------------------------------------------------------------------
-- household_members
-- ---------------------------------------------------------------------------

create table if not exists public.household_members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null
    references public.households (id) on delete cascade,
  -- Nullable: an invited or archived member may have no auth user yet.
  user_id uuid
    references auth.users (id) on delete set null,
  name text not null,
  role text not null,
  status text not null default 'invited',
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint household_members_role_check
    check (role in ('parent', 'child')),
  constraint household_members_status_check
    check (status in ('active', 'invited', 'archived'))
);

comment on table public.household_members is
  'A person belonging to a household, optionally linked to an auth.users row.';
comment on column public.household_members.role is
  'parent | child. Constrained by household_members_role_check.';
comment on column public.household_members.status is
  'active | invited | archived. Constrained by household_members_status_check.';

-- Foreign key columns are not indexed automatically by Postgres; index both so
-- joins and ON DELETE CASCADE / SET NULL do not fall back to sequential scans.
create index if not exists household_members_household_id_idx
  on public.household_members (household_id);

create index if not exists household_members_user_id_idx
  on public.household_members (user_id);

-- One auth user may hold at most one membership row per household.
--
-- Without this, the same auth.users id can be inserted twice into the same
-- household -- once as 'parent', once as 'child' -- and both rows are
-- accepted. A later phase's RLS policies resolve the caller's role by looking
-- up their membership row, so two rows with conflicting roles for one user is
-- a privilege-escalation ambiguity against this project's hardest rule (a
-- Child must never be able to reduce a balance). Reject it in the schema.
--
-- PARTIAL, not a plain unique constraint: `user_id` is legitimately null for
-- invited or archived people with no auth account yet, and while SQL nulls do
-- not collide in a b-tree unique index by default, the partial predicate makes
-- that intent explicit and keeps those rows out of the index entirely. It is a
-- unique *index* rather than a unique *constraint* because Postgres has no
-- syntax for a partial unique constraint.
create unique index if not exists household_members_household_id_user_id_key
  on public.household_members (household_id, user_id)
  where user_id is not null;

-- ---------------------------------------------------------------------------
-- Row Level Security (enabled, intentionally without policies)
-- ---------------------------------------------------------------------------

alter table public.households enable row level security;
alter table public.household_members enable row level security;
