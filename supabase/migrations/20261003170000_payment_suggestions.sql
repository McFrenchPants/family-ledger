-- Family Ledger: CB5 -- Child payment suggestions.
--
-- Backlog 16 (category balances), design: docs/proposals/category-balances/
-- DESIGN_SPEC.md R5 + R8, plan task CB5.
--
-- A Child can SUGGEST a payment they intend to make: an amount, a date, an
-- optional note and a proposed split across their tracked balances. A
-- suggestion is NOT a ledger row and changes no balance, ever. A Parent sees
-- the pending suggestions, opens one to pre-fill Record payment, and
-- recording that payment links it to the suggestion and closes it
-- (record_payment's new trailing p_suggestion_id). A Parent may instead
-- dismiss it (with an optional reason); the Child may withdraw a pending
-- one. Nothing is editable after creation.
--
-- Contents:
--   * public.payment_suggestions + public.payment_suggestion_parts
--     (composite same-household / same-member FKs, immutability guards,
--     deferred "parts sum to the amount" constraint triggers, RLS/grants)
--   * public.create_payment_suggestion  (Child, self only)
--   * public.withdraw_payment_suggestion (Child, own, pending only)
--   * public.dismiss_payment_suggestion  (Parent, pending only)
--   * public.record_payment replaced: trailing p_suggestion_id uuid DEFAULT
--     NULL converts a pending suggestion in the same transaction
--
-- ---------------------------------------------------------------------------
-- Decisions taken here (documented for later CB tasks)
-- ---------------------------------------------------------------------------
--
-- 1. Status column is "status" with values pending / converted / dismissed /
--    withdrawn. Terminal states are final. A CHECK ties each status to its
--    resolution columns (converted needs converted_transaction_id; the
--    others must not have one; pending has no resolution at all), so a
--    half-resolved row cannot exist whatever writes it.
-- 2. Immutability: app roles hold SELECT only (no INSERT/UPDATE/DELETE
--    grant, no write policy). A guard trigger additionally rejects, for
--    every role including the owner, any change except pending -> terminal
--    with the resolution columns, and any DELETE except a household cascade.
--    Parts are fully immutable (same guard shape as payment_allocations).
-- 3. A suggestion converts to a PAYMENT only: converted_transaction_type is
--    part of a composite FK to ledger_transactions (id, household_id,
--    member_id, type) and CHECKed to 'payment'; the FK also pins the payment
--    to the suggestion's household and member. A unique index on
--    converted_transaction_id makes a payment close at most one suggestion.
-- 4. p_parts NULL (or omitted) means one part, the whole amount, on the
--    household's Everyday balance -- same convention as record_payment's
--    p_allocations. Part validation failures are check_violation (23514),
--    exactly like allocation failures. Archived balances are rejected at
--    creation only; a balance archived later does not invalidate a pending
--    suggestion (the Parent chooses the real split when recording).
-- 5. Authorization is checked before anything else and before any part is
--    parsed, so a caller who may not act learns nothing (42501). A Parent
--    cannot create or withdraw; a Child cannot dismiss or convert.
-- 6. The payment recorded from a suggestion is whatever the Parent submits:
--    its amount, date and split may differ from the suggestion. Conversion
--    happens AFTER the payment is written and authorized (inside
--    record_payment, same transaction): any conversion failure (not found,
--    other household, other member, not pending) raises and rolls the whole
--    payment back. The suggestion row is locked FOR UPDATE, so two
--    concurrent payments cannot both close it.
-- 7. note / reason are trimmed; blank becomes NULL; at most 500 characters
--    (the first length limit on a free-text note in this schema).
-- 8. Every write is audited with entity_type 'payment_suggestions':
--    'insert' (new_values = the row + "parts" array), 'withdraw',
--    'dismiss', 'convert' (old/new row). The payment itself keeps its normal
--    'insert' audit row from record_balance_decrease, which is unchanged
--    (record_adjustment does not take a suggestion).

-- ---------------------------------------------------------------------------
-- public.payment_suggestions
-- ---------------------------------------------------------------------------

create table if not exists public.payment_suggestions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null
    references public.households (id) on delete cascade,
  member_id uuid not null,
  amount_cents bigint not null,
  suggested_on date not null,
  note text,
  status text not null default 'pending',
  created_by uuid not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid,
  resolution_note text,
  converted_transaction_id uuid,
  converted_transaction_type text,

  constraint payment_suggestions_amount_positive_check
    check (amount_cents > 0),

  constraint payment_suggestions_status_check
    check (status in ('pending', 'converted', 'dismissed', 'withdrawn')),

  constraint payment_suggestions_note_check
    check (note is null or (note = btrim(note) and char_length(note) between 1 and 500)),

  constraint payment_suggestions_resolution_note_check
    check (resolution_note is null
           or (resolution_note = btrim(resolution_note) and char_length(resolution_note) between 1 and 500)),

  -- Status <-> resolution columns, all-or-nothing.
  constraint payment_suggestions_resolution_check
    check (
      (status = 'pending'
         and resolved_at is null and resolved_by is null
         and resolution_note is null and converted_transaction_id is null)
      or (status = 'converted'
         and resolved_at is not null and resolved_by is not null
         and resolution_note is null and converted_transaction_id is not null)
      or (status = 'dismissed'
         and resolved_at is not null and resolved_by is not null
         and converted_transaction_id is null)
      or (status = 'withdrawn'
         and resolved_at is not null and resolved_by is not null
         and resolution_note is null and converted_transaction_id is null)
    ),

  constraint payment_suggestions_converted_type_check
    check ((converted_transaction_id is null) = (converted_transaction_type is null)
           and (converted_transaction_type is null or converted_transaction_type = 'payment')),

  constraint payment_suggestions_member_household_fk
    foreign key (member_id, household_id)
    references public.household_members (id, household_id),

  constraint payment_suggestions_created_by_household_fk
    foreign key (created_by, household_id)
    references public.household_members (id, household_id),

  -- MATCH SIMPLE: NULL resolved_by (still pending) is exempt.
  constraint payment_suggestions_resolved_by_household_fk
    foreign key (resolved_by, household_id)
    references public.household_members (id, household_id),

  -- The converting payment: same household, same member, type 'payment'.
  -- MATCH SIMPLE: all-NULL (not converted) is exempt.
  constraint payment_suggestions_converted_transaction_fk
    foreign key (converted_transaction_id, household_id, member_id, converted_transaction_type)
    references public.ledger_transactions (id, household_id, member_id, type),

  -- Parts reference this key (same household + same member).
  constraint payment_suggestions_id_household_member_key
    unique (id, household_id, member_id)
);

