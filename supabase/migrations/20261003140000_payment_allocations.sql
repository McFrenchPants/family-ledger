-- Family Ledger: CB2 -- payment allocations.
--
-- Backlog 16 (category balances), design: docs/proposals/category-balances/
-- DESIGN_SPEC.md, plan task CB2.
--
-- A payment or a balance-decreasing adjustment is split into ALLOCATION
-- PARTS across the child's tracked balances (CB1's public.tracked_balances).
-- Totals never change -- public.household_member_balances is untouched --
-- only the per-balance breakdown does.
--
-- Contents:
--   * public.payment_allocations (+ same-household / same-member / type-
--     restricting composite FKs, + immutability guard, + deferred
--     "parts sum to the amount" constraint triggers, + backfill)
--   * RLS / grants: read-only for app roles, Parent sees the household,
--     Child sees own
--   * public.record_payment / public.record_adjustment replaced with a new
--     trailing p_allocations jsonb DEFAULT NULL parameter; the shared
--     internal.record_balance_decrease helper replaced to match
--   * public.household_member_balance_breakdown: payments/adjustments now
--     follow their parts
--
-- ---------------------------------------------------------------------------
-- Decisions taken here (documented for later CB tasks)
-- ---------------------------------------------------------------------------
--
-- 1. "A part belongs to a payment/adjustment of the same member in the same
--    household" is declarative: ledger_transactions gains a unique key on
--    (id, household_id, member_id, type), and each part carries the
--    transaction's household_id, member_id and type (transaction_type,
--    CHECKed to payment/adjustment) under a composite FK to it. A part can
--    therefore never hang off an expense, another member's row, or another
--    household's row. The balance FK (tracked_balance_id, household_id) ->
--    tracked_balances_id_household_id_key pins the balance to that same
--    household.
-- 2. "Parts sum to -amount_cents" is a DEFERRABLE INITIALLY DEFERRED
--    constraint trigger, fired both by parts inserts and by a payment/
--    adjustment row being inserted (or its amount/type changed), so a
--    payment committed with zero parts fails at COMMIT too. Within a single
--    transaction it is legitimately unbalanced between the two inserts.
--    Tests force the check early with SET CONSTRAINTS ... IMMEDIATE.
-- 3. Parts are immutable. App roles have no INSERT/UPDATE/DELETE grant at all
--    (primary) and no write policy (secondary). The guard trigger also
--    rejects UPDATE and DELETE for every role INCLUDING the owner/postgres;
--    the only deletes it lets through are cascades from deleting the
--    transaction or the whole household. An owner who genuinely needs to
--    repair a part must disable the trigger explicitly (deliberate, visible).
--    TRUNCATE is not covered (owner-only operation; no app role holds it).
--    Parts follow their transaction's voided_at: voiding needs no change to
--    parts, and a voided transaction's parts count for nothing.
-- 4. p_allocations NULL (or omitted) means one part, the whole amount, on
--    the household's Everyday balance -- so the front end's existing named-
--    parameter call keeps working unchanged. Every allocation validation
--    failure is check_violation (23514) with a specific message, including
--    "no such balance in this household" (a foreign balance and a missing
--    one are indistinguishable). Authorization (Parent-only, 42501) is
--    checked before any allocation is even parsed, so a non-Parent learns
--    nothing about balances.
-- 5. The audit row's new_values is the inserted ledger row plus an
--    "allocations" array ([{tracked_balance_id, amount_cents}, ...] in the
--    caller's order). internal.insert_ledger_row_and_audit is left unchanged
--    for record_expense; the balance-decrease path now does its own insert +
--    parts + audit so the audit can carry the parts.
-- 6. The breakdown attributes each non-voided payment/adjustment through its
--    parts, plus a residual (amount + SUM(parts)) on Everyday. Committed data
--    always has residual 0 (decision 2); the residual exists so that
--    SUM(breakdown) = household_member_balances holds by construction even
--    mid-transaction or for rows written before their parts.

-- ---------------------------------------------------------------------------
-- ledger_transactions: unique key the parts FK references
-- ---------------------------------------------------------------------------

alter table public.ledger_transactions
  add constraint ledger_transactions_id_household_member_type_key
    unique (id, household_id, member_id, type);

-- ---------------------------------------------------------------------------
-- public.payment_allocations
-- ---------------------------------------------------------------------------

create table if not exists public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null
    references public.households (id) on delete cascade,
  member_id uuid not null
    references public.household_members (id),
  transaction_id uuid not null,
  transaction_type text not null,
  tracked_balance_id uuid not null,
  amount_cents bigint not null,
  created_at timestamptz not null default now(),

  constraint payment_allocations_amount_positive_check
    check (amount_cents > 0),

  constraint payment_allocations_transaction_type_check
    check (transaction_type in ('payment', 'adjustment')),

  -- Same transaction, same household, same member, and (with the CHECK
  -- above) never an expense. Cascade: a part is a component of its
  -- transaction and cannot outlive it.
  constraint payment_allocations_transaction_fk
    foreign key (transaction_id, household_id, member_id, transaction_type)
    references public.ledger_transactions (id, household_id, member_id, type)
    on delete cascade,

  -- The balance must be in the transaction's household. NO ACTION, so a
  -- balance that has parts cannot be deleted (household cascade still works:
  -- the parts go in the same statement).
  constraint payment_allocations_balance_household_fk
    foreign key (tracked_balance_id, household_id)
    references public.tracked_balances (id, household_id),

  constraint payment_allocations_transaction_balance_key
    unique (transaction_id, tracked_balance_id)
);

