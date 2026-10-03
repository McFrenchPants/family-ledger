-- Family Ledger: PF1 -- a payment period's due date never falls before the
-- period starts.
--
-- Replaces the body of public.ensure_current_payment_period(p_plan_id) (first
-- defined in 20260905050000_payment_plans_write_functions.sql -- read that
-- header for the full design: why any active household member may call it,
-- the household-time-zone "today", the starts_on-anchored period loop, the
-- unique_violation race handling, and why it writes no audit_log row).
-- Everything in that design is unchanged here EXCEPT how due_date is chosen.
--
-- Old rule (20260905050000): due_date = due_day within the calendar month of
-- period_start:
--   make_date(year(period_start), month(period_start), due_day)
-- Correct only when the plan's start day-of-month is <= due_day. When the
-- plan starts later in the month than its due day, EVERY period was due
-- before it started. E.g. a plan created Oct 3 with due_day 1: first period
-- starts Oct 3, due Oct 1, and payment_period_status (20261003090000)
-- reported it 'overdue' the moment it was created -- the child was "late"
-- on a period that had not existed yet. Every later period (Nov 3 / due
-- Nov 1, ...) had the same defect.
--
-- New rule: due_date = the first date ON OR AFTER period_start whose
-- day-of-month is due_day:
--   * same month as period_start   when due_day >= day(period_start);
--   * the following calendar month when due_day <  day(period_start).
-- due_day is constrained 1-28 (payment_plans_due_day_range_check), so either
-- candidate is always a valid date.
--
-- Upper bound: a due date must also fall strictly BEFORE the next period
-- starts, or the period would be due inside its successor's window.
-- next_period_start is defined exactly as payment_period_status defines it
-- (20261003090000 header): the smallest plan.starts_on + k months strictly
-- after period_start, anchored to starts_on and never compounded. The
-- next-month candidate can collide with it only at a month-end clamp: plan
-- starts_on Jan 31, due_day 28 -> the Feb period starts Feb 28; candidate
-- for the Jan 31 period is Feb 28, but Feb 28 IS the next period's start.
-- In that case due_date clamps to next_period_start - 1 day (Feb 27). So
-- always: period_start <= due_date < next_period_start, i.e. the due date
-- lies inside the period's own allocation window.
--
-- Unchanged plans: whenever day(starts_on) <= due_day, every generated
-- period_start has day-of-month = min(day(starts_on), last day of its
-- month) <= day(starts_on) <= due_day, so the same-month candidate is
-- chosen and is
-- identical to the old rule's result. The clamp can never fire on it either,
-- since the next period starts in a later calendar month.
--
-- Where the rule lives. The calculation is a pure function of
-- (plan.starts_on, period_start, plan.due_day), so it is factored into
-- internal.payment_period_due_date below and used by BOTH
-- ensure_current_payment_period and this migration's one-off repair of
-- already-stored rows -- one implementation, so the two cannot disagree.
-- Like internal.insert_ledger_row_and_audit (20260904233000), it is not
-- callable by any application role (revoked from public, anon,
-- authenticated): only the SECURITY DEFINER function, running as its owner,
-- and migrations use it. It is not SECURITY DEFINER itself -- it reads no
-- tables, so it needs no privileges.
--
-- Repair of stored rows. payment_periods rows already materialized under the
-- old rule with due_date < period_start are recomputed from their plan by
-- the new rule. Only those rows are touched: any row with due_date >=
-- period_start was produced by the same-month branch, which the new rule
-- leaves unchanged. No audit_log row is written for the repair, for the
-- same reason ensure_current_payment_period writes none: due_date is a
-- deterministic derivation from the already-audited plan terms, not a new
-- decision by anyone. payment_periods carries no updated_at column, so
-- nothing else changes on those rows.

-- ---------------------------------------------------------------------------
-- internal.payment_period_due_date: the single due-date rule
-- ---------------------------------------------------------------------------

