-- Family Ledger: CB1 -- tracked balances and the per-balance read path.
--
-- Backlog 16 (category balances), design: docs/proposals/category-balances/
-- DESIGN_SPEC.md R1, plan task CB1.
--
-- A child's single balance gets broken down into named "tracked balances"
-- (e.g. Car, College) plus exactly one Everyday balance per household. A
-- Parent points categories at a tracked balance; several categories may feed
-- one. An expense lands in its category's tracked balance; an expense with no
-- category, or whose category is not mapped, lands in Everyday. In CB1 every
-- payment and adjustment lands in Everyday (CB2 replaces that with explicit
-- allocation parts).
--
-- The TOTAL never changes: public.household_member_balances is untouched and
-- the new read function public.household_member_balance_breakdown partitions
-- exactly the same rows (non-voided ledger_transactions per member) into
-- balances, so per member the parts always sum to the existing total.
--
-- Contents:
--   * public.tracked_balances (+ guard trigger, + Everyday backfill, + a
--     households AFTER INSERT trigger that creates Everyday automatically)
--   * public.categories.tracked_balance_id (NULL = Everyday)
--   * RLS / grants: members read tracked_balances; no direct writes for any
--     app role; categories.tracked_balance_id not writable directly
--   * public.create_tracked_balance / update_tracked_balance /
--     set_category_balance (Parent-only, SECURITY DEFINER, audited)
--   * public.household_member_balance_breakdown (read)
--
-- ---------------------------------------------------------------------------
-- Decisions taken here (documented for later CB tasks)
-- ---------------------------------------------------------------------------
--
-- 1. Everyday's identity is the is_everyday flag, never its name. It may be
--    renamed or reordered like any balance, but it can never be archived,
--    deleted, or have is_everyday flipped, and no second Everyday can exist.
--    Enforced in the database (partial unique index + guard trigger), not
--    only in the write functions.
-- 2. Archiving a tracked balance that any category still points at is
--    REJECTED (check_violation) with a message telling the Parent to move
--    those categories first. That keeps "an archived balance never receives
--    new expenses" true without silently re-routing anything. Enforced by the
--    guard trigger so it holds for every writer, not only the function.
-- 3. set_category_balance normalizes the Everyday row's id to NULL, so there
--    is exactly one stored spelling of "feeds Everyday". The breakdown still
--    treats a stored Everyday id and NULL identically (it coalesces to the
--    Everyday id), so a row written some other way could not split totals.
-- 4. update_tracked_balance treats a NULL argument as "leave unchanged", so
--    a sort_order, once set, cannot be cleared back to NULL through it. An
--    all-NULL call is rejected rather than writing an empty audit row.
-- 5. categories keeps its existing Parent-only RLS, but the table-level
--    INSERT/UPDATE grants are narrowed to the pre-existing columns so that
--    tracked_balance_id can only ever be written by set_category_balance
--    (which audits). Same column-grant technique as
--    20260908090000_account_management_member_changes.sql. The front end's
--    current category writes (insert household_id/name/sort_order, update
--    name/active) are all still covered.

-- ---------------------------------------------------------------------------
-- public.tracked_balances
-- ---------------------------------------------------------------------------

create table if not exists public.tracked_balances (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null
    references public.households (id) on delete cascade,
  name text not null,
  sort_order integer,
  active boolean not null default true,
  is_everyday boolean not null default false,
  created_at timestamptz not null default now(),

  -- Stored trimmed, never empty, bounded. The write functions trim before
  -- inserting; this makes the database refuse anything else regardless of
  -- writer.
  constraint tracked_balances_name_check
    check (name = btrim(name) and char_length(name) between 1 and 60),

  -- Everyday can never be inactive (also enforced, with a clearer message,
  -- by the guard trigger below; this CHECK is the declarative backstop).
  constraint tracked_balances_everyday_active_check
    check (not is_everyday or active),

  -- Lets other tables (categories now; payment_allocations, payment_plans
  -- etc. in later CB tasks) enforce "same household" with a plain composite
  -- FK, exactly as categories_id_household_id_key does for categories.
  constraint tracked_balances_id_household_id_key unique (id, household_id)
);

comment on table public.tracked_balances is
  'Named parts of a child''s balance (e.g. Car, College) plus exactly one Everyday row per household. Balances are derived at read time; nothing here stores an amount.';
