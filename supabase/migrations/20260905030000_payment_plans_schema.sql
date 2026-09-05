-- Family Ledger: P2.1 payment plans schema.
--
-- Adds payment_plans (a recurring minimum-payment obligation for a child) and
-- payment_periods (the concrete, dated instances a plan generates over time),
-- on top of Phase 0/1's households / household_members / ledger_transactions.
--
-- RLS is enabled on both new tables with ZERO policies, matching
-- 20260904220228_create_households_and_members.sql and
-- 20260904223000_ledger_schema.sql. That is deliberate here too: RLS with no
-- policies is default-deny for anon/authenticated. The real policy set is a
-- later task's work (P2.2+), and must not be inferred from this file.

-- ---------------------------------------------------------------------------
-- payment_plans
-- ---------------------------------------------------------------------------
--
-- A recurring "this child owes at least $X by day D of each period" rule. Only
-- one row is ever "the current plan" for a given member -- see the partial
-- unique index below -- but history of past plans is kept (they are simply
-- marked inactive rather than deleted or overwritten), consistent with this
-- project's append-oriented, never-destroy-history posture.

create table if not exists public.payment_plans (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null
    references public.households (id) on delete cascade,
  member_id uuid not null
    references public.household_members (id) on delete restrict,
  minimum_cents bigint not null,
  frequency text not null default 'monthly',
  -- Day-of-month the payment is due, represented as a plain integer 1-28
  -- rather than a date-arithmetic expression. Restricting to 1-28 (instead of
  -- 1-31) avoids any need for end-of-month clamping logic entirely, since
  -- every month -- including February -- has at least 28 days. A due_day of
  -- 30 would otherwise force a policy decision ("clamp to the 28th/29th in
  -- February? roll to March 2nd?") for every period-generation call; capping
  -- the input range at the schema level removes that ambiguity rather than
  -- resolving it per-call.
  due_day integer not null,
  starts_on date not null,
  ends_on date,
  active boolean not null default true,
  created_by uuid not null
    references public.household_members (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint payment_plans_minimum_cents_positive_check
    check (minimum_cents > 0),

  -- Only 'monthly' is supported today. A future 'weekly' (or similar) cadence
  -- is expected, but adding it is a value-list change to this CHECK, not a
  -- structural one -- nothing else in this table's shape assumes monthly-only.
  constraint payment_plans_frequency_check
    check (frequency in ('monthly')),

  constraint payment_plans_due_day_range_check
    check (due_day between 1 and 28)
);

comment on table public.payment_plans is
  'A recurring minimum-payment obligation for one child. At most one active plan per member -- see payment_plans_member_id_active_key.';
comment on column public.payment_plans.minimum_cents is
  'Integer cents. Must be positive -- constrained by payment_plans_minimum_cents_positive_check.';
comment on column public.payment_plans.frequency is
  'Cadence of the plan. Only ''monthly'' is supported today -- constrained by payment_plans_frequency_check. Adding a new cadence later is a value-list change to that CHECK.';
comment on column public.payment_plans.due_day is
  'Day of the period (1-28) the payment is due. Capped at 28 -- rather than 1-31 -- so every supported month has that day, avoiding end-of-month clamping logic entirely.';
comment on column public.payment_plans.ends_on is
  'Optional end date. NULL means the plan has no scheduled end.';
comment on column public.payment_plans.active is
  'Whether this is the member''s current plan. At most one active plan per member -- see payment_plans_member_id_active_key. Past plans are kept (marked inactive), never deleted or overwritten.';

-- Foreign key columns are not indexed automatically by Postgres; index both so
-- joins and ON DELETE do not fall back to sequential scans.
create index if not exists payment_plans_household_id_idx
  on public.payment_plans (household_id);

create index if not exists payment_plans_member_id_idx
  on public.payment_plans (member_id);

-- At most one active plan per member.
--
-- Mirrors household_members_household_id_user_id_key in
-- 20260904220228_create_households_and_members.sql: a unique *index*, not a
-- unique *constraint*, because Postgres has no syntax for a partial unique
-- constraint. Without this, a member could end up with two simultaneously
-- "active" plans and every consumer (period generation, balance/compliance
-- checks, the UI) would have to guess which one is authoritative.
create unique index if not exists payment_plans_member_id_active_key
  on public.payment_plans (member_id)
  where active;

-- ---------------------------------------------------------------------------
-- payment_periods
-- ---------------------------------------------------------------------------
--
-- One concrete, dated instance of a plan's obligation (e.g. "March 2026's
-- minimum payment"). household_id and member_id are denormalized from the
-- parent plan -- the same rationale ledger_transactions.household_id already
-- uses: it simplifies later RLS policies, which can filter directly on this
-- row instead of joining through payment_plans for every check.
--
-- minimum_cents is copied from the plan at creation time and does not track
-- later edits to the plan -- a period, once generated, records what was owed
-- for that window at the time it was generated, consistent with this
-- project's append-oriented posture (ledger_transactions rows are likewise
-- immutable after creation).

create table if not exists public.payment_periods (
  id uuid primary key default gen_random_uuid(),
  payment_plan_id uuid not null
    references public.payment_plans (id) on delete cascade,
  household_id uuid not null
    references public.households (id) on delete cascade,
  member_id uuid not null
    references public.household_members (id) on delete restrict,
  period_start date not null,
  due_date date not null,
  minimum_cents bigint not null,
  waived_at timestamptz,
  waived_by uuid
    references public.household_members (id) on delete restrict,
  waive_reason text,
  created_at timestamptz not null default now(),

  constraint payment_periods_minimum_cents_positive_check
    check (minimum_cents > 0),

  -- A partial waive is impossible to insert or update into: all three of
  -- waived_at/waived_by/waive_reason are NULL together (not waived), or all
  -- three are NOT NULL together (waived). Any other combination is rejected.
  -- Mirrors ledger_transactions_void_all_or_nothing_check in
  -- 20260904223000_ledger_schema.sql.
  constraint payment_periods_waive_all_or_nothing_check
    check (
      (waived_at is null and waived_by is null and waive_reason is null)
      or (waived_at is not null and waived_by is not null and waive_reason is not null)
    ),

  -- Prevents duplicate periods for the same plan/window -- including under
  -- concurrent calls to a future lazy-generation function (not part of this
  -- task) that might otherwise race to create the same period twice.
  constraint payment_periods_plan_id_period_start_key
    unique (payment_plan_id, period_start)
);

comment on table public.payment_periods is
  'A concrete, dated instance of a payment_plans row''s obligation for one period (e.g. one calendar month). Immutable once created, aside from the waive fields.';
comment on column public.payment_periods.household_id is
  'Denormalized from payment_plans.household_id so RLS policies can filter this table directly without joining through payment_plans.';
comment on column public.payment_periods.member_id is
  'Denormalized from payment_plans.member_id so RLS policies can filter this table directly without joining through payment_plans.';
comment on column public.payment_periods.minimum_cents is
  'Copied from the parent plan at creation time. Fixed for this period -- does not change if the plan is later edited.';
comment on column public.payment_periods.waived_at is
  'Set together with waived_by and waive_reason, or not at all -- see payment_periods_waive_all_or_nothing_check.';

create index if not exists payment_periods_payment_plan_id_idx
  on public.payment_periods (payment_plan_id);

create index if not exists payment_periods_household_id_idx
  on public.payment_periods (household_id);

create index if not exists payment_periods_member_id_idx
  on public.payment_periods (member_id);

-- ---------------------------------------------------------------------------
-- Row Level Security (enabled, intentionally without policies)
-- ---------------------------------------------------------------------------

alter table public.payment_plans enable row level security;
alter table public.payment_periods enable row level security;
