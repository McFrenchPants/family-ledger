-- Family Ledger: P2.4 payment period status derivation.
--
-- Adds a single read-side function, public.payment_period_status(p_period_id),
-- that is the ONE canonical place §7.3's payment-allocation rule and status
-- precedence are implemented. Nothing else in this project should reimplement
-- either -- a second copy of this logic (e.g. duplicated in a UI query) is a
-- correctness bug waiting to diverge from this one.
--
-- Return shape: a one-row TABLE (status, minimum_cents, paid_cents,
-- remaining_cents), not a bare `returns text`. The consuming UI needs "how
-- much has been paid / how much remains" alongside the status label (e.g. a
-- progress bar under a `partially_paid` chip), and that amount is already
-- computed internally to derive the status -- returning it avoids a second,
-- separate query (and a second, separate re-implementation of the allocation
-- rule) from the UI layer. A period_id column is included so a caller doing
-- `select * from public.payment_period_status(x)` gets a self-describing row;
-- if RLS hides the period, this returns zero rows (see Authorization below),
-- so period_id is never NULL in a row that IS returned.
--
-- Authorization: deliberately NOT security definer. This function's body
-- performs ordinary SELECTs against public.payment_periods, public.households,
-- and public.ledger_transactions as the calling role, so the existing P2.2
-- SELECT policies on payment_periods (and the households_select_member policy
-- from 20260905020000) apply exactly as they would to a hand-written query --
-- a caller who cannot see a period via RLS gets zero rows back from this
-- function, not a privileged bypass. This is different from the P2.3 write
-- functions, which needed SECURITY DEFINER because a write has to check the
-- CALLER's role against a target row's household before revealing anything
-- about that target -- a check RLS's row-level USING clause cannot express on
-- its own. There is no analogous need here: this function reveals nothing
-- about a period beyond what the caller's own SELECT policy already allows,
-- so running it as the caller (SECURITY INVOKER, the default) is both
-- sufficient and strictly safer than SECURITY DEFINER.
--
-- The allocation rule (§7.3, implemented exactly once, here): a
-- ledger_transactions row counts toward a period if and only if
-- type = 'payment' (never 'expense' or 'adjustment' -- an adjustment is a
-- balance correction, not a payment against a plan, and including it here
-- would let a Parent's unrelated goodwill credit silently satisfy a payment
-- plan), voided_at is null, the same member_id as the period, and
-- occurred_on > period_start and occurred_on <= due_date (strictly after the
-- period's start so a payment cannot double up into two adjacent periods,
-- and up to and including the due date so a payment made ON the due date
-- still counts). amount_cents is stored negative for a payment
-- (ledger_transactions_amount_sign_check, 20260904223000), so the sum is
-- negated to get a positive paid_cents.
--
-- Status precedence (six mutually exclusive outcomes, resolved as a priority
-- list -- not independent flags, since e.g. a fully-paid-but-waived period
-- must read 'waived', not 'satisfied'):
--   1. waived         -- waived_at is not null. Always wins, regardless of
--                        the payment math: a Parent's decision to waive a
--                        period overrides whatever was or wasn't paid.
--   2. satisfied       -- paid_cents >= minimum_cents. Checked before the
--                        due-date comparison so paying in full, whether
--                        before or after due_date, always reads 'satisfied'
--                        rather than 'overdue'.
--   3. overdue         -- today > due_date (strictly after -- see the
--                        boundary note below) and paid_cents < minimum_cents.
--   4. partially_paid  -- 0 < paid_cents < minimum_cents and not overdue.
--   5. due             -- paid_cents = 0, today >= period_start, and not
--                        overdue.
--   6. upcoming        -- today < period_start (falls through once none of
--                        the above match).
--
-- Boundary decision (not resolved explicitly by the spec text): a period
-- with $0 paid on its exact due_date (today = due_date) reads 'due', not
-- 'overdue'. 'overdue' requires today > due_date (strictly past), so the due
-- date itself is still the last day to pay on time -- consistent with this
-- project's existing "occurred_on > period_start and occurred_on <= due_date"
-- allocation window, which likewise treats due_date as still "in bounds".
--
-- Time zone: "today" is resolved via `(now() at time zone h.timezone)::date`
-- against the period's own household's households.timezone -- never
-- current_date/now()::date, which resolve in the database server's implicit
-- zone. Same rule ensure_current_payment_period (20260905050000) already
-- follows, and the same standing project rule that function's header cites.

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
    -- RLS-respecting lookups: this CTE runs as the calling role (no
    -- SECURITY DEFINER on this function), so payment_periods_select_parent /
    -- payment_periods_select_self (20260905040000) and
    -- households_select_member (20260905020000) both apply here exactly as
    -- they would to a hand-written query. An unauthorized p_period_id
    -- produces zero rows here, and therefore zero rows from the whole
    -- function -- no other branch below can produce output without a row
    -- from this CTE.
    select
      pp.id,
      pp.member_id,
      pp.period_start,
      pp.due_date,
      pp.minimum_cents,
      pp.waived_at,
      h.timezone
    from public.payment_periods pp
    join public.households h on h.id = pp.household_id
    where pp.id = p_period_id
  ),
  paid as (
    -- The one canonical implementation of the §7.3 allocation rule -- see
    -- this file's header comment for the full rationale of each condition.
    select
      coalesce(sum(-lt.amount_cents), 0)::bigint as paid_cents
    from period p
    join public.ledger_transactions lt
      on lt.member_id = p.member_id
     and lt.type = 'payment'
     and lt.voided_at is null
     and lt.occurred_on > p.period_start
     and lt.occurred_on <= p.due_date
  ),
  today as (
    select (now() at time zone p.timezone)::date as today
    from period p
  )
  select
    p.id as period_id,
    case
      when p.waived_at is not null then 'waived'
      when pd.paid_cents >= p.minimum_cents then 'satisfied'
      when t.today > p.due_date then 'overdue'
      when pd.paid_cents > 0 then 'partially_paid'
      when t.today >= p.period_start then 'due'
      else 'upcoming'
    end as status,
    p.minimum_cents,
    pd.paid_cents,
    (p.minimum_cents - pd.paid_cents) as remaining_cents
  from period p
  cross join paid pd
  cross join today t;
$$;

comment on function public.payment_period_status(uuid) is
  'Derive one of upcoming/due/partially_paid/satisfied/overdue/waived for a payment_periods row, plus paid_cents/remaining_cents. The single canonical implementation of the section 7.3 payment-allocation rule and status precedence -- see this migration''s header comment for both in full. SECURITY INVOKER (not DEFINER): runs as the caller so the existing payment_periods/households RLS SELECT policies apply, returning zero rows for a period the caller is not authorized to see rather than disclosing it.';

-- Same explicit revoke/grant pattern as this project's other functions
-- (documented in 20260905050000''s header): Supabase''s ALTER DEFAULT
-- PRIVILEGES grants EXECUTE to anon (and to PUBLIC) on every new function
-- regardless of SECURITY DEFINER/INVOKER, so both must be revoked explicitly
-- and re-granted to authenticated only.
revoke execute on function public.payment_period_status(uuid) from public, anon;
grant execute on function public.payment_period_status(uuid) to authenticated;