comment on column public.tracked_balances.is_everyday is
  'True for the household''s single catch-all balance. Immutable; that row cannot be archived or deleted (tracked_balances_guard trigger).';

-- Exactly one Everyday per household.
create unique index if not exists tracked_balances_one_everyday_per_household_key
  on public.tracked_balances (household_id)
  where is_everyday;

-- Names unique per household, case-insensitively, across active and archived
-- rows alike (restoring an archived balance can then never collide).
create unique index if not exists tracked_balances_household_name_key
  on public.tracked_balances (household_id, lower(name));

-- ---------------------------------------------------------------------------
-- Guard trigger: Everyday immutability + archive-while-mapped
-- ---------------------------------------------------------------------------

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

  return new;
end;
$$;

comment on function internal.tracked_balances_guard() is
  'BEFORE UPDATE/DELETE trigger on tracked_balances: Everyday cannot be archived, deleted (except by household cascade) or lose is_everyday; no row may change household; a balance that categories still point at cannot be archived.';

revoke execute on function internal.tracked_balances_guard() from public, anon, authenticated;

create or replace trigger tracked_balances_guard
  before update or delete on public.tracked_balances
  for each row
  execute function internal.tracked_balances_guard();

-- ---------------------------------------------------------------------------
-- Everyday for every household: backfill + new-household trigger
-- ---------------------------------------------------------------------------

insert into public.tracked_balances (household_id, name, sort_order, is_everyday)
select h.id, 'Everyday', 0, true
from public.households h
on conflict (household_id) where is_everyday do nothing;

-- SECURITY DEFINER so household creation keeps working for whichever role
-- inserts the household (service role bootstrap today), even though no app
-- role holds INSERT on tracked_balances. It writes only a fixed row derived
-- from NEW; it takes no caller input. Lives in `internal` (not exposed via
-- the Data API) and is not executable by app roles directly.
create or replace function internal.create_everyday_balance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- NOT EXISTS rather than ON CONFLICT: household creation must not depend
  -- on the partial unique index existing (that index is the separate,
  -- independently tested backstop against a second Everyday).
  insert into public.tracked_balances (household_id, name, sort_order, is_everyday)
  select new.id, 'Everyday', 0, true
  where not exists (
    select 1 from public.tracked_balances tb
    where tb.household_id = new.id and tb.is_everyday
  );
  return new;
end;
$$;

comment on function internal.create_everyday_balance() is
  'AFTER INSERT trigger on households: creates the household''s Everyday tracked balance.';

revoke execute on function internal.create_everyday_balance() from public, anon, authenticated;

create or replace trigger households_create_everyday_balance
  after insert on public.households
  for each row
  execute function internal.create_everyday_balance();

-- ---------------------------------------------------------------------------
-- categories.tracked_balance_id
-- ---------------------------------------------------------------------------

alter table public.categories
  add column if not exists tracked_balance_id uuid;

-- MATCH SIMPLE: NULL (the default, meaning Everyday) is exempt. When set it
-- must name a balance in the category's own household.
alter table public.categories
  add constraint categories_tracked_balance_household_fk
    foreign key (tracked_balance_id, household_id)
    references public.tracked_balances (id, household_id);

comment on column public.categories.tracked_balance_id is
  'The tracked balance this category''s expenses feed. NULL = Everyday. Written only via public.set_category_balance (audited).';

create index if not exists categories_tracked_balance_id_idx
  on public.categories (tracked_balance_id);

-- ---------------------------------------------------------------------------
-- RLS and grants
-- ---------------------------------------------------------------------------

alter table public.tracked_balances enable row level security;

create policy tracked_balances_select_household_members
  on public.tracked_balances
  for select
  to authenticated
  using (internal.is_household_member(household_id));

-- Two layers, as for audit_log: no write grants at all (primary), and no
-- write policies (secondary). Writes go only through the functions below.
revoke all on table public.tracked_balances from anon, authenticated;
grant select on table public.tracked_balances to authenticated;

-- categories: keep the Parent-only RLS policies exactly as they are, but
-- make tracked_balance_id unreachable by direct INSERT/UPDATE from any app
-- role (see decision 5 in the header).
revoke insert, update on table public.categories from anon, authenticated;
grant insert (id, household_id, name, sort_order, active)
  on table public.categories to authenticated;
