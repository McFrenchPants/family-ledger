-- Family Ledger: account management -- controlled role / status changes for
-- household_members.
--
-- Until now an active Parent could change ANY mutable column of a member row
-- with a plain PostgREST UPDATE (policy household_members_update_parent, from
-- 20260905070000), and the BEFORE UPDATE trigger only guarded role /
-- household_id / user_id and the last-active-Parent rule. Account management
-- needs two things that must NOT be a free-form client write:
--
--   * changing a member's role (parent <-> child), and
--   * archiving / restoring a member, which a later server function will
--     coordinate with disabling / re-enabling that person's login.
--
-- So after this migration role and status can only change through the two
-- functions below. Everything else about the table is unchanged; `name` stays
-- directly renameable by an active Parent of the household.
--
-- ---------------------------------------------------------------------------
-- 1. Column privileges (first, independent layer)
-- ---------------------------------------------------------------------------
--
-- Supabase grants anon/authenticated table-level UPDATE on new tables. A
-- table-level UPDATE privilege cannot be narrowed by revoking one column, so
-- the table-level grant is revoked and UPDATE is granted back on `name` only.
-- A direct client UPDATE that names role, status, archived_at, household_id,
-- user_id (or id / created_at) now fails with 42501 "permission denied for
-- table household_members" before RLS or the trigger even run. The SECURITY
-- DEFINER functions run as the table owner and are unaffected.
--
-- ---------------------------------------------------------------------------
-- 2. Trigger gate for role changes (second, independent layer)
-- ---------------------------------------------------------------------------
--
-- The trigger used to reject every role change. It now permits one only when
-- the transaction-local setting `family_ledger.role_change_member_id` equals
-- the id of the very row being updated. Only change_household_member_role
-- sets it (set_config(..., is_local => true)), immediately before its UPDATE
-- of that one row, and clears it straight after.
--
-- Why this cannot be forged from the browser:
--   * PostgREST exposes only functions in the `public` schema; set_config
--     lives in pg_catalog and is not reachable as an RPC, and request bodies
--     / headers are never turned into arbitrary GUCs.
--   * Even a caller who could run arbitrary SQL as `authenticated` would also
--     need UPDATE privilege on household_members.role, which section 1
--     removed. Forging the setting therefore buys nothing: both layers would
--     have to fail together.
--   * The setting is bound to a specific row id and is transaction-local, so
--     it cannot authorise a different row or leak into a later transaction.
--   * Whether the CALLER may change the role is decided by the function (via
--     auth.uid()), not by the setting; the setting only tells the trigger
--     "this UPDATE came through the audited function".
--
-- Last-active-Parent rule: the trigger now covers both ways an active Parent
-- can stop being one -- archiving AND demotion to child -- and locks the
-- household's active Parent rows (FOR UPDATE) while counting, so two
-- concurrent demotions/archivals cannot each see "two Parents left" and
-- together leave zero. It lives in the trigger (not the functions) so it
-- holds for every write path, including service_role.
--
-- Audit rows: the trigger keeps writing 'archived' / 'restored' / 'renamed'
-- rows (so set_household_member_status writes none of its own). A role change
-- changes none of those columns, so the trigger writes nothing for it and
-- change_household_member_role writes the single 'role_changed' row.
--
-- Both functions follow public.add_household_member: SECURITY DEFINER,
-- search_path = '', authorization re-derived from auth.uid() against the
-- TARGET MEMBER'S household (never a client-supplied household id), one
-- generic 42501 message for "no such member", "other household" and
-- "not a Parent" alike, revoked from public/anon, granted to authenticated.

-- ---------------------------------------------------------------------------
-- 1. Column privileges
-- ---------------------------------------------------------------------------

revoke update on table public.household_members from anon, authenticated;
grant update (name) on table public.household_members to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Trigger: gated role change, last-active-Parent for archive AND demotion
-- ---------------------------------------------------------------------------