comment on table public.payment_suggestions is
  'A Child''s suggestion of a payment they plan to make. Never a ledger row; changes no balance. Immutable except one pending -> converted/dismissed/withdrawn transition (payment_suggestions_guard). Written only by create_/withdraw_/dismiss_payment_suggestion and record_payment(p_suggestion_id).';
comment on column public.payment_suggestions.amount_cents is
  'Positive integer cents the Child proposes to pay (a suggestion is never negative; the payment it becomes is).';
comment on column public.payment_suggestions.status is
  'pending | converted | dismissed | withdrawn. Terminal states are final.';
comment on column public.payment_suggestions.resolution_note is
  'The Parent''s optional dismiss reason; NULL for every other status.';
comment on column public.payment_suggestions.converted_transaction_id is
  'The payment recorded from this suggestion; set only on conversion, unique (a payment closes at most one suggestion).';

create unique index if not exists payment_suggestions_converted_transaction_key
  on public.payment_suggestions (converted_transaction_id)
  where converted_transaction_id is not null;

create index if not exists payment_suggestions_household_id_idx
  on public.payment_suggestions (household_id);
create index if not exists payment_suggestions_created_by_idx
  on public.payment_suggestions (created_by);
create index if not exists payment_suggestions_resolved_by_idx
  on public.payment_suggestions (resolved_by);
-- Access paths: a Parent's pending list, a Child's own list.
create index if not exists payment_suggestions_household_pending_idx
  on public.payment_suggestions (household_id, created_at desc)
  where status = 'pending';
create index if not exists payment_suggestions_member_idx
  on public.payment_suggestions (member_id, created_at desc);

-- ---------------------------------------------------------------------------
-- public.payment_suggestion_parts
-- ---------------------------------------------------------------------------

