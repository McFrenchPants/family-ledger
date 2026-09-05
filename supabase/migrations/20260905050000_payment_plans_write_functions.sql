-- Family Ledger: P2.3 security-definer RPC functions for payment plan writes.
--
-- P2.2 (20260905040000_payment_plans_rls_policies.sql) deliberately left
-- payment_plans and payment_periods with SELECT-only RLS: creating/superseding
-- a plan, materializing a period, and waiving a period all require checking
-- role/household/plan-state together, which is more than a RLS USING/WITH
-- CHECK clause should try to encode -- security-definer RPC functions are the
-- right shape, matching 20260904233000_ledger_write_functions.sql's approach
-- for ledger_transactions.
--
-- Four public, SECURITY DEFINER functions are added here:
--   * public.create_payment_plan       -- Parent-only
--   * public.deactivate_payment_plan   -- Parent-only
--   * public.ensure_current_payment_period -- any active household member
--   * public.waive_payment_period      -- Parent-only
--
-- Every function re-derives household_id from a looked-up row (never a
-- client-supplied household_id), checks the CALLER's own role via the
-- internal.* helpers from 20260904230000_ledger_rls_policies.sql, uses
-- `set search_path = ''` with fully-qualified names, and applies the
-- two-layer revoke/grant pattern documented in 20260904233000's header
-- (Supabase's ALTER DEFAULT PRIVILEGES grants EXECUTE to anon independently
-- of the PUBLIC pseudo-role, so `revoke ... from public` alone is not
-- sufficient -- P1.3's verifier caught exactly this gap once already).

-- ---------------------------------------------------------------------------
-- public.create_payment_plan: Parent-only, atomically supersedes prior plan
-- ---------------------------------------------------------------------------

create or replace function public.create_payment_plan(
  p_member_id uuid,
  p_minimum_cents bigint,
  p_due_day integer,
  p_starts_on date,
  p_ends_on date default null
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
  v_old public.payment_plans;
  v_new public.payment_plans;
begin
  select hm.household_id, hm.status, hm.role
    into v_household_id, v_target_status, v_target_role
    from public.household_members hm
    where hm.id = p_member_id;

  -- Check the CALLER's own role before revealing anything about whether
  -- p_member_id exists, its status, or its role -- same non-disclosure
  -- reasoning as record_expense/record_balance_decrease in
  -- 20260904233000_ledger_write_functions.sql. household_id is derived from
  -- the looked-up row, never accepted as a client-supplied parameter, which
  -- closes off a mismatched-pair attack (a member_id from household A
  -- alongside a household the caller belongs to in household B).
  if not internal.is_household_parent(v_household_id) then
    raise exception 'only an active Parent may create a payment plan'
      using errcode = '42501';
  end if;

  -- Only reachable once the caller is confirmed an active Parent of
  -- v_household_id, so the target's status/role are no longer privileged
  -- from here on -- the caller can already see this member's data via RLS.
  if v_target_status <> 'active' then
    raise exception 'household member % is not active', p_member_id
      using errcode = '42501';
  end if;

  if v_target_role <> 'child' then
    raise exception 'payment plans may only be created for a child member'
      using errcode = '42501';
  end if;

  v_caller_member_id := internal.current_household_member_id(v_household_id);

  -- Supersede any existing active plan for this member atomically with the
  -- insert of the new one, inside this function's single implicit
  -- transaction, so no concurrent reader can ever observe zero or two active
  -- plans for this member. The partial unique index
  -- payment_plans_member_id_active_key (P2.1) is the backstop if this
  -- ever raced anyway.
  update public.payment_plans
     set active = false,
         updated_at = now()
   where member_id = p_member_id
     and active
   returning * into v_old;

  insert into public.payment_plans (
    household_id, member_id, minimum_cents, due_day, starts_on, ends_on,
    active, created_by
  ) values (
    v_household_id, p_member_id, p_minimum_cents, p_due_day, p_starts_on,
    p_ends_on, true, v_caller_member_id
  )
  returning * into v_new;

  -- One combined audit_log entry rather than two. The deactivation (if any)
  -- and the creation are a single logical decision made by one Parent action
  -- ("replace this child's plan"), not two independent events -- an old_values
  -- of the prior active plan (or NULL if none existed) alongside new_values of
  -- the plan just created tells a reviewer everything a second, separate
  -- "deactivate" audit row would, without implying two unrelated actions took
  -- place.
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

comment on function public.create_payment_plan(uuid, bigint, integer, date, date) is
  'Create a payment plan for a child member, atomically deactivating any prior active plan for that member. Parent-only. household_id is derived from p_member_id, never accepted from the client. One audit_log row covers both the supersede and the create.';

revoke execute on function public.create_payment_plan(uuid, bigint, integer, date, date) from public, anon;
grant execute on function public.create_payment_plan(uuid, bigint, integer, date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- public.deactivate_payment_plan: Parent-only, scoped to the plan's household
-- ---------------------------------------------------------------------------

create or replace function public.deactivate_payment_plan(p_plan_id uuid)
returns public.payment_plans
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.payment_plans;
  v_new public.payment_plans;
  v_caller_member_id uuid;
begin
  select * into v_old
    from public.payment_plans
    where id = p_plan_id;

  if v_old.id is null then
    raise exception 'no such payment plan: %', p_plan_id
      using errcode = 'no_data_found';
  end if;

  -- household_id and the caller's role are both derived from the looked-up
  -- row -- p_plan_id is the only client-supplied identifier, and it names a
  -- row, not a household or a role. Mirrors void_ledger_transaction's shape.
  if not internal.is_household_parent(v_old.household_id) then
    raise exception 'only an active Parent of this plan''s household may deactivate it'
      using errcode = '42501';
  end if;

  if not v_old.active then
    raise exception 'payment plan % is already inactive', p_plan_id
      using errcode = 'check_violation';
  end if;

  v_caller_member_id := internal.current_household_member_id(v_old.household_id);

  update public.payment_plans
     set active = false,
         updated_at = now()
   where id = p_plan_id
   returning * into v_new;

  insert into public.audit_log (
    household_id, actor_user_id, entity_type, entity_id, action, old_values, new_values
  ) values (
    v_old.household_id, auth.uid(), 'payment_plans', v_old.id, 'deactivate',
    to_jsonb(v_old), to_jsonb(v_new)
  );

  return v_new;
end;
$$;

comment on function public.deactivate_payment_plan(uuid) is
  'Deactivate a payment plan (active -> false). Parent-only, scoped to the plan''s own household (derived from the row, not client input). Rejects an already-inactive plan.';

revoke execute on function public.deactivate_payment_plan(uuid) from public, anon;
grant execute on function public.deactivate_payment_plan(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- public.ensure_current_payment_period: any active household member
-- ---------------------------------------------------------------------------
--
-- Deliberately NOT Parent-only, unlike every other write function in this
-- project so far. The distinction that matters for authorization is not
-- "does this write change data" but "whose decision does this write
-- encode". record_expense/record_payment/record_adjustment/void_* and both
-- other functions in this file all let the caller supply a *new* fact
-- (an amount, a reason, a plan's terms) that did not exist before and that
-- a Child must not be able to fabricate or alter. This function supplies no
-- new fact at all: period_start, due_date, and minimum_cents are all fully
-- determined by the already-authorized payment_plans row (created only by a
-- Parent, per create_payment_plan above) plus the current date -- the caller
-- picks none of it. Calling this function twice, from any caller, in any
-- order, produces the same row. It is closer to a cached materialized read
-- than a decision, so both Parent and Child members of the plan's household
-- may call it (e.g. a Child's dashboard needs the current period to exist to
-- show what they owe, without needing a Parent to have visited first).

create or replace function public.ensure_current_payment_period(p_plan_id uuid)
returns public.payment_periods
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.payment_plans;
  v_timezone text;
  v_today date;
  v_months_elapsed integer;
  v_period_start date;
  v_due_date date;
  v_period public.payment_periods;
begin
  select * into v_plan
    from public.payment_plans
    where id = p_plan_id;

  if v_plan.id is null then
    raise exception 'no such payment plan: %', p_plan_id
      using errcode = 'no_data_found';
  end if;

  -- Any active member (Parent or Child) of the plan's own household -- see
  -- the header comment above for why this is not Parent-restricted.
  if not internal.is_household_member(v_plan.household_id) then
    raise exception 'caller is not an active member of this plan''s household'
      using errcode = '42501';
  end if;

  if not v_plan.active then
    raise exception 'payment plan % is not active', p_plan_id
      using errcode = 'check_violation';
  end if;

  -- "Today" MUST be resolved in the household's configured IANA time zone,
  -- never the database server's implicit zone -- current_date/now()::date
  -- without an explicit `at time zone` would violate this project's standing
  -- rule on due/overdue/today determination.
  select h.timezone into v_timezone
    from public.households h
    where h.id = v_plan.household_id;

  v_today := (now() at time zone v_timezone)::date;

  -- Generate periods forward from starts_on at monthly intervals (this
  -- plan's only supported frequency -- see payment_plans_frequency_check in
  -- P2.1) until we reach the one covering today: the latest period_start
  -- that is still <= today. If starts_on itself is in the future relative to
  -- today, the plan has not started yet and its first period is returned
  -- as-is (there is no "current" period before a plan starts).
  --
  -- Each candidate is anchored back to the ORIGINAL starts_on (starts_on + N
  -- months), never computed by repeatedly adding one month to the previous
  -- iteration's result. Compounding would drift for any starts_on on the
  -- 29th/30th/31st: Postgres clamps 'YYYY-01-31' + interval '1 month' to
  -- Feb 28/29, and adding another month to that already-shortened date never
  -- recovers the original day-of-month even in a later 31-day month --
  -- verifier-caught (P2.3 first pass), reproduced with starts_on = 2025-01-31
  -- silently drifting to period_start = 2026-08-28 instead of 2026-08-31
  -- after ~20 compounding iterations. Anchoring to starts_on for every
  -- candidate makes each one independent of how many iterations came before.
  v_months_elapsed := 0;
  while (v_plan.starts_on + ((v_months_elapsed + 1) || ' months')::interval)::date <= v_today loop
    v_months_elapsed := v_months_elapsed + 1;
  end loop;
  v_period_start := (v_plan.starts_on + (v_months_elapsed || ' months')::interval)::date;

  -- due_date is due_day within the calendar month of period_start. due_day
  -- is constrained to 1-28 (payment_plans_due_day_range_check, P2.1)
  -- specifically so this is always a valid date regardless of which month
  -- period_start falls in.
  v_due_date := make_date(
    extract(year from v_period_start)::int,
    extract(month from v_period_start)::int,
    v_plan.due_day
  );

  begin
    insert into public.payment_periods (
      payment_plan_id, household_id, member_id, period_start, due_date,
      minimum_cents
    ) values (
      v_plan.id, v_plan.household_id, v_plan.member_id, v_period_start,
      v_due_date, v_plan.minimum_cents
    )
    returning * into v_period;
  exception
    when unique_violation then
      -- payment_periods_plan_id_period_start_key (P2.1) caught a concurrent
      -- caller who won the race. Re-select rather than erroring, so no
      -- caller of this idempotent function ever sees a failure.
      select * into v_period
        from public.payment_periods
        where payment_plan_id = v_plan.id
          and period_start = v_period_start;
  end;

  -- No audit_log row: this is a read-adjacent materialization of a fact
  -- that create_payment_plan already authorized and recorded (the plan's
  -- terms), not a new decision by this caller. Every value written here is
  -- a deterministic function of the plan + today's date, so there is
  -- nothing here for an audit trail to attribute to this caller that isn't
  -- already attributable to the Parent who created/last edited the plan.
  return v_period;
end;
$$;

comment on function public.ensure_current_payment_period(uuid) is
  'Idempotently materialize (or return the existing) payment_periods row covering "today" in the plan''s household time zone. Callable by any active member (Parent or Child) of the plan''s household -- not Parent-only, see this function''s header comment for why. No audit_log row: nothing here is a new decision, only a deterministic derivation from an already-authorized plan.';

revoke execute on function public.ensure_current_payment_period(uuid) from public, anon;
grant execute on function public.ensure_current_payment_period(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- public.waive_payment_period: Parent-only, scoped to the period's household
-- ---------------------------------------------------------------------------

create or replace function public.waive_payment_period(
  p_period_id uuid,
  p_reason text
)
returns public.payment_periods
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.payment_periods;
  v_new public.payment_periods;
  v_caller_member_id uuid;
begin
  if p_reason is null or length(trim(both from p_reason)) = 0 then
    raise exception 'waive_reason is required'
      using errcode = 'check_violation';
  end if;

  select * into v_old
    from public.payment_periods
    where id = p_period_id;

  if v_old.id is null then
    raise exception 'no such payment period: %', p_period_id
      using errcode = 'no_data_found';
  end if;

  -- household_id and the caller's role are both derived from the looked-up
  -- row -- p_period_id is the only client-supplied identifier. Mirrors
  -- void_ledger_transaction / deactivate_payment_plan's shape.
  if not internal.is_household_parent(v_old.household_id) then
    raise exception 'only an active Parent of this period''s household may waive it'
      using errcode = '42501';
  end if;

  if v_old.waived_at is not null then
    raise exception 'payment period % is already waived', p_period_id
      using errcode = 'check_violation';
  end if;

  v_caller_member_id := internal.current_household_member_id(v_old.household_id);

  update public.payment_periods
     set waived_at = now(),
         waived_by = v_caller_member_id,
         waive_reason = p_reason
   where id = p_period_id
   returning * into v_new;

  insert into public.audit_log (
    household_id, actor_user_id, entity_type, entity_id, action, old_values, new_values
  ) values (
    v_old.household_id, auth.uid(), 'payment_periods', v_old.id, 'waive',
    to_jsonb(v_old), to_jsonb(v_new)
  );

  return v_new;
end;
$$;

comment on function public.waive_payment_period(uuid, text) is
  'Waive a payment period: sets waived_at/waived_by/waive_reason atomically. Parent-only, scoped to the period''s own household (derived from the row, not client input). Requires a non-empty, non-whitespace-only reason. Rejects an already-waived period.';

revoke execute on function public.waive_payment_period(uuid, text) from public, anon;
grant execute on function public.waive_payment_period(uuid, text) to authenticated;
