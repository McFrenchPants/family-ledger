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

-- ---------------------------------------------------------------------------
-- Row Level Security (enabled, intentionally without policies)
-- ---------------------------------------------------------------------------

alter table public.households enable row level security;
alter table public.household_members enable row level security;
