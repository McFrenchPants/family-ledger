-- Family Ledger: CB3 -- balance transfers ("move money" between a child's
-- tracked balances).
--
-- Backlog 16 (category balances), design: docs/proposals/category-balances/
-- DESIGN_SPEC.md, plan task CB3.
--
-- A Parent shifts an amount from one of a child's tracked balances to
-- another. Net zero for the child: public.household_member_balances (the
-- TOTAL) is untouched -- a transfer is NOT a ledger_transactions row and does
-- not feed household_member_balances or payment_period_status. Only the
-- per-balance breakdown (public.household_member_balance_breakdown) moves.
--
-- Contents:
--   * household_members: unique key (id, household_id) for composite FKs
--   * public.balance_transfers (+ same-household composite FKs, + guard
--     trigger: immutable except a one-time void)
--   * RLS / grants: read-only for app roles, Parent sees the household,
--     Child sees own (mirrors ledger_transactions)
--   * public.record_balance_transfer / public.void_balance_transfer
--     (Parent-only, SECURITY DEFINER, audited, entity_type 'balance_transfers')
--   * public.household_member_balance_breakdown: includes non-voided transfers
--
-- ===========================================================================
-- DIRECTION -- READ THIS BEFORE BUILDING ANY UI ON TOP OF IT
-- ===========================================================================
--
-- A transfer moves PAID CREDIT (money already paid / credited) from the
-- `from` balance to the `to` balance. Breakdown numbers are "amount owed"
-- (positive = the child owes, negative = the child is in credit), so a
-- transfer of A from F to T:
--
--     F's balance goes UP   by A   (F loses A of credit -> owes A more)
--     T's balance goes DOWN by A   (T gains A of credit -> owes A less)
--     the child's total is unchanged
--
-- It is exactly as if A of an earlier payment had been allocated to T
-- instead of F. In the owner's words: "move $A (of payments) from Everyday
-- to Car" = from_tracked_balance_id Everyday, to_tracked_balance_id Car.
--
-- Worked example (reproduced in supabase/tests/015_balance_transfers.sql,
-- test group WE):
--   Before Car existed the child had a $300 car expense, a $50 other expense
--   and paid $200, all on Everyday:              Everyday = +150
--   The Parent creates Car and points the Auto category at it. The $300
--   expense moves to Car automatically; the $200 payment stays on Everyday:
--                                                Car = +300, Everyday = -150
--   The Parent records a transfer of $150 FROM Everyday TO Car:
--                                                Car = +150, Everyday = 0
--   Total before and after: +150.
--
-- To move a DEBT the other way (the child should owe A more on T and A less
-- on F), record a transfer from T to F.
--
-- ---------------------------------------------------------------------------
-- Decisions taken here
-- ---------------------------------------------------------------------------
--
-- 1. Same-household is declarative: household_members gains a unique key on
--    (id, household_id) and member_id / created_by / voided_by each carry a
--    composite FK to it; both balances carry composite FKs to
--    tracked_balances_id_household_id_key. from <> to is a CHECK.
-- 2. Immutable except voiding. App roles have no INSERT/UPDATE/DELETE grant
--    (primary) and no write policy (secondary). The guard trigger also
--    applies to the owner/postgres: an UPDATE must change only voided_at /
--    voided_by / void_reason, only from NULL (once); a DELETE is allowed
--    only as a cascade from deleting the whole household. Same approach as
--    payment_allocations_guard (CB2).
-- 3. note is unbounded text, exactly like ledger_transactions.note (the
--    ledger has no length limit on note anywhere; adding one only here would
--    be inconsistent). void_reason must be non-blank when present (CHECK),
--    in addition to the function's own check.
-- 4. record_balance_transfer authorizes before revealing anything (role is
--    checked against the household derived from the member row, as
--    record_payment does); a balance missing from the member's household and
--    a nonexistent one get the same check_violation message as CB2's
--    allocations. void_balance_transfer checks the role against the row's
--    household before saying whether the row exists (a missing row and a
--    foreign row look identical), unlike the older void_ledger_transaction.
-- 5. Archived balances cannot be used in a NEW transfer; voiding an existing
--    transfer whose balance has since been archived is allowed (it only
--    removes an effect).
-- 6. A transfer may push a balance negative (into credit); that is allowed.

-- ---------------------------------------------------------------------------
-- household_members: (id, household_id) key for composite FKs
-- ---------------------------------------------------------------------------

