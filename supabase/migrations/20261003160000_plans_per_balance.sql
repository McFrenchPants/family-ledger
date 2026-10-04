-- Family Ledger: CB4 -- payment plans per tracked balance.
--
-- Backlog 16 (category balances), design: docs/proposals/category-balances/
-- DESIGN_SPEC.md, plan task CB4.
--
-- A child may now have one active payment plan PER tracked balance (e.g. an
-- Everyday minimum and a separate Car minimum). Each plan is measured only
-- against the payment parts allocated to its own balance (CB2's
-- payment_allocations). Everyday behaviour is unchanged: with no
-- p_tracked_balance_id a plan is an Everyday plan, and a payment with no
-- explicit allocation is wholly Everyday, so existing plans read exactly as
-- before.
--
-- Contents:
--   * payment_plans.tracked_balance_id (backfilled to the household's
--     Everyday balance, then NOT NULL; composite FK pins it to the plan's own
--     household; BEFORE INSERT trigger fills Everyday when omitted)
--   * "one active plan per member" index becomes "one active plan per
--     (member, balance)"
--   * public.create_payment_plan gains trailing p_tracked_balance_id default
--     null (null = Everyday) and supersedes only that balance's active plan
--   * public.payment_period_status counts only the payment parts allocated
--     to the plan's balance (same month-window rule, adjustments still never
--     count)
--   * internal.tracked_balances_guard also refuses to archive a balance that
--     an active plan still points at
--
-- ---------------------------------------------------------------------------
-- Decisions taken here (documented for later CB tasks)
-- ---------------------------------------------------------------------------
--
-- 1. The column is NOT NULL, but a BEFORE INSERT trigger fills in the
--    household's Everyday balance when a row is inserted without one. That is
--    the same "omitted = Everyday" rule the function applies, held in the
--    database so any writer (the function, an owner-run repair, existing
--    fixtures) gets one consistent meaning. App roles have no write grant on
--    payment_plans at all, so this is not an app-facing path.
-- 2. tracked_balance_id + household_id is a composite FK to
--    tracked_balances_id_household_id_key, so a plan can never point at
--    another household's balance, whoever writes it.
-- 3. Archived balances. create_payment_plan refuses an archived balance
--    (check_violation), like record_payment and set_category_balance do. The
--    other direction: archiving a balance that an ACTIVE plan still points at
--    is refused by the guard trigger (a plan on an archived balance could
--    never be paid, since archived balances cannot receive allocations).
--    The Parent must deactivate or replace that plan first. Inactive
--    (superseded / deactivated) plans do not block archiving; they keep their
--    balance id as history.
-- 4. Authorization order in create_payment_plan is unchanged: caller must be
--    a Parent of the member's household before anything about the member or
--    the balance is revealed. A missing balance and another household's
--    balance are indistinguishable ("no such balance in this household").
-- 5. Superseding is per (member, balance): creating a Car plan leaves the
--    Everyday plan untouched and vice versa. The one audit row still carries
--    the old plan (old_values) and the new plan (new_values, which includes
--    tracked_balance_id).
-- 6. ensure_current_payment_period is unchanged: periods hang off their plan
--    and inherit its balance; nothing in period generation depends on it.
-- 7. payment_period_status stays SECURITY INVOKER. It now also reads
--    payment_allocations, whose SELECT policies (Parent: household; Child:
--    own member) match ledger_transactions', so a caller who can see a
--    payment can see its parts.

-- ---------------------------------------------------------------------------
-- payment_plans.tracked_balance_id
-- ---------------------------------------------------------------------------

alter table public.payment_plans
  add column if not exists tracked_balance_id uuid;

update public.payment_plans pl
   set tracked_balance_id = tb.id
  from public.tracked_balances tb
 where tb.household_id = pl.household_id
   and tb.is_everyday
   and pl.tracked_balance_id is null;

alter table public.payment_plans
  alter column tracked_balance_id set not null;