comment on table public.payment_allocations is
  'Allocation parts of a payment/adjustment across the member''s tracked balances. Immutable; parts of one transaction always sum to -amount_cents (deferred constraint trigger). Written only by record_payment / record_adjustment.';
comment on column public.payment_allocations.amount_cents is
  'Positive integer cents: the magnitude of the transaction applied to this balance.';
comment on column public.payment_allocations.transaction_type is
  'Copy of the transaction''s type, part of the composite FK so a part can only ever belong to a payment or adjustment.';

-- transaction_id lookups are served by payment_allocations_transaction_balance_key.
create index if not exists payment_allocations_household_id_idx
  on public.payment_allocations (household_id);
create index if not exists payment_allocations_member_id_idx
  on public.payment_allocations (member_id);
create index if not exists payment_allocations_tracked_balance_id_idx
  on public.payment_allocations (tracked_balance_id);

-- ---------------------------------------------------------------------------
-- Immutability guard (every role, including the owner)
-- ---------------------------------------------------------------------------

create or replace function internal.payment_allocations_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    -- Only as a cascade: the transaction or the household is already gone.
    if exists (select 1 from public.ledger_transactions lt where lt.id = old.transaction_id)
       and exists (select 1 from public.households h where h.id = old.household_id) then
      raise exception 'payment allocations cannot be deleted'
        using errcode = 'check_violation';
    end if;
    return old;
  end if;

  raise exception 'payment allocations cannot be changed'
    using errcode = 'check_violation';
end;
$$;

comment on function internal.payment_allocations_guard() is
  'BEFORE UPDATE/DELETE trigger on payment_allocations: parts are immutable; deletes are allowed only as a cascade from their transaction or household.';

revoke execute on function internal.payment_allocations_guard() from public, anon, authenticated;

create or replace trigger payment_allocations_guard
  before update or delete on public.payment_allocations
  for each row
  execute function internal.payment_allocations_guard();

-- ---------------------------------------------------------------------------
-- Deferred "parts sum to the amount" check
-- ---------------------------------------------------------------------------
--
-- SECURITY DEFINER: a deferred trigger fires at COMMIT, after any SECURITY
-- DEFINER write function has returned, i.e. as the session role
-- (authenticated). The check must see every part regardless of that role's
-- RLS. It takes no caller input beyond the triggering row.

create or replace function internal.payment_allocations_check_sum()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_transaction_id uuid;
  v_tx public.ledger_transactions;
  v_sum bigint;
begin
  if tg_table_name = 'payment_allocations' then
    v_transaction_id := new.transaction_id;
  else
    v_transaction_id := new.id;
  end if;

  select * into v_tx
    from public.ledger_transactions
    where id = v_transaction_id;

  if v_tx.id is null or v_tx.type not in ('payment', 'adjustment') then
    return null;
  end if;

  select coalesce(sum(pa.amount_cents), 0) into v_sum
    from public.payment_allocations pa
    where pa.transaction_id = v_transaction_id;

  if v_sum <> -v_tx.amount_cents then
    raise exception 'allocation parts of % % sum to %, expected %',
      v_tx.type, v_tx.id, v_sum, -v_tx.amount_cents
      using errcode = 'check_violation';
  end if;

  return null;
end;
$$;

comment on function internal.payment_allocations_check_sum() is
  'Deferred constraint trigger body: a payment/adjustment''s parts must sum to -amount_cents at commit (zero parts included).';

revoke execute on function internal.payment_allocations_check_sum() from public, anon, authenticated;