alter table public.household_members
  add constraint household_members_id_household_id_key unique (id, household_id);

-- ---------------------------------------------------------------------------
-- public.balance_transfers
-- ---------------------------------------------------------------------------

create table if not exists public.balance_transfers (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null
    references public.households (id) on delete cascade,
  member_id uuid not null,
  from_tracked_balance_id uuid not null,
  to_tracked_balance_id uuid not null,
  amount_cents bigint not null,
  occurred_on date not null,
  note text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid,
  void_reason text,

  constraint balance_transfers_amount_positive_check
    check (amount_cents > 0),

  constraint balance_transfers_distinct_balances_check
    check (from_tracked_balance_id <> to_tracked_balance_id),

  -- Same all-or-nothing rule as ledger_transactions_void_all_or_nothing_check.
  constraint balance_transfers_void_all_or_nothing_check
    check (
      (voided_at is null and voided_by is null and void_reason is null)
      or (voided_at is not null and voided_by is not null and void_reason is not null)
    ),

  constraint balance_transfers_void_reason_not_blank_check
    check (void_reason is null or btrim(void_reason) <> ''),

  constraint balance_transfers_member_household_fk
    foreign key (member_id, household_id)
    references public.household_members (id, household_id),

  constraint balance_transfers_created_by_household_fk
    foreign key (created_by, household_id)
    references public.household_members (id, household_id),

  -- MATCH SIMPLE: NULL voided_by (not voided) is exempt.
  constraint balance_transfers_voided_by_household_fk
    foreign key (voided_by, household_id)
    references public.household_members (id, household_id),

  constraint balance_transfers_from_balance_household_fk
    foreign key (from_tracked_balance_id, household_id)
    references public.tracked_balances (id, household_id),

  constraint balance_transfers_to_balance_household_fk
    foreign key (to_tracked_balance_id, household_id)
    references public.tracked_balances (id, household_id)
);

comment on table public.balance_transfers is
  'Parent-recorded moves of PAID CREDIT between one member''s tracked balances. A transfer of amount_cents raises from_tracked_balance_id''s balance and lowers to_tracked_balance_id''s balance by that amount; the member''s total is unchanged. Not a ledger row. Immutable except a one-time void.';
comment on column public.balance_transfers.from_tracked_balance_id is
  'The balance credit is moved AWAY from: its balance (amount owed) goes UP by amount_cents.';
comment on column public.balance_transfers.to_tracked_balance_id is
  'The balance credit is moved ONTO: its balance (amount owed) goes DOWN by amount_cents.';
comment on column public.balance_transfers.amount_cents is
  'Positive integer cents of credit moved from from_tracked_balance_id to to_tracked_balance_id.';
comment on column public.balance_transfers.voided_at is
  'Set together with voided_by and void_reason, or not at all; set at most once (balance_transfers_guard).';

create index if not exists balance_transfers_household_id_idx
  on public.balance_transfers (household_id);
create index if not exists balance_transfers_member_id_idx
  on public.balance_transfers (member_id);
create index if not exists balance_transfers_from_tracked_balance_id_idx
  on public.balance_transfers (from_tracked_balance_id);
create index if not exists balance_transfers_to_tracked_balance_id_idx
  on public.balance_transfers (to_tracked_balance_id);
create index if not exists balance_transfers_created_by_idx
  on public.balance_transfers (created_by);
create index if not exists balance_transfers_voided_by_idx
  on public.balance_transfers (voided_by);

-- The breakdown's access path: non-voided transfers per member.
create index if not exists balance_transfers_household_member_active_idx
  on public.balance_transfers (household_id, member_id)
  where voided_at is null;

-- ---------------------------------------------------------------------------
-- Guard trigger (every role, including the owner)
-- ---------------------------------------------------------------------------

create or replace function internal.balance_transfers_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    -- Only as a cascade from deleting the household (already gone by now).
    if exists (select 1 from public.households h where h.id = old.household_id) then
      raise exception 'balance transfers cannot be deleted; void them instead'
        using errcode = 'check_violation';
    end if;
    return old;
  end if;

  if old.voided_at is not null then
    raise exception 'balance transfer % is already voided and cannot be changed', old.id
      using errcode = 'check_violation';
  end if;

  if (to_jsonb(new) - array['voided_at', 'voided_by', 'void_reason'])
     is distinct from (to_jsonb(old) - array['voided_at', 'voided_by', 'void_reason']) then
    raise exception 'balance transfers cannot be changed; only voiding is allowed'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function internal.balance_transfers_guard() is
  'BEFORE UPDATE/DELETE trigger on balance_transfers: only voided_at/voided_by/void_reason may change, once, from NULL; deletes only as a household cascade.';