create or replace function public.household_members_before_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_active_parent_count integer;
  v_actor uuid;
  v_action text;
  v_old_values jsonb;
  v_new_values jsonb;
begin
  -- Role may change only inside change_household_member_role, which binds
  -- the transaction-local setting to this exact row id (see header).
  if new.role is distinct from old.role
     and coalesce(current_setting('family_ledger.role_change_member_id', true), '')
         is distinct from old.id::text then
    raise exception 'household_members.role can only be changed through change_household_member_role (was %, attempted %)', old.role, new.role
      using errcode = '42501';
  end if;

  if new.household_id is distinct from old.household_id then
    raise exception 'household_members.household_id cannot be changed by UPDATE'
      using errcode = '42501';
  end if;

  if new.user_id is distinct from old.user_id then
    raise exception 'household_members.user_id cannot be changed by UPDATE'
      using errcode = '42501';
  end if;

  -- Last-active-Parent invariant: an active Parent may stop being an active
  -- Parent (archived, or demoted to child) only if another active Parent
  -- remains. The rows are locked while counting so concurrent changes
  -- serialise. `old` is still in the table, so it is part of the count.
  if old.role = 'parent' and old.status = 'active'
     and (new.status = 'archived' or new.role <> 'parent') then
    select count(*) into v_active_parent_count
      from (
        select hm.id
          from public.household_members hm
          where hm.household_id = old.household_id
            and hm.role = 'parent'
            and hm.status = 'active'
          for update
      ) locked_parents;

    if v_active_parent_count <= 1 then
      raise exception 'cannot archive or demote the household''s only active Parent'
        using errcode = '42501';
    end if;
  end if;

  if old.status is distinct from new.status and new.status = 'archived' then
    v_action := 'archived';
  elsif old.status is distinct from new.status and new.status = 'active' then
    v_action := 'restored';
  elsif old.name is distinct from new.name then
    v_action := 'renamed';
  else
    v_action := null;
  end if;

  if v_action is not null then
    v_actor := coalesce(auth.uid(), new.user_id, old.user_id);

    v_old_values := jsonb_build_object(
      'name', old.name,
      'status', old.status,
      'archived_at', old.archived_at
    );
    v_new_values := jsonb_build_object(
      'name', new.name,
      'status', new.status,
      'archived_at', new.archived_at
    );

    insert into public.audit_log (
      household_id, actor_user_id, entity_type, entity_id, action, old_values, new_values
    ) values (
      new.household_id, v_actor, 'household_members', new.id, v_action, v_old_values, v_new_values
    );
  end if;

  return new;
end;
$$;

comment on function public.household_members_before_update() is
  'BEFORE UPDATE trigger on household_members: role changes only via change_household_member_role (row-bound transaction-local setting), rejects a changed household_id/user_id, rejects archiving or demoting a household''s only active Parent (rows locked while counting), and writes one audit_log row per successful status-transition or rename. Runs for every write path.';

-- ---------------------------------------------------------------------------
-- 3. public.change_household_member_role
-- ---------------------------------------------------------------------------
--
-- Archived members are rejected: an archived person's role is frozen so that
-- restoring them later cannot silently bring back different powers than the
-- Parent saw when archiving; restore first, then change the role.
-- 'invited' and 'active' members may be changed.

create or replace function public.change_household_member_role(
  p_member_id uuid,
  p_new_role text
)
returns public.household_members
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household_id uuid;
  v_row public.household_members;
  v_old_role text;