create constraint trigger payment_allocations_sum_check
  after insert on public.payment_allocations
  deferrable initially deferred
  for each row
  execute function internal.payment_allocations_check_sum();

create constraint trigger ledger_transactions_allocations_sum_check
  after insert or update of amount_cents, type on public.ledger_transactions
  deferrable initially deferred
  for each row
  when (new.type in ('payment', 'adjustment'))
  execute function internal.payment_allocations_check_sum();

-- ---------------------------------------------------------------------------
-- RLS and grants
-- ---------------------------------------------------------------------------

alter table public.payment_allocations enable row level security;

-- Mirrors ledger_transactions_select_parent / _select_self.
create policy payment_allocations_select_parent
  on public.payment_allocations
  for select
  to authenticated
  using (internal.is_household_parent(household_id));

create policy payment_allocations_select_self
  on public.payment_allocations
  for select
  to authenticated
  using (member_id = internal.current_household_member_id(household_id));

revoke all on table public.payment_allocations from anon, authenticated;
grant select on table public.payment_allocations to authenticated;

-- ---------------------------------------------------------------------------
-- internal.record_balance_decrease: now with allocations
-- ---------------------------------------------------------------------------
--
-- Dropped and recreated (not overloaded) so there is exactly one
-- record_payment / record_adjustment for PostgREST to resolve.

drop function if exists public.record_payment(uuid, bigint, text, date, uuid, text);
drop function if exists public.record_adjustment(uuid, bigint, text, date, uuid, text);
drop function if exists internal.record_balance_decrease(uuid, bigint, text, text, date, uuid, text);

create or replace function internal.record_balance_decrease(
  p_member_id uuid,
  p_amount_cents bigint,
  p_type text,
  p_description text,
  p_occurred_on date,
  p_category_id uuid,
  p_note text,
  p_allocations jsonb
)
returns public.ledger_transactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household_id uuid;
  v_target_status text;
  v_caller_member_id uuid;
  v_balance_ids uuid[] := '{}';
  v_amounts bigint[] := '{}';
  v_element jsonb;
  v_keys text[];
  v_balance_id uuid;
  v_amount numeric;
  v_balance public.tracked_balances;
  v_total numeric := 0;
  v_row public.ledger_transactions;
  v_parts jsonb;