revoke execute on function internal.balance_transfers_guard() from public, anon, authenticated;

create or replace trigger balance_transfers_guard
  before update or delete on public.balance_transfers
  for each row
  execute function internal.balance_transfers_guard();

-- ---------------------------------------------------------------------------
-- RLS and grants
-- ---------------------------------------------------------------------------

alter table public.balance_transfers enable row level security;

-- Mirrors ledger_transactions_select_parent / _select_self.
create policy balance_transfers_select_parent
  on public.balance_transfers
  for select
  to authenticated
  using (internal.is_household_parent(household_id));

create policy balance_transfers_select_self
  on public.balance_transfers
  for select
  to authenticated
  using (member_id = internal.current_household_member_id(household_id));

revoke all on table public.balance_transfers from anon, authenticated;
grant select on table public.balance_transfers to authenticated;

-- ---------------------------------------------------------------------------
-- public.record_balance_transfer: Parent-only
-- ---------------------------------------------------------------------------

create or replace function public.record_balance_transfer(
  p_member_id uuid,
  p_from_tracked_balance_id uuid,
  p_to_tracked_balance_id uuid,
  p_amount_cents bigint,
  p_occurred_on date,
  p_note text default null
)
returns public.balance_transfers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household_id uuid;
  v_target_status text;
  v_caller_member_id uuid;
  v_from public.tracked_balances;
  v_to public.tracked_balances;
  v_row public.balance_transfers;
begin
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'transfer amount_cents must be positive, got %', p_amount_cents
      using errcode = 'check_violation';
  end if;

  select hm.household_id, hm.status
    into v_household_id, v_target_status
    from public.household_members hm
    where hm.id = p_member_id;

  -- Caller's role first, before revealing anything about p_member_id or any
  -- balance (same reasoning as record_payment).
  if not internal.is_household_parent(v_household_id) then
    raise exception 'only an active Parent may move money between balances'
      using errcode = '42501';
  end if;

  if v_target_status <> 'active' then
    raise exception 'household member % is not active', p_member_id
      using errcode = '42501';
  end if;

  if p_from_tracked_balance_id is null or p_to_tracked_balance_id is null then
    raise exception 'both a from balance and a to balance are required'
      using errcode = 'check_violation';
  end if;

  if p_from_tracked_balance_id = p_to_tracked_balance_id then
    raise exception 'cannot move money from a balance to itself'
      using errcode = 'check_violation';
  end if;

  select * into v_from
    from public.tracked_balances tb
    where tb.id = p_from_tracked_balance_id and tb.household_id = v_household_id;
  if v_from.id is null then
    raise exception 'no such balance in this household: %', p_from_tracked_balance_id
      using errcode = 'check_violation';
  end if;

  select * into v_to
    from public.tracked_balances tb
    where tb.id = p_to_tracked_balance_id and tb.household_id = v_household_id;
  if v_to.id is null then
    raise exception 'no such balance in this household: %', p_to_tracked_balance_id
      using errcode = 'check_violation';
  end if;

  if not v_from.active then
    raise exception 'balance "%" is archived and cannot be used in a transfer', v_from.name
      using errcode = 'check_violation';
  end if;
  if not v_to.active then
    raise exception 'balance "%" is archived and cannot be used in a transfer', v_to.name
      using errcode = 'check_violation';
  end if;

  v_caller_member_id := internal.current_household_member_id(v_household_id);

  insert into public.balance_transfers (
    household_id, member_id, from_tracked_balance_id, to_tracked_balance_id,
    amount_cents, occurred_on, note, created_by
  ) values (
    v_household_id, p_member_id, p_from_tracked_balance_id, p_to_tracked_balance_id,
    p_amount_cents, p_occurred_on, p_note, v_caller_member_id
  )
  returning * into v_row;

  insert into public.audit_log (
    household_id, actor_user_id, entity_type, entity_id, action, new_values
  ) values (
    v_household_id, auth.uid(), 'balance_transfers', v_row.id, 'insert', to_jsonb(v_row)
  );

  return v_row;
end;
$$;