grant update (name, sort_order, active)
  on table public.categories to authenticated;

-- ---------------------------------------------------------------------------
-- public.create_tracked_balance: Parent-only
-- ---------------------------------------------------------------------------
--
-- p_household_id is client-supplied here because there is no parent row to
-- derive it from; the caller must be an active Parent of exactly that
-- household, checked before anything else.

create or replace function public.create_tracked_balance(
  p_household_id uuid,
  p_name text,
  p_sort_order integer default null
)
returns public.tracked_balances
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_new public.tracked_balances;
begin
  if not internal.is_household_parent(p_household_id) then
    raise exception 'only an active Parent may create a tracked balance'
      using errcode = '42501';
  end if;

  v_name := btrim(p_name);
  if v_name is null or v_name = '' then
    raise exception 'a balance name is required'
      using errcode = 'check_violation';
  end if;

  begin
    insert into public.tracked_balances (household_id, name, sort_order)
    values (p_household_id, v_name, p_sort_order)
    returning * into v_new;
  exception
    when unique_violation then
      raise exception 'a balance named "%" already exists', v_name
        using errcode = 'unique_violation';
  end;

  insert into public.audit_log (
    household_id, actor_user_id, entity_type, entity_id, action, old_values, new_values
  ) values (
    p_household_id, auth.uid(), 'tracked_balances', v_new.id, 'create',
    null, to_jsonb(v_new)
  );

  return v_new;
end;
$$;

comment on function public.create_tracked_balance(uuid, text, integer) is
  'Create a tracked balance in p_household_id. Parent of that household only. Name trimmed, 1-60 chars, unique per household (case-insensitive). Audited.';