create table if not exists public.payment_suggestion_parts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null
    references public.households (id) on delete cascade,
  member_id uuid not null,
  suggestion_id uuid not null,
  tracked_balance_id uuid not null,
  amount_cents bigint not null,
  created_at timestamptz not null default now(),

  constraint payment_suggestion_parts_amount_positive_check
    check (amount_cents > 0),

  -- Same suggestion, household and member. Cascade: a part cannot outlive it.
  constraint payment_suggestion_parts_suggestion_fk
    foreign key (suggestion_id, household_id, member_id)
    references public.payment_suggestions (id, household_id, member_id)
    on delete cascade,

  constraint payment_suggestion_parts_balance_household_fk
    foreign key (tracked_balance_id, household_id)
    references public.tracked_balances (id, household_id),

  constraint payment_suggestion_parts_suggestion_balance_key
    unique (suggestion_id, tracked_balance_id)
);

comment on table public.payment_suggestion_parts is
  'Proposed split of a payment suggestion across the member''s tracked balances. Immutable; parts of one suggestion always sum to its amount_cents (deferred constraint trigger).';

create index if not exists payment_suggestion_parts_household_id_idx
  on public.payment_suggestion_parts (household_id);
create index if not exists payment_suggestion_parts_member_id_idx
  on public.payment_suggestion_parts (member_id);
create index if not exists payment_suggestion_parts_tracked_balance_id_idx
  on public.payment_suggestion_parts (tracked_balance_id);

-- ---------------------------------------------------------------------------
-- Guard triggers (every role, including the owner)
-- ---------------------------------------------------------------------------

create or replace function internal.payment_suggestions_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    -- Only as a cascade from deleting the household (already gone by now).
    if exists (select 1 from public.households h where h.id = old.household_id) then
      raise exception 'payment suggestions cannot be deleted'
        using errcode = 'check_violation';
    end if;
    return old;
  end if;

  if old.status <> 'pending' then
    raise exception 'payment suggestion % is already % and cannot be changed', old.id, old.status
      using errcode = 'check_violation';
  end if;

  if new.status = 'pending' then
    raise exception 'payment suggestions cannot be changed, only resolved'
      using errcode = 'check_violation';
  end if;

  if (to_jsonb(new) - array['status', 'resolved_at', 'resolved_by', 'resolution_note',
                            'converted_transaction_id', 'converted_transaction_type'])
     is distinct from
     (to_jsonb(old) - array['status', 'resolved_at', 'resolved_by', 'resolution_note',
                            'converted_transaction_id', 'converted_transaction_type']) then
    raise exception 'payment suggestions cannot be edited'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function internal.payment_suggestions_guard() is
  'BEFORE UPDATE/DELETE trigger on payment_suggestions: only a one-time pending -> terminal transition touching the status/resolution columns; deletes only as a household cascade.';

revoke execute on function internal.payment_suggestions_guard() from public, anon, authenticated;

create or replace trigger payment_suggestions_guard
  before update or delete on public.payment_suggestions
  for each row
  execute function internal.payment_suggestions_guard();

create or replace function internal.payment_suggestion_parts_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    -- Only as a cascade: the suggestion or the household is already gone.
    if exists (select 1 from public.payment_suggestions s where s.id = old.suggestion_id)
       and exists (select 1 from public.households h where h.id = old.household_id) then
      raise exception 'payment suggestion parts cannot be deleted'
        using errcode = 'check_violation';
    end if;
    return old;
  end if;

  raise exception 'payment suggestion parts cannot be changed'
    using errcode = 'check_violation';
end;
$$;

comment on function internal.payment_suggestion_parts_guard() is
  'BEFORE UPDATE/DELETE trigger on payment_suggestion_parts: parts are immutable; deletes only as a cascade.';

revoke execute on function internal.payment_suggestion_parts_guard() from public, anon, authenticated;

create or replace trigger payment_suggestion_parts_guard
  before update or delete on public.payment_suggestion_parts
  for each row
  execute function internal.payment_suggestion_parts_guard();

-- ---------------------------------------------------------------------------
-- Deferred "parts sum to the amount" check (same reasoning as CB2: SECURITY
-- DEFINER because it fires at COMMIT as the session role)
-- ---------------------------------------------------------------------------

create or replace function internal.payment_suggestion_parts_check_sum()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_suggestion_id uuid;
  v_amount bigint;
  v_sum bigint;