begin
  if p_amount_cents >= 0 then
    raise exception '% amount_cents must be negative, got %', p_type, p_amount_cents
      using errcode = 'check_violation';
  end if;

  select hm.household_id, hm.status
    into v_household_id, v_target_status
    from public.household_members hm
    where hm.id = p_member_id;

  -- Caller's role first, before revealing anything about p_member_id or any
  -- balance (see record_expense in 20260904233000 for the reasoning).
  if not internal.is_household_parent(v_household_id) then
    raise exception 'only an active Parent may record a %', p_type
      using errcode = '42501';
  end if;

  if v_target_status <> 'active' then
    raise exception 'household member % is not active', p_member_id
      using errcode = '42501';
  end if;

  -- ---- allocations: parse + validate (decision 4) -------------------------
  if p_allocations is null then
    select tb.id into v_balance_id
      from public.tracked_balances tb
      where tb.household_id = v_household_id and tb.is_everyday;
    v_balance_ids := array[v_balance_id];
    v_amounts := array[-p_amount_cents];
  else
    if jsonb_typeof(p_allocations) <> 'array' or jsonb_array_length(p_allocations) = 0 then
      raise exception 'allocations must be a non-empty JSON array'
        using errcode = 'check_violation';
    end if;

    for v_element in select e from jsonb_array_elements(p_allocations) as e loop
      if jsonb_typeof(v_element) <> 'object' then
        raise exception 'each allocation must be an object with tracked_balance_id and amount_cents'
          using errcode = 'check_violation';
      end if;

      select array_agg(k order by k) into v_keys from jsonb_object_keys(v_element) as k;
      if v_keys is distinct from array['amount_cents', 'tracked_balance_id'] then
        raise exception 'each allocation must have exactly the keys tracked_balance_id and amount_cents'
          using errcode = 'check_violation';
      end if;

      if jsonb_typeof(v_element -> 'tracked_balance_id') <> 'string' then
        raise exception 'allocation tracked_balance_id must be a uuid string'
          using errcode = 'check_violation';
      end if;
      begin
        v_balance_id := (v_element ->> 'tracked_balance_id')::uuid;
      exception
        when invalid_text_representation then
          raise exception 'allocation tracked_balance_id must be a uuid string'
            using errcode = 'check_violation';
      end;

      if jsonb_typeof(v_element -> 'amount_cents') <> 'number' then
        raise exception 'allocation amount_cents must be a JSON number'
          using errcode = 'check_violation';
      end if;
      v_amount := (v_element ->> 'amount_cents')::numeric;
      if scale(v_amount) <> 0 or v_amount <= 0 or v_amount > 9223372036854775807 then
        raise exception 'allocation amount_cents must be a positive whole number of cents, got %', v_element -> 'amount_cents'
          using errcode = 'check_violation';
      end if;

      select * into v_balance
        from public.tracked_balances tb
        where tb.id = v_balance_id and tb.household_id = v_household_id;
      if v_balance.id is null then
        raise exception 'no such balance in this household: %', v_balance_id
          using errcode = 'check_violation';
      end if;
      if not v_balance.active then
        raise exception 'balance "%" is archived and cannot receive an allocation', v_balance.name
          using errcode = 'check_violation';
      end if;

      if v_balance_id = any (v_balance_ids) then
        raise exception 'balance "%" appears more than once in the allocations', v_balance.name
          using errcode = 'check_violation';
      end if;

      v_balance_ids := v_balance_ids || v_balance_id;
      v_amounts := v_amounts || v_amount::bigint;
      v_total := v_total + v_amount;
    end loop;

    if v_total <> -p_amount_cents then
      raise exception 'allocations sum to %, but the % is %', v_total, p_type, -p_amount_cents
        using errcode = 'check_violation';
    end if;
  end if;

  -- ---- write: ledger row + parts + audit (decision 5) ---------------------
  v_caller_member_id := internal.current_household_member_id(v_household_id);

  insert into public.ledger_transactions (
    household_id, member_id, amount_cents, type, category_id, description,
    note, occurred_on, created_by
  ) values (
    v_household_id, p_member_id, p_amount_cents, p_type, p_category_id,
    p_description, p_note, p_occurred_on, v_caller_member_id
  )
  returning * into v_row;

  insert into public.payment_allocations (
    household_id, member_id, transaction_id, transaction_type, tracked_balance_id, amount_cents
  )
  select v_household_id, p_member_id, v_row.id, p_type, b.balance_id, b.amount
  from unnest(v_balance_ids, v_amounts) as b (balance_id, amount);

  select jsonb_agg(
           jsonb_build_object('tracked_balance_id', b.balance_id, 'amount_cents', b.amount)
           order by b.ord)
    into v_parts
    from unnest(v_balance_ids, v_amounts) with ordinality as b (balance_id, amount, ord);

  insert into public.audit_log (
    household_id, actor_user_id, entity_type, entity_id, action, new_values
  ) values (
    v_household_id, auth.uid(), 'ledger_transactions', v_row.id, 'insert',
    to_jsonb(v_row) || jsonb_build_object('allocations', v_parts)
  );

  return v_row;
end;
$$;

comment on function internal.record_balance_decrease(uuid, bigint, text, text, date, uuid, text, jsonb) is
  'Shared Parent-only, amount_cents < 0 path for record_payment and record_adjustment: authorizes, validates allocations (NULL = whole amount to Everyday), inserts the ledger row, its allocation parts and an audit row whose new_values carries the parts. Not a public entry point.';