create or replace function internal.payment_period_due_date(
  p_starts_on date,
  p_period_start date,
  p_due_day integer
)
returns date
language sql
immutable
strict
set search_path = ''
as $$
  with candidate as (
    select
      -- First date with day-of-month p_due_day on or after p_period_start.
      case
        when p_due_day >= extract(day from p_period_start)::int
          then make_date(
                 extract(year from p_period_start)::int,
                 extract(month from p_period_start)::int,
                 p_due_day)
        else (make_date(
                extract(year from p_period_start)::int,
                extract(month from p_period_start)::int,
                p_due_day) + interval '1 month')::date
      end as due_date,
      -- Whole calendar months from starts_on's month to period_start's
      -- month; same computation as payment_period_status (20261003090000).
      (
        (extract(year from p_period_start) - extract(year from p_starts_on)) * 12
        + (extract(month from p_period_start) - extract(month from p_starts_on))
      )::integer as months_from_start
  ),
  bounds as (
    -- next_period_start: smallest starts_on + k months strictly after
    -- period_start, anchored to starts_on (never compounded).
    select
      c.due_date,
      case
        when (p_starts_on + make_interval(months => c.months_from_start))::date > p_period_start
          then (p_starts_on + make_interval(months => c.months_from_start))::date
        else (p_starts_on + make_interval(months => c.months_from_start + 1))::date
      end as next_period_start
    from candidate c
  )
  select least(b.due_date, b.next_period_start - 1)
  from bounds b;
$$;

comment on function internal.payment_period_due_date(date, date, integer) is
  'The single payment-period due-date rule: the first date on or after p_period_start whose day-of-month is p_due_day (same month, else the following month), clamped to the day before the next period start (smallest p_starts_on + k months after p_period_start). Always period_start <= result < next_period_start. Used by public.ensure_current_payment_period and the 20261003120000 repair. Not callable by application roles.';

revoke execute on function internal.payment_period_due_date(date, date, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- public.ensure_current_payment_period: due_date now via the helper above
-- ---------------------------------------------------------------------------
--
-- Identical to 20260905050000's definition apart from the due_date
-- assignment. See that file's header for the authorization rationale (any
-- active member of the plan's household, not Parent-only).

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
  -- 20260905050000's header comment for why this is not Parent-restricted.
  if not internal.is_household_member(v_plan.household_id) then
    raise exception 'caller is not an active member of this plan''s household'
      using errcode = '42501';
  end if;

  if not v_plan.active then
    raise exception 'payment plan % is not active', p_plan_id
      using errcode = 'check_violation';
  end if;

  -- "Today" MUST be resolved in the household's configured IANA time zone,
  -- never the database server's implicit zone.
  select h.timezone into v_timezone
    from public.households h
    where h.id = v_plan.household_id;

  v_today := (now() at time zone v_timezone)::date;

  -- Latest period_start (= starts_on + N months, always anchored to the
  -- ORIGINAL starts_on, never compounded -- see 20260905050000) that is
  -- still <= today; or the first period if the plan has not started yet.
  v_months_elapsed := 0;
  while (v_plan.starts_on + ((v_months_elapsed + 1) || ' months')::interval)::date <= v_today loop
    v_months_elapsed := v_months_elapsed + 1;
  end loop;
  v_period_start := (v_plan.starts_on + (v_months_elapsed || ' months')::interval)::date;

  -- The ONLY change from 20260905050000: due_date is the first due_day on
  -- or after period_start, kept before the next period start (see this
  -- file's header). Previously make_date(year, month of period_start,
  -- due_day), which fell before period_start whenever the plan's start
  -- day-of-month was later than due_day.
  v_due_date := internal.payment_period_due_date(
    v_plan.starts_on, v_period_start, v_plan.due_day
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
      -- payment_periods_plan_id_period_start_key caught a concurrent caller
      -- who won the race. Re-select rather than erroring, so no caller of
      -- this idempotent function ever sees a failure.
      select * into v_period
        from public.payment_periods
        where payment_plan_id = v_plan.id
          and period_start = v_period_start;
  end;

  -- No audit_log row: a deterministic materialization of the already-
  -- audited plan terms plus today's date, not a new decision by this caller.
  return v_period;
end;
$$;

comment on function public.ensure_current_payment_period(uuid) is
  'Idempotently materialize (or return the existing) payment_periods row covering "today" in the plan''s household time zone. due_date is the first due_day on or after period_start, kept before the next period start (internal.payment_period_due_date, 20261003120000). Callable by any active member (Parent or Child) of the plan''s household -- not Parent-only, see 20260905050000''s header comment for why. No audit_log row: nothing here is a new decision, only a deterministic derivation from an already-authorized plan.';

revoke execute on function public.ensure_current_payment_period(uuid) from public, anon;
grant execute on function public.ensure_current_payment_period(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Repair: rows stored under the old rule with due_date before period_start
-- ---------------------------------------------------------------------------

update public.payment_periods pp
   set due_date = internal.payment_period_due_date(pl.starts_on, pp.period_start, pl.due_day)
  from public.payment_plans pl
 where pl.id = pp.payment_plan_id
   and pp.due_date < pp.period_start;