begin
  if tg_table_name = 'payment_suggestion_parts' then
    v_suggestion_id := new.suggestion_id;
  else
    v_suggestion_id := new.id;
  end if;

  select s.amount_cents into v_amount
    from public.payment_suggestions s
    where s.id = v_suggestion_id;

  if v_amount is null then
    return null;
  end if;

  select coalesce(sum(p.amount_cents), 0) into v_sum
    from public.payment_suggestion_parts p
    where p.suggestion_id = v_suggestion_id;

  if v_sum <> v_amount then
    raise exception 'parts of payment suggestion % sum to %, expected %',
      v_suggestion_id, v_sum, v_amount
      using errcode = 'check_violation';
  end if;

  return null;
end;
$$;

comment on function internal.payment_suggestion_parts_check_sum() is
  'Deferred constraint trigger body: a suggestion''s parts must sum to its amount_cents at commit (zero parts included).';

revoke execute on function internal.payment_suggestion_parts_check_sum() from public, anon, authenticated;

create constraint trigger payment_suggestion_parts_sum_check
  after insert on public.payment_suggestion_parts
  deferrable initially deferred
  for each row
  execute function internal.payment_suggestion_parts_check_sum();

create constraint trigger payment_suggestions_parts_sum_check
  after insert on public.payment_suggestions
  deferrable initially deferred
  for each row
  execute function internal.payment_suggestion_parts_check_sum();

-- ---------------------------------------------------------------------------
-- RLS and grants
-- ---------------------------------------------------------------------------

alter table public.payment_suggestions enable row level security;
alter table public.payment_suggestion_parts enable row level security;

create policy payment_suggestions_select_parent
  on public.payment_suggestions
  for select
  to authenticated
  using (internal.is_household_parent(household_id));

create policy payment_suggestions_select_self
  on public.payment_suggestions
  for select
  to authenticated
  using (member_id = internal.current_household_member_id(household_id));

create policy payment_suggestion_parts_select_parent
  on public.payment_suggestion_parts
  for select
  to authenticated
  using (internal.is_household_parent(household_id));

create policy payment_suggestion_parts_select_self
  on public.payment_suggestion_parts
  for select
  to authenticated
  using (member_id = internal.current_household_member_id(household_id));

revoke all on table public.payment_suggestions from anon, authenticated;
grant select on table public.payment_suggestions to authenticated;
revoke all on table public.payment_suggestion_parts from anon, authenticated;
grant select on table public.payment_suggestion_parts to authenticated;

-- ---------------------------------------------------------------------------
-- internal.parse_suggestion_parts: validate a parts array (decision 4)
-- ---------------------------------------------------------------------------
--
-- Returns the normalized parts in the caller's order. NULL = whole amount on
-- Everyday. Not a public entry point.