revoke execute on function internal.record_balance_decrease(uuid, bigint, text, text, date, uuid, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- public.record_payment / public.record_adjustment
-- ---------------------------------------------------------------------------

create or replace function public.record_payment(
  p_member_id uuid,
  p_amount_cents bigint,
  p_description text,
  p_occurred_on date,
  p_category_id uuid default null,
  p_note text default null,
  p_allocations jsonb default null
)
returns public.ledger_transactions
language sql
security definer
set search_path = ''
as $$
  select internal.record_balance_decrease(
    p_member_id, p_amount_cents, 'payment', p_description, p_occurred_on,
    p_category_id, p_note, p_allocations
  );
$$;

comment on function public.record_payment(uuid, bigint, text, date, uuid, text, jsonb) is
  'Record a payment (amount_cents < 0) against p_member_id. Parent-only. p_allocations: [{"tracked_balance_id": uuid, "amount_cents": positive int}, ...] summing to -p_amount_cents; NULL/omitted = whole amount to Everyday.';

revoke execute on function public.record_payment(uuid, bigint, text, date, uuid, text, jsonb) from public, anon;
grant execute on function public.record_payment(uuid, bigint, text, date, uuid, text, jsonb) to authenticated;

create or replace function public.record_adjustment(
  p_member_id uuid,
  p_amount_cents bigint,
  p_description text,
  p_occurred_on date,
  p_category_id uuid default null,
  p_note text default null,
  p_allocations jsonb default null
)
returns public.ledger_transactions
language sql
security definer
set search_path = ''
as $$
  select internal.record_balance_decrease(
    p_member_id, p_amount_cents, 'adjustment', p_description, p_occurred_on,
    p_category_id, p_note, p_allocations
  );
$$;

comment on function public.record_adjustment(uuid, bigint, text, date, uuid, text, jsonb) is
  'Record an adjustment (amount_cents < 0) against p_member_id. Parent-only, same shape as record_payment (including p_allocations) with type = ''adjustment''.';

revoke execute on function public.record_adjustment(uuid, bigint, text, date, uuid, text, jsonb) from public, anon;
grant execute on function public.record_adjustment(uuid, bigint, text, date, uuid, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- public.household_member_balance_breakdown: payments follow their parts
-- ---------------------------------------------------------------------------
--
-- Same signature, visibility rule and row universe as CB1. Attribution:
--   * expense -> its category's tracked_balance_id, else Everyday (unchanged)
--   * payment / adjustment -> each part's balance, -part.amount_cents;
--     plus residual (amount_cents + SUM(parts)) on Everyday (decision 6)
-- Only non-voided transactions contribute, so a voided payment's parts count
-- for nothing.

create or replace function public.household_member_balance_breakdown(p_household_id uuid)
returns table (
  member_id uuid,
  tracked_balance_id uuid,
  balance_cents bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with visible as (
    select hm.id
    from public.household_members hm
    where hm.household_id = p_household_id
      and hm.status = 'active'
      and (
        internal.is_household_parent(p_household_id)
        or hm.id = internal.current_household_member_id(p_household_id)
      )
  ),
  everyday as (
    select tb.id
    from public.tracked_balances tb
    where tb.household_id = p_household_id
      and tb.is_everyday
  ),
  live as (
    select lt.id, lt.member_id, lt.type, lt.category_id, lt.amount_cents
    from public.ledger_transactions lt
    join visible v on v.id = lt.member_id
    where lt.voided_at is null
  ),
  parts as (
    -- Everyday is always present for every visible member.
    select v.id as member_id, e.id as tracked_balance_id, 0::bigint as amount_cents
    from visible v
    cross join everyday e
    union all
    -- Expenses: category mapping.
    select l.member_id, coalesce(c.tracked_balance_id, e.id), l.amount_cents
    from live l
    cross join everyday e
    left join public.categories c on c.id = l.category_id
    where l.type = 'expense'
    union all
    -- Payments / adjustments: allocation parts.
    select l.member_id, pa.tracked_balance_id, -pa.amount_cents
    from live l
    join public.payment_allocations pa on pa.transaction_id = l.id
    where l.type in ('payment', 'adjustment')
    union all
    -- Residual (0 for every committed row).
    select l.member_id, e.id,
           l.amount_cents + coalesce((select sum(pa.amount_cents)
                                        from public.payment_allocations pa
                                       where pa.transaction_id = l.id), 0)
    from live l
    cross join everyday e
    where l.type in ('payment', 'adjustment')
  )
  select p.member_id, p.tracked_balance_id, sum(p.amount_cents)::bigint as balance_cents
  from parts p
  group by p.member_id, p.tracked_balance_id;
$$;

comment on function public.household_member_balance_breakdown(uuid) is
  'Per visible member, balance per tracked balance: Everyday always (even 0), plus each tracked balance with non-voided activity. Expenses follow their category''s tracked_balance_id (NULL -> Everyday); payments/adjustments follow their allocation parts (any unallocated residual -> Everyday; always 0 once committed). Same SECURITY DEFINER visibility rule and row set as household_member_balances, so the parts always sum to that total.';

revoke execute on function public.household_member_balance_breakdown(uuid) from public, anon;
grant execute on function public.household_member_balance_breakdown(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Backfill: one Everyday part per existing payment/adjustment (voided too)
-- ---------------------------------------------------------------------------
--
-- Last statement in the file: the inserts queue deferred constraint-trigger
-- events, and Postgres refuses ALTER TABLE on a table with pending trigger
-- events.

insert into public.payment_allocations (
  household_id, member_id, transaction_id, transaction_type, tracked_balance_id, amount_cents
)
select lt.household_id, lt.member_id, lt.id, lt.type, tb.id, -lt.amount_cents
from public.ledger_transactions lt
join public.tracked_balances tb
  on tb.household_id = lt.household_id and tb.is_everyday
where lt.type in ('payment', 'adjustment')
  and not exists (
    select 1 from public.payment_allocations pa where pa.transaction_id = lt.id
  );