comment on function public.record_balance_transfer(uuid, uuid, uuid, bigint, date, text) is
  'Move p_amount_cents of PAID CREDIT from p_from_tracked_balance_id to p_to_tracked_balance_id for p_member_id: the from balance goes UP, the to balance goes DOWN, the total is unchanged. E.g. "move $150 of payments from Everyday to Car" = from Everyday, to Car. Parent-only; both balances active, distinct, in the member''s household; member active. Audited.';

revoke execute on function public.record_balance_transfer(uuid, uuid, uuid, bigint, date, text) from public, anon;
grant execute on function public.record_balance_transfer(uuid, uuid, uuid, bigint, date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- public.void_balance_transfer: Parent-only, atomic three-column void
-- ---------------------------------------------------------------------------

create or replace function public.void_balance_transfer(
  p_transfer_id uuid,
  p_void_reason text
)
returns public.balance_transfers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.balance_transfers;
  v_new public.balance_transfers;
  v_caller_member_id uuid;
begin
  if p_void_reason is null or length(trim(both from p_void_reason)) = 0 then
    raise exception 'void_reason is required'
      using errcode = 'check_violation';
  end if;

  select * into v_old
    from public.balance_transfers
    where id = p_transfer_id;

  -- Role check first, against the household derived from the row: a
  -- missing row (NULL household) and a foreign household look identical.
  if not internal.is_household_parent(v_old.household_id) then
    raise exception 'only an active Parent of this transfer''s household may void it'
      using errcode = '42501';
  end if;

  if v_old.voided_at is not null then
    raise exception 'balance transfer % is already voided', p_transfer_id
      using errcode = 'check_violation';
  end if;

  v_caller_member_id := internal.current_household_member_id(v_old.household_id);

  update public.balance_transfers
     set voided_at = now(),
         voided_by = v_caller_member_id,
         void_reason = p_void_reason
   where id = p_transfer_id
   returning * into v_new;

  insert into public.audit_log (
    household_id, actor_user_id, entity_type, entity_id, action, old_values, new_values
  ) values (
    v_old.household_id, auth.uid(), 'balance_transfers', v_old.id, 'void',
    to_jsonb(v_old), to_jsonb(v_new)
  );

  return v_new;
end;
$$;

comment on function public.void_balance_transfer(uuid, text) is
  'Void a balance transfer: sets voided_at/voided_by/void_reason atomically, removing its effect on the breakdown. Parent of the transfer''s own household only (derived from the row). Reason required; already-voided rejected. Audited.';

revoke execute on function public.void_balance_transfer(uuid, text) from public, anon;
grant execute on function public.void_balance_transfer(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- public.household_member_balance_breakdown: + transfers
-- ---------------------------------------------------------------------------
--
-- Same signature, visibility rule and ledger row universe as CB2. Added:
-- each non-voided transfer of a visible member contributes +amount to its
-- from balance and -amount to its to balance (net zero per member, so the
-- per-member sum still equals household_member_balances).

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
  live_transfers as (
    select bt.member_id, bt.from_tracked_balance_id, bt.to_tracked_balance_id, bt.amount_cents
    from public.balance_transfers bt
    join visible v on v.id = bt.member_id
    where bt.voided_at is null
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
    union all
    -- Transfers: credit leaves `from` (owed goes up) ...
    select t.member_id, t.from_tracked_balance_id, t.amount_cents
    from live_transfers t
    union all
    -- ... and lands on `to` (owed goes down).
    select t.member_id, t.to_tracked_balance_id, -t.amount_cents
    from live_transfers t
  )
  select p.member_id, p.tracked_balance_id, sum(p.amount_cents)::bigint as balance_cents
  from parts p
  group by p.member_id, p.tracked_balance_id;
$$;

comment on function public.household_member_balance_breakdown(uuid) is
  'Per visible member, balance per tracked balance: Everyday always (even 0), plus each tracked balance with non-voided activity. Expenses follow their category''s tracked_balance_id (NULL -> Everyday); payments/adjustments follow their allocation parts (any unallocated residual -> Everyday; always 0 once committed); non-voided balance transfers add +amount to their from balance and -amount to their to balance. Same SECURITY DEFINER visibility rule and row set as household_member_balances, so the parts always sum to that total.';

revoke execute on function public.household_member_balance_breakdown(uuid) from public, anon;
grant execute on function public.household_member_balance_breakdown(uuid) to authenticated;