create or replace function internal.parse_suggestion_parts(
  p_household_id uuid,
  p_amount_cents bigint,
  p_parts jsonb
)
returns table (tracked_balance_id uuid, amount_cents bigint, ord integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_balance_ids uuid[] := '{}';
  v_amounts bigint[] := '{}';
  v_element jsonb;
  v_keys text[];
  v_balance_id uuid;
  v_amount numeric;
  v_balance public.tracked_balances;
  v_total numeric := 0;
begin
  if p_parts is null then
    select tb.id into v_balance_id
      from public.tracked_balances tb
      where tb.household_id = p_household_id and tb.is_everyday;
    v_balance_ids := array[v_balance_id];
    v_amounts := array[p_amount_cents];
  else
    if jsonb_typeof(p_parts) <> 'array' or jsonb_array_length(p_parts) = 0 then
      raise exception 'parts must be a non-empty JSON array'
        using errcode = 'check_violation';
    end if;

    for v_element in select e from jsonb_array_elements(p_parts) as e loop
      if jsonb_typeof(v_element) <> 'object' then
        raise exception 'each part must be an object with tracked_balance_id and amount_cents'
          using errcode = 'check_violation';
      end if;

      select array_agg(k order by k) into v_keys from jsonb_object_keys(v_element) as k;
      if v_keys is distinct from array['amount_cents', 'tracked_balance_id'] then
        raise exception 'each part must have exactly the keys tracked_balance_id and amount_cents'
          using errcode = 'check_violation';
      end if;

      if jsonb_typeof(v_element -> 'tracked_balance_id') <> 'string' then
        raise exception 'part tracked_balance_id must be a uuid string'
          using errcode = 'check_violation';
      end if;
      begin
        v_balance_id := (v_element ->> 'tracked_balance_id')::uuid;
      exception
        when invalid_text_representation then
          raise exception 'part tracked_balance_id must be a uuid string'
            using errcode = 'check_violation';
      end;

      if jsonb_typeof(v_element -> 'amount_cents') <> 'number' then
        raise exception 'part amount_cents must be a JSON number'
          using errcode = 'check_violation';
      end if;
      v_amount := (v_element ->> 'amount_cents')::numeric;
      if scale(v_amount) <> 0 or v_amount <= 0 or v_amount > 9223372036854775807 then
        raise exception 'part amount_cents must be a positive whole number of cents, got %', v_element -> 'amount_cents'
          using errcode = 'check_violation';
      end if;

      select * into v_balance
        from public.tracked_balances tb
        where tb.id = v_balance_id and tb.household_id = p_household_id;
      if v_balance.id is null then
        raise exception 'no such balance in this household: %', v_balance_id
          using errcode = 'check_violation';
      end if;
      if not v_balance.active then
        raise exception 'balance "%" is archived and cannot be suggested', v_balance.name
          using errcode = 'check_violation';
      end if;

      if v_balance_id = any (v_balance_ids) then
        raise exception 'balance "%" appears more than once in the parts', v_balance.name
          using errcode = 'check_violation';
      end if;

      v_balance_ids := v_balance_ids || v_balance_id;
      v_amounts := v_amounts || v_amount::bigint;
      v_total := v_total + v_amount;
    end loop;

    if v_total <> p_amount_cents then
      raise exception 'parts sum to %, but the suggested payment is %', v_total, p_amount_cents
        using errcode = 'check_violation';
    end if;
  end if;

  return query
    select b.balance_id, b.amount, b.ord::integer
    from unnest(v_balance_ids, v_amounts) with ordinality as b (balance_id, amount, ord);
end;
$$;

comment on function internal.parse_suggestion_parts(uuid, bigint, jsonb) is
  'Validates a payment suggestion''s parts array (NULL = whole amount on Everyday): shape, positive whole cents, balances in the household and active, no duplicates, sum = amount. Raises check_violation. Not a public entry point.';

revoke execute on function internal.parse_suggestion_parts(uuid, bigint, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- public.create_payment_suggestion: Child, self only
-- ---------------------------------------------------------------------------

create or replace function public.create_payment_suggestion(
  p_member_id uuid,
  p_amount_cents bigint,
  p_suggested_on date,
  p_note text default null,
  p_parts jsonb default null
)
returns public.payment_suggestions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household_id uuid;
  v_caller_member_id uuid;
  v_caller_role text;
  v_note text;
  v_row public.payment_suggestions;
  v_parts jsonb;
begin
  select hm.household_id into v_household_id
    from public.household_members hm
    where hm.id = p_member_id;

  -- Caller first: an active Child, suggesting for themselves. A missing
  -- member (NULL household), a sibling, a Parent and a stranger all look
  -- the same.
  v_caller_member_id := internal.current_household_member_id(v_household_id);
  select hm.role into v_caller_role
    from public.household_members hm
    where hm.id = v_caller_member_id;

  if v_caller_member_id is null
     or v_caller_member_id <> p_member_id
     or v_caller_role <> 'child' then
    raise exception 'only an active Child may suggest a payment, and only for themselves'
      using errcode = '42501';
  end if;

  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'suggested amount_cents must be positive, got %', p_amount_cents
      using errcode = 'check_violation';
  end if;

  if p_suggested_on is null then
    raise exception 'a suggested date is required'
      using errcode = 'check_violation';
  end if;

  v_note := nullif(btrim(p_note), '');
  if char_length(v_note) > 500 then
    raise exception 'note is too long (at most 500 characters)'
      using errcode = 'check_violation';
  end if;

  -- Validates (and raises) before anything is written.
  select jsonb_agg(
           jsonb_build_object('tracked_balance_id', p.tracked_balance_id, 'amount_cents', p.amount_cents)
           order by p.ord)
    into v_parts
    from internal.parse_suggestion_parts(v_household_id, p_amount_cents, p_parts) p;

  insert into public.payment_suggestions (
    household_id, member_id, amount_cents, suggested_on, note, created_by
  ) values (
    v_household_id, p_member_id, p_amount_cents, p_suggested_on, v_note, v_caller_member_id
  )
  returning * into v_row;

  insert into public.payment_suggestion_parts (
    household_id, member_id, suggestion_id, tracked_balance_id, amount_cents
  )
  select v_household_id, p_member_id, v_row.id,
         (e ->> 'tracked_balance_id')::uuid, (e ->> 'amount_cents')::bigint
  from jsonb_array_elements(v_parts) as e;

  insert into public.audit_log (
    household_id, actor_user_id, entity_type, entity_id, action, new_values
  ) values (
    v_household_id, auth.uid(), 'payment_suggestions', v_row.id, 'insert',
    to_jsonb(v_row) || jsonb_build_object('parts', v_parts)
  );

  return v_row;
end;
$$;

comment on function public.create_payment_suggestion(uuid, bigint, date, text, jsonb) is
  'A Child suggests a payment for themselves: positive p_amount_cents, p_suggested_on, optional p_note (max 500), p_parts [{"tracked_balance_id": uuid, "amount_cents": positive int}, ...] summing to p_amount_cents over active balances of the household; NULL/omitted = whole amount to Everyday. Changes no balance; writes no ledger row. Child-only, self only. Audited.';

revoke execute on function public.create_payment_suggestion(uuid, bigint, date, text, jsonb) from public, anon;
grant execute on function public.create_payment_suggestion(uuid, bigint, date, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- public.withdraw_payment_suggestion: Child, own, pending only
-- ---------------------------------------------------------------------------

create or replace function public.withdraw_payment_suggestion(p_id uuid)
returns public.payment_suggestions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.payment_suggestions;
  v_new public.payment_suggestions;
  v_caller_member_id uuid;
begin
  select * into v_old
    from public.payment_suggestions
    where id = p_id
    for update;

  -- Role/ownership first, against the row's own household: a missing row
  -- and someone else's row look identical.
  v_caller_member_id := internal.current_household_member_id(v_old.household_id);
  if v_old.id is null or v_caller_member_id is null or v_caller_member_id <> v_old.member_id then
    raise exception 'only the Child who made a payment suggestion may withdraw it'
      using errcode = '42501';
  end if;

  if v_old.status <> 'pending' then
    raise exception 'payment suggestion % is already % and cannot be withdrawn', p_id, v_old.status
      using errcode = 'check_violation';
  end if;

  update public.payment_suggestions
     set status = 'withdrawn',
         resolved_at = now(),
         resolved_by = v_caller_member_id
   where id = p_id
   returning * into v_new;

  insert into public.audit_log (
    household_id, actor_user_id, entity_type, entity_id, action, old_values, new_values
  ) values (
    v_old.household_id, auth.uid(), 'payment_suggestions', v_old.id, 'withdraw',
    to_jsonb(v_old), to_jsonb(v_new)
  );

  return v_new;
end;
$$;

comment on function public.withdraw_payment_suggestion(uuid) is
  'The Child who made a payment suggestion withdraws it while it is still pending. Terminal. Audited.';

revoke execute on function public.withdraw_payment_suggestion(uuid) from public, anon;
grant execute on function public.withdraw_payment_suggestion(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- public.dismiss_payment_suggestion: Parent, pending only
-- ---------------------------------------------------------------------------

create or replace function public.dismiss_payment_suggestion(
  p_id uuid,
  p_reason text default null
)
returns public.payment_suggestions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.payment_suggestions;
  v_new public.payment_suggestions;
  v_caller_member_id uuid;
  v_reason text;
begin
  select * into v_old
    from public.payment_suggestions
    where id = p_id
    for update;

  if not internal.is_household_parent(v_old.household_id) then
    raise exception 'only an active Parent of this household may dismiss a payment suggestion'
      using errcode = '42501';
  end if;

  v_reason := nullif(btrim(p_reason), '');
  if char_length(v_reason) > 500 then
    raise exception 'reason is too long (at most 500 characters)'
      using errcode = 'check_violation';
  end if;

  if v_old.status <> 'pending' then
    raise exception 'payment suggestion % is already % and cannot be dismissed', p_id, v_old.status
      using errcode = 'check_violation';
  end if;

  v_caller_member_id := internal.current_household_member_id(v_old.household_id);

  update public.payment_suggestions
     set status = 'dismissed',
         resolved_at = now(),
         resolved_by = v_caller_member_id,
         resolution_note = v_reason
   where id = p_id
   returning * into v_new;

  insert into public.audit_log (
    household_id, actor_user_id, entity_type, entity_id, action, old_values, new_values
  ) values (
    v_old.household_id, auth.uid(), 'payment_suggestions', v_old.id, 'dismiss',
    to_jsonb(v_old), to_jsonb(v_new)
  );

  return v_new;
end;
$$;

comment on function public.dismiss_payment_suggestion(uuid, text) is
  'A Parent of the suggestion''s household dismisses a pending payment suggestion, with an optional reason (max 500). Terminal. Audited.';

revoke execute on function public.dismiss_payment_suggestion(uuid, text) from public, anon;
grant execute on function public.dismiss_payment_suggestion(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- public.record_payment: trailing p_suggestion_id (decision 6)
-- ---------------------------------------------------------------------------
--
-- Dropped and recreated (not overloaded) so PostgREST still resolves exactly
-- one record_payment; every older call shape stays valid because the new
-- parameter is trailing with a default. internal.record_balance_decrease and
-- record_adjustment are untouched.

drop function if exists public.record_payment(uuid, bigint, text, date, uuid, text, jsonb);

create or replace function public.record_payment(
  p_member_id uuid,
  p_amount_cents bigint,
  p_description text,
  p_occurred_on date,
  p_category_id uuid default null,
  p_note text default null,
  p_allocations jsonb default null,
  p_suggestion_id uuid default null
)
returns public.ledger_transactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.ledger_transactions;
  v_old public.payment_suggestions;
  v_new public.payment_suggestions;
begin
  -- Authorizes (Parent-only), validates, writes the payment, its parts and
  -- its audit row. Raises on any failure.
  v_row := internal.record_balance_decrease(
    p_member_id, p_amount_cents, 'payment', p_description, p_occurred_on,
    p_category_id, p_note, p_allocations
  );

  if p_suggestion_id is not null then
    select * into v_old
      from public.payment_suggestions
      where id = p_suggestion_id
      for update;

    -- A suggestion in another household reads as missing.
    if v_old.id is null or v_old.household_id <> v_row.household_id then
      raise exception 'no such payment suggestion in this household: %', p_suggestion_id
        using errcode = 'check_violation';
    end if;

    if v_old.member_id <> v_row.member_id then
      raise exception 'payment suggestion % is for a different household member', p_suggestion_id
        using errcode = 'check_violation';
    end if;

    if v_old.status <> 'pending' then
      raise exception 'payment suggestion % is already % and cannot be used', p_suggestion_id, v_old.status
        using errcode = 'check_violation';
    end if;

    update public.payment_suggestions
       set status = 'converted',
           resolved_at = now(),
           resolved_by = v_row.created_by,
           converted_transaction_id = v_row.id,
           converted_transaction_type = 'payment'
     where id = p_suggestion_id
     returning * into v_new;

    insert into public.audit_log (
      household_id, actor_user_id, entity_type, entity_id, action, old_values, new_values
    ) values (
      v_old.household_id, auth.uid(), 'payment_suggestions', v_old.id, 'convert',
      to_jsonb(v_old), to_jsonb(v_new)
    );
  end if;

  return v_row;
end;
$$;

comment on function public.record_payment(uuid, bigint, text, date, uuid, text, jsonb, uuid) is
  'Record a payment (amount_cents < 0) against p_member_id. Parent-only. p_allocations: [{"tracked_balance_id": uuid, "amount_cents": positive int}, ...] summing to -p_amount_cents; NULL/omitted = whole amount to Everyday. p_suggestion_id: a pending payment suggestion of the same member and household, marked converted in the same transaction (single-use); the payment''s own amount and split are whatever is submitted.';

revoke execute on function public.record_payment(uuid, bigint, text, date, uuid, text, jsonb, uuid) from public, anon;
grant execute on function public.record_payment(uuid, bigint, text, date, uuid, text, jsonb, uuid) to authenticated;