-- Composite FK: the balance must belong to the plan's own household.
alter table public.payment_plans
  add constraint payment_plans_tracked_balance_household_fk
    foreign key (tracked_balance_id, household_id)
    references public.tracked_balances (id, household_id);

comment on column public.payment_plans.tracked_balance_id is
  'The tracked balance this plan measures: only payment parts allocated to this balance count toward its periods. Everyday for a plan created without one. Must belong to the plan''s household.';

create index if not exists payment_plans_tracked_balance_id_idx
  on public.payment_plans (tracked_balance_id);

-- Fill Everyday when a row is inserted without a balance (decision 1).
create or replace function internal.payment_plans_default_balance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.tracked_balance_id is null then
    select tb.id into new.tracked_balance_id
      from public.tracked_balances tb
     where tb.household_id = new.household_id
       and tb.is_everyday;
  end if;
  return new;
end;
$$;

comment on function internal.payment_plans_default_balance() is
  'BEFORE INSERT trigger on payment_plans: an omitted tracked_balance_id means the household''s Everyday balance.';

revoke execute on function internal.payment_plans_default_balance() from public, anon, authenticated;

create or replace trigger payment_plans_default_balance
  before insert on public.payment_plans
  for each row
  execute function internal.payment_plans_default_balance();

-- ---------------------------------------------------------------------------
-- One active plan per (member, balance)
-- ---------------------------------------------------------------------------

drop index if exists public.payment_plans_member_id_active_key;

create unique index if not exists payment_plans_member_balance_active_key
  on public.payment_plans (member_id, tracked_balance_id)
  where active;

comment on table public.payment_plans is
  'A recurring minimum-payment obligation for one child on one tracked balance. At most one active plan per (member, balance) -- see payment_plans_member_balance_active_key.';
comment on column public.payment_plans.active is
  'Whether this is the member''s current plan for its balance. At most one active plan per (member, balance) -- see payment_plans_member_balance_active_key. Past plans are kept (marked inactive), never deleted or overwritten.';

-- ---------------------------------------------------------------------------
-- Guard: a balance with an active plan cannot be archived (decision 3)
-- ---------------------------------------------------------------------------
--
-- Same body as 20261003130000 plus the final check.

create or replace function internal.tracked_balances_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    -- Allow the row to go only when its household is itself being deleted
    -- (ON DELETE CASCADE runs after the households row is already gone).
    if old.is_everyday and exists (
      select 1 from public.households h where h.id = old.household_id
    ) then
      raise exception 'the Everyday balance cannot be deleted'
        using errcode = 'check_violation';
    end if;
    return old;
  end if;

  if new.is_everyday is distinct from old.is_everyday then
    raise exception 'is_everyday cannot be changed'
      using errcode = 'check_violation';
  end if;

  if new.household_id is distinct from old.household_id then
    raise exception 'a balance cannot move to another household'
      using errcode = 'check_violation';
  end if;

  if old.is_everyday and not new.active then
    raise exception 'the Everyday balance cannot be archived'
      using errcode = 'check_violation';
  end if;

  if old.active and not new.active and exists (
    select 1 from public.categories c
    where c.tracked_balance_id = old.id
  ) then
    raise exception 'balance "%" still has categories feeding it; move those categories to another balance first', old.name
      using errcode = 'check_violation';
  end if;

  if old.active and not new.active and exists (
    select 1 from public.payment_plans pl
    where pl.tracked_balance_id = old.id and pl.active
  ) then
    raise exception 'balance "%" still has an active payment plan; deactivate or replace that plan first', old.name
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function internal.tracked_balances_guard() is
  'BEFORE UPDATE/DELETE trigger on tracked_balances: Everyday cannot be archived, deleted (except by household cascade) or lose is_everyday; no row may change household; a balance that categories or an active payment plan still point at cannot be archived.';

-- ---------------------------------------------------------------------------
-- public.create_payment_plan: per-balance
-- ---------------------------------------------------------------------------