begin
  -- Household comes from the member row, never from the client. Missing
  -- member, other household and non-Parent all produce the same error.
  select hm.household_id into v_household_id
    from public.household_members hm
    where hm.id = p_member_id;

  if v_household_id is null or not internal.is_household_parent(v_household_id) then
    raise exception 'only an active Parent of this member''s household may change member roles'
      using errcode = '42501';
  end if;

  if p_new_role is null or p_new_role not in ('parent', 'child') then
    raise exception 'role must be ''parent'' or ''child'', got %', p_new_role
      using errcode = 'check_violation';
  end if;

  -- Lock the target row so a concurrent status/role change serialises.
  select * into v_row
    from public.household_members hm
    where hm.id = p_member_id
    for update;

  if v_row.status = 'archived' then
    raise exception 'an archived member''s role cannot be changed; restore the member first'
      using errcode = 'check_violation';
  end if;

  if v_row.role = p_new_role then
    raise exception 'member already has role %', p_new_role
      using errcode = 'check_violation';
  end if;

  v_old_role := v_row.role;

  -- Open the trigger gate for exactly this row, update, close it again.
  perform pg_catalog.set_config('family_ledger.role_change_member_id', p_member_id::text, true);

  update public.household_members
     set role = p_new_role
   where id = p_member_id
   returning * into v_row;

  perform pg_catalog.set_config('family_ledger.role_change_member_id', '', true);

  insert into public.audit_log (
    household_id, actor_user_id, entity_type, entity_id, action, old_values, new_values
  ) values (
    v_household_id, auth.uid(), 'household_members', v_row.id, 'role_changed',
    jsonb_build_object('role', v_old_role),
    jsonb_build_object('role', v_row.role)
  );

  return v_row;
end;
$$;

comment on function public.change_household_member_role(uuid, text) is
  'Change a member''s role (parent|child). Active Parent of the member''s own household only (re-derived from auth.uid()); rejects archived members, no-op changes, and demoting the household''s last active Parent (trigger). Writes exactly one audit_log ''role_changed'' row.';

revoke execute on function public.change_household_member_role(uuid, text) from public, anon;
grant execute on function public.change_household_member_role(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. public.set_household_member_status
-- ---------------------------------------------------------------------------
--
-- 'archived' requires the member to be active or invited; 'active' requires
-- archived. The audit row ('archived' / 'restored') is written by the
-- household_members_before_update trigger, so this function writes none.
-- (Disabling / re-enabling the login is a separate server function's job.)

create or replace function public.set_household_member_status(
  p_member_id uuid,
  p_new_status text
)
returns public.household_members
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household_id uuid;
  v_row public.household_members;
begin
  select hm.household_id into v_household_id
    from public.household_members hm
    where hm.id = p_member_id;

  if v_household_id is null or not internal.is_household_parent(v_household_id) then
    raise exception 'only an active Parent of this member''s household may archive or restore members'
      using errcode = '42501';
  end if;

  if p_new_status is null or p_new_status not in ('active', 'archived') then
    raise exception 'status must be ''active'' or ''archived'', got %', p_new_status
      using errcode = 'check_violation';
  end if;

  select * into v_row
    from public.household_members hm
    where hm.id = p_member_id
    for update;

  if p_new_status = 'archived' then
    if v_row.status not in ('active', 'invited') then
      raise exception 'member is already archived'
        using errcode = 'check_violation';
    end if;

    -- The trigger rejects archiving the only active Parent.
    update public.household_members
       set status = 'archived', archived_at = now()
     where id = p_member_id
     returning * into v_row;
  else
    if v_row.status <> 'archived' then
      raise exception 'only an archived member can be restored'
        using errcode = 'check_violation';
    end if;

    update public.household_members
       set status = 'active', archived_at = null
     where id = p_member_id
     returning * into v_row;
  end if;

  return v_row;
end;
$$;

comment on function public.set_household_member_status(uuid, text) is
  'Archive (active|invited -> archived) or restore (archived -> active) a member. Active Parent of the member''s own household only (re-derived from auth.uid()). The last-active-Parent rule and the audit_log row come from the household_members_before_update trigger.';

revoke execute on function public.set_household_member_status(uuid, text) from public, anon;
grant execute on function public.set_household_member_status(uuid, text) to authenticated;