revoke execute on function public.create_tracked_balance(uuid, text, integer) from public, anon;
grant execute on function public.create_tracked_balance(uuid, text, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- public.update_tracked_balance: Parent-only rename / reorder / archive / restore
-- ---------------------------------------------------------------------------

create or replace function public.update_tracked_balance(
  p_id uuid,
  p_name text default null,
  p_sort_order integer default null,
  p_active boolean default null
)
returns public.tracked_balances
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.tracked_balances;
  v_new public.tracked_balances;
  v_name text;
begin
  select * into v_old
    from public.tracked_balances
    where id = p_id;

  -- Role check first, against the household derived from the row: a
  -- missing row (NULL household) and a foreign household look identical.
  if not internal.is_household_parent(v_old.household_id) then
    raise exception 'only an active Parent of this balance''s household may change it'
      using errcode = '42501';
  end if;

  if p_name is null and p_sort_order is null and p_active is null then
    raise exception 'nothing to update'
      using errcode = 'check_violation';
  end if;

  if p_name is not null then
    v_name := btrim(p_name);
    if v_name = '' then
      raise exception 'a balance name is required'
        using errcode = 'check_violation';
    end if;
  end if;

  -- Archive rules (Everyday; still-mapped categories) are enforced by the
  -- tracked_balances_guard trigger, whose messages surface unchanged.
  begin
    update public.tracked_balances
       set name = coalesce(v_name, name),
           sort_order = coalesce(p_sort_order, sort_order),
           active = coalesce(p_active, active)
     where id = p_id
     returning * into v_new;
  exception
    when unique_violation then
      raise exception 'a balance named "%" already exists', v_name
        using errcode = 'unique_violation';
  end;

  insert into public.audit_log (
    household_id, actor_user_id, entity_type, entity_id, action, old_values, new_values
  ) values (
    v_old.household_id, auth.uid(), 'tracked_balances', v_old.id,
    case
      when p_active is not null and p_active is distinct from v_old.active
        then case when p_active then 'restore' else 'archive' end
      else 'update'
    end,
    to_jsonb(v_old), to_jsonb(v_new)
  );

  return v_new;
end;
$$;

comment on function public.update_tracked_balance(uuid, text, integer, boolean) is
  'Rename / reorder / archive / restore a tracked balance. NULL arguments mean unchanged. Parent of the balance''s own household only (derived from the row). Everyday cannot be archived; a balance with categories still feeding it cannot be archived. Audited.';

revoke execute on function public.update_tracked_balance(uuid, text, integer, boolean) from public, anon;
grant execute on function public.update_tracked_balance(uuid, text, integer, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- public.set_category_balance: Parent-only category -> balance mapping
-- ---------------------------------------------------------------------------

create or replace function public.set_category_balance(
  p_category_id uuid,
  p_tracked_balance_id uuid
)
returns public.categories
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.categories;
  v_new public.categories;
  v_target public.tracked_balances;
  v_store uuid;
begin
  select * into v_old
    from public.categories
    where id = p_category_id;

  if not internal.is_household_parent(v_old.household_id) then
    raise exception 'only an active Parent of this category''s household may change which balance it feeds'
      using errcode = '42501';
  end if;

  if p_tracked_balance_id is null then
    v_store := null;
  else
    select * into v_target
      from public.tracked_balances
      where id = p_tracked_balance_id
        and household_id = v_old.household_id;

    if v_target.id is null then
      raise exception 'no such balance in this household: %', p_tracked_balance_id
        using errcode = 'no_data_found';
    end if;

    if not v_target.active then
      raise exception 'balance "%" is archived; restore it before moving categories to it', v_target.name
        using errcode = 'check_violation';
    end if;

    -- Decision 3: one stored spelling of "feeds Everyday".
    v_store := case when v_target.is_everyday then null else v_target.id end;
  end if;

  update public.categories
     set tracked_balance_id = v_store
   where id = p_category_id
   returning * into v_new;

  insert into public.audit_log (
    household_id, actor_user_id, entity_type, entity_id, action, old_values, new_values
  ) values (
    v_old.household_id, auth.uid(), 'categories', v_old.id, 'set_tracked_balance',
    to_jsonb(v_old), to_jsonb(v_new)
  );

  return v_new;
end;
$$;

comment on function public.set_category_balance(uuid, uuid) is
  'Point a category at a tracked balance (NULL or the Everyday id = Everyday, stored as NULL). Target must be an active balance in the category''s own household. Parent of that household only. Audited. Moves that category''s existing expenses in the breakdown; totals unchanged.';

revoke execute on function public.set_category_balance(uuid, uuid) from public, anon;
grant execute on function public.set_category_balance(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- public.household_member_balance_breakdown: read path
-- ---------------------------------------------------------------------------
--
-- SECURITY DEFINER, deliberately mirroring public.household_member_balances
-- (20260905010000) rather than relying on the caller's RLS: it starts from
-- the same member universe (household_members, active, in p_household_id)
-- filtered by the same re-derived caller rule -- Parent: every active member;
-- Child: only themselves; anyone else: nothing -- and reads the same rows
-- (non-voided ledger_transactions joined on member_id only, no extra
-- household filter). Using the identical row set and visibility rule is what
-- guarantees SUM(breakdown) = total per member; an INVOKER version would
-- depend on four tables' RLS policies lining up and could drift.
--
-- Output: per visible member, one Everyday row (always, even at 0) plus one
-- row per other tracked balance that has at least one non-voided row
-- attributed to it. Attribution in CB1:
--   * expense -> its category's tracked_balance_id, else Everyday
--     (no category, unmapped category, or mapping stored as the Everyday id)
--   * payment / adjustment -> Everyday (CB2 replaces with allocation parts)

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
  parts as (
    -- Everyday is always present for every visible member.
    select v.id as member_id, e.id as tracked_balance_id, 0::bigint as amount_cents
    from visible v
    cross join everyday e
    union all
    select
      lt.member_id,
      coalesce(
        case when lt.type = 'expense' then c.tracked_balance_id end,
        e.id
      ),
      lt.amount_cents
    from public.ledger_transactions lt
    join visible v on v.id = lt.member_id
    cross join everyday e
    left join public.categories c on c.id = lt.category_id
    where lt.voided_at is null
  )
  select p.member_id, p.tracked_balance_id, sum(p.amount_cents)::bigint as balance_cents
  from parts p
  group by p.member_id, p.tracked_balance_id;
$$;

comment on function public.household_member_balance_breakdown(uuid) is
  'Per visible member, balance per tracked balance: Everyday always (even 0), plus each tracked balance with non-voided activity. Expenses follow their category''s tracked_balance_id (NULL -> Everyday); payments/adjustments go to Everyday (until CB2). Same SECURITY DEFINER visibility rule and row set as household_member_balances, so the parts always sum to that total.';

revoke execute on function public.household_member_balance_breakdown(uuid) from public, anon;
grant execute on function public.household_member_balance_breakdown(uuid) to authenticated;