drop function if exists public.create_payment_plan(uuid, bigint, integer, date, date);

create or replace function public.create_payment_plan(
  p_member_id uuid,
  p_minimum_cents bigint,
  p_due_day integer,
  p_starts_on date,
  p_ends_on date default null,
  p_tracked_balance_id uuid default null
)
returns public.payment_plans
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household_id uuid;
  v_target_status text;
  v_target_role text;
  v_caller_member_id uuid;
  v_balance public.tracked_balances;
  v_old public.payment_plans;
  v_new public.payment_plans;
begin
  select hm.household_id, hm.status, hm.role
    into v_household_id, v_target_status, v_target_role
    from public.household_members hm
    where hm.id = p_member_id;

  -- Caller's role first (see 20260905050000): nothing about the member or the
  -- balance is revealed to a non-Parent. household_id comes from the member
  -- row, never from the client.
  if not internal.is_household_parent(v_household_id) then
    raise exception 'only an active Parent may create a payment plan'
      using errcode = '42501';
  end if;

  if v_target_status <> 'active' then
    raise exception 'household member % is not active', p_member_id
      using errcode = '42501';
  end if;

  if v_target_role <> 'child' then
    raise exception 'payment plans may only be created for a child member'
      using errcode = '42501';
  end if;

  -- Balance: null = Everyday; otherwise it must be an active balance of the
  -- member's own household (decisions 3 and 4).
  if p_tracked_balance_id is null then
    select * into v_balance
      from public.tracked_balances tb
      where tb.household_id = v_household_id and tb.is_everyday;
  else
    select * into v_balance
      from public.tracked_balances tb
      where tb.id = p_tracked_balance_id and tb.household_id = v_household_id;

    if v_balance.id is null then
      raise exception 'no such balance in this household: %', p_tracked_balance_id
        using errcode = 'check_violation';
    end if;

    if not v_balance.active then
      raise exception 'balance "%" is archived and cannot have a payment plan', v_balance.name
        using errcode = 'check_violation';
    end if;
  end if;

  v_caller_member_id := internal.current_household_member_id(v_household_id);

  -- Supersede this member's active plan ON THIS BALANCE only, atomically with
  -- the insert. Plans on other balances are untouched. The partial unique
  -- index payment_plans_member_balance_active_key is the backstop.
  update public.payment_plans
     set active = false,
         updated_at = now()
   where member_id = p_member_id
     and tracked_balance_id = v_balance.id
     and active
   returning * into v_old;

  insert into public.payment_plans (
    household_id, member_id, tracked_balance_id, minimum_cents, due_day,
    starts_on, ends_on, active, created_by
  ) values (
    v_household_id, p_member_id, v_balance.id, p_minimum_cents, p_due_day,
    p_starts_on, p_ends_on, true, v_caller_member_id
  )
  returning * into v_new;

  -- One combined audit row for supersede + create (see 20260905050000);
  -- new_values (to_jsonb of the row) includes tracked_balance_id.
  insert into public.audit_log (
    household_id, actor_user_id, entity_type, entity_id, action, old_values, new_values
  ) values (
    v_household_id, auth.uid(), 'payment_plans', v_new.id, 'create',
    case when v_old.id is null then null else to_jsonb(v_old) end,
    to_jsonb(v_new)
  );

  return v_new;
end;
$$;

comment on function public.create_payment_plan(uuid, bigint, integer, date, date, uuid) is
  'Create a payment plan for a child member on a tracked balance (p_tracked_balance_id NULL = Everyday), atomically deactivating only that member''s active plan on the SAME balance. Parent-only. household_id is derived from p_member_id; the balance must be an active one in that household. One audit_log row covers the supersede and the create.';

revoke execute on function public.create_payment_plan(uuid, bigint, integer, date, date, uuid) from public, anon;
grant execute on function public.create_payment_plan(uuid, bigint, integer, date, date, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- public.payment_period_status: count only the plan's balance's parts
-- ---------------------------------------------------------------------------
--
-- Identical to 20261003090000's definition except for the `paid` CTE, which
-- sums payment_allocations parts (non-voided payment, same member, part's
-- balance = the plan's balance) instead of whole payment amounts, and the
-- plan's tracked_balance_id carried through the period CTE. Month window,
-- status precedence, adjustments-never-count and the household-time-zone
-- "today" are unchanged. For an Everyday plan with no split payments, the
-- single Everyday part equals the payment, so results are identical to
-- before.

create or replace function public.payment_period_status(p_period_id uuid)
returns table (
  period_id uuid,
  status text,
  minimum_cents bigint,
  paid_cents bigint,
  remaining_cents bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with period as (
    select
      pp.id,
      pp.member_id,
      pp.period_start,
      pp.due_date,
      pp.minimum_cents,
      pp.waived_at,
      h.timezone,
      pl.starts_on,
      pl.tracked_balance_id,
      (
        (extract(year from pp.period_start) - extract(year from pl.starts_on)) * 12
        + (extract(month from pp.period_start) - extract(month from pl.starts_on))
      )::integer as months_from_start
    from public.payment_periods pp
    join public.payment_plans pl on pl.id = pp.payment_plan_id
    join public.households h on h.id = pp.household_id
    where pp.id = p_period_id
  ),
  bounds as (
    select
      p.*,
      case
        when (p.starts_on + make_interval(months => p.months_from_start))::date > p.period_start
          then (p.starts_on + make_interval(months => p.months_from_start))::date
        else (p.starts_on + make_interval(months => p.months_from_start + 1))::date
      end as next_period_start
    from period p
  ),
  paid as (
    -- The one canonical implementation of the section 7.3 allocation rule:
    -- the period's whole month, [period_start, next_period_start), counting
    -- only the parts of payments allocated to the plan's own balance.
    select
      coalesce(sum(pa.amount_cents), 0)::bigint as paid_cents
    from bounds b
    join public.ledger_transactions lt
      on lt.member_id = b.member_id
     and lt.type = 'payment'
     and lt.voided_at is null
     and lt.occurred_on >= b.period_start
     and lt.occurred_on < b.next_period_start
    join public.payment_allocations pa
      on pa.transaction_id = lt.id
     and pa.tracked_balance_id = b.tracked_balance_id
  ),
  today as (
    select (now() at time zone b.timezone)::date as today
    from bounds b
  )
  select
    b.id as period_id,
    case
      when b.waived_at is not null then 'waived'
      when pd.paid_cents >= b.minimum_cents then 'satisfied'
      when t.today > b.due_date then 'overdue'
      when pd.paid_cents > 0 then 'partially_paid'
      when t.today >= b.period_start then 'due'
      else 'upcoming'
    end as status,
    b.minimum_cents,
    pd.paid_cents,
    (b.minimum_cents - pd.paid_cents) as remaining_cents
  from bounds b
  cross join paid pd
  cross join today t;
$$;

comment on function public.payment_period_status(uuid) is
  'Derive one of upcoming/due/partially_paid/satisfied/overdue/waived for a payment_periods row, plus paid_cents/remaining_cents. The single canonical implementation of the section 7.3 payment-allocation rule and status precedence. Allocation: the payment parts allocated to the plan''s tracked balance (non-voided payment by the period''s member, payment_allocations.tracked_balance_id = payment_plans.tracked_balance_id) whose payment falls in the period''s month -- occurred_on >= period_start and occurred_on < next_period_start. Adjustments never count. See migrations 20260905060000, 20261003090000 and 20261003160000. SECURITY INVOKER: payment_periods/payment_plans/households/ledger_transactions/payment_allocations RLS SELECT policies apply, returning zero rows for a period the caller cannot see.';

revoke execute on function public.payment_period_status(uuid) from public, anon;
grant execute on function public.payment_period_status(uuid) to authenticated;
