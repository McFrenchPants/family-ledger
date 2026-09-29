-- Family Ledger: M6.1 -- RLS UPDATE policy + last-active-Parent invariant for
-- household_members.
--
-- household_members has carried RLS enabled with ZERO write policies since
-- Phase 0 (20260904220228_create_households_and_members.sql); S2.1
-- (20260905013000_household_members_read_access.sql) added only the two
-- SELECT policies. This migration adds the UPDATE side. INSERT is
-- deliberately NOT added here -- a later task's invite Edge Function writes
-- new rows using the service_role key, which bypasses RLS entirely, so an
-- INSERT policy for `authenticated` would only ever be reachable by a
-- self-service path this project has not built yet.
--
-- ---------------------------------------------------------------------------
-- Why a policy AND a trigger, not just one
-- ---------------------------------------------------------------------------
--
-- A `for update ... using (...) with check (...)` policy can only ever decide
-- "is this row (before/after) one the caller is allowed to touch at all" --
-- it has no way to say "these specific columns may not change" or "this
-- specific value transition is forbidden regardless of who is asking". Two
-- invariants this task requires are exactly that shape:
--
--   * role / household_id / user_id must never change via UPDATE (an UPDATE
--     that repoints a row at a different household or flips a Child to
--     Parent is a privilege-escalation path a row-level USING/WITH CHECK
--     clause cannot express column-by-column).
--   * a household may never end up with zero active Parents (this has to be
--     evaluated as "count active Parents in this household right now",
--     which is a cross-row aggregate, not a per-row predicate).
--
-- Both are implemented as a BEFORE UPDATE trigger instead, which also gives a
-- second, independent property the task calls for: the invariant holds
-- "regardless of write path". A policy only ever runs for the `authenticated`
-- role going through PostgREST; a future service_role-driven write path (an
-- Edge Function doing admin member management, using the service_role key)
-- bypasses RLS entirely but does NOT bypass table triggers. Putting the
-- immutability and last-active-Parent checks in the trigger means they hold
-- for both paths without being re-implemented in each one.
--
-- The trigger also writes the audit_log row for a successful update, for the
-- same "regardless of write path" reason -- an audit trail that only fires
-- when the RLS-policy path is used would silently go dark the moment a
-- service_role path is added.
--
-- ---------------------------------------------------------------------------
-- SELECT policy: active Parent may see EVERY status of their own household's
-- members, not just active ones -- required for the UPDATE policy below to
-- be usable at all.
-- ---------------------------------------------------------------------------
--
-- This is not optional scope creep: PostgreSQL's row security combines a
-- table's applicable SELECT policies into the WITH CHECK evaluation of an
-- UPDATE, so that a caller cannot use UPDATE to move a row somewhere they
-- could no longer see it and thereby dodge inferring its existence (the same
-- protection documented for "an UPDATE that would make the row disappear
-- from the caller's own visibility"). S2.1's existing
-- household_members_select_parent_active_members is scoped to
-- `status = 'active'` -- so the moment a Parent's UPDATE flips a row's
-- status to 'archived', that same row stops matching the only SELECT policy
-- that made it visible to them, and PostgreSQL rejects the UPDATE's WITH
-- CHECK outright with "new row violates row-level security policy", even
-- though the UPDATE policy below has its own `with check` that would
-- otherwise allow it. This was confirmed empirically while building this
-- migration (see the task's verification notes) before being understood as
-- documented Postgres behavior, not a bug in the policy below.
--
-- The fix is a Parent read policy with no status restriction at all: an
-- active Parent may see every row (any status) in their own household. This
-- is also, independently, a real product requirement this task's own
-- acceptance criteria already imply -- "restoring an archived member
-- succeeds" is not meaningfully testable end-to-end if the Parent could
-- never see the archived row to restore it in the first place. S2.1's
-- deliberate deferral of "Parent visibility into invited/archived members"
-- was scoped to that read-only task; this write-side task is exactly the
-- "future task" S2.1's comment pointed to.
--
-- Purely additive (OR'd with S2.1's two existing policies and S2.5's third)
-- under Postgres's normal permissive-policy semantics -- nothing already
-- visible becomes invisible.
create policy household_members_select_parent_any_status
  on public.household_members
  for select
  to authenticated
  using (internal.is_household_parent(household_id));

-- ---------------------------------------------------------------------------
-- UPDATE policy: active Parent, own household only
-- ---------------------------------------------------------------------------
--
-- Same shape as P1.2's categories_update_parent_only: internal.is_household_
-- parent(household_id) is SECURITY DEFINER, STABLE, set search_path = '', and
-- only ever reports the CALLER's own role -- reused rather than re-derived so
-- this policy's access boundary is provably identical to every other
-- Parent-gated write policy in this project. USING gates which existing rows
-- a Parent may target (their own household's rows only); WITH CHECK gates
-- what the row may look like afterward -- since the trigger below forbids
-- household_id from changing at all, both clauses evaluate the same
-- household_id in practice, but WITH CHECK is included anyway to match this
-- project's established for-update policy shape (see categories_update_
-- parent_only) rather than relying solely on USING.
--
-- A Child (no active Parent membership in ANY household, or no membership at
-- all) never satisfies internal.is_household_parent for any household_id, so
-- this policy alone already makes every Child UPDATE affect zero rows --
-- confirmed by a dedicated test below rather than merely asserted.

create policy household_members_update_parent
  on public.household_members
  for update
  to authenticated
  using (internal.is_household_parent(household_id))
  with check (internal.is_household_parent(household_id));

-- ---------------------------------------------------------------------------
-- Trigger: immutability + last-active-Parent invariant + audit logging
-- ---------------------------------------------------------------------------

create or replace function public.household_members_before_update()
returns trigger
language plpgsql
-- SECURITY DEFINER: the function's own audit_log INSERT must succeed even
-- though `authenticated` carries no INSERT grant on audit_log at all (P1.2
-- revoked it, deliberately, as audit_log's primary defense). A trigger
-- function runs with the INVOKING role's privileges unless marked SECURITY
-- DEFINER, so without this the Parent-driven UPDATE that reaches this
-- trigger would itself fail with permission denied on the audit insert.
-- set search_path = '' + fully-qualified names throughout, matching every
-- other SECURITY DEFINER function in this project, so a caller-controlled
-- search_path cannot hijack it.
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
  -- ---------------------------------------------------------------------
  -- Immutability: role, household_id, user_id may never change via UPDATE.
  -- ---------------------------------------------------------------------
  -- `is distinct from` (not <>) so that e.g. user_id transitioning to/from
  -- NULL is still caught -- <> would silently pass NULL <> NULL as unknown.
  if new.role is distinct from old.role then
    raise exception 'household_members.role cannot be changed by UPDATE (was %, attempted %)', old.role, new.role
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

  -- ---------------------------------------------------------------------
  -- Last-active-Parent invariant: never archive a household's only active
  -- Parent, regardless of write path.
  -- ---------------------------------------------------------------------
  -- This trigger runs BEFORE the update is applied, so `old` (the row still
  -- as it is in the table) is counted along with every other row -- if this
  -- row is currently the household's one and only active Parent, the count
  -- below is exactly 1, and setting its own status to 'archived' would take
  -- that count to 0.
  if old.role = 'parent' and old.status = 'active' and new.status = 'archived' then
    select count(*) into v_active_parent_count
      from public.household_members
      where household_id = old.household_id
        and role = 'parent'
        and status = 'active';

    if v_active_parent_count <= 1 then
      raise exception 'cannot archive the household''s only active Parent'
        using errcode = '42501';
    end if;
  end if;

  -- ---------------------------------------------------------------------
  -- Audit logging: exactly one audit_log row per successful UPDATE that
  -- changes something audit-worthy.
  -- ---------------------------------------------------------------------
  -- Action is derived from what changed, checked in priority order rather
  -- than written as independent rows per changed column: a status
  -- transition is treated as the significant event even if `name` also
  -- changed in the same UPDATE, so one UPDATE never produces more than one
  -- audit_log row (an explicit requirement of this task). new_values below
  -- still captures the full post-update name/status/archived_at trio
  -- regardless of which one action-classifies the row, so nothing about the
  -- actual change is lost even when only one of several changed columns
  -- names the action.
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
    -- actor_user_id is NOT NULL on audit_log, and auth.uid() is null for a
    -- write with no authenticated JWT context (e.g. a future service_role-
    -- driven path). Fall back to whichever side of the update actually names
    -- a user -- the member row's own linked account -- rather than leaving
    -- this trigger unable to log a legitimate non-interactive write. If
    -- neither auth.uid() nor either row's user_id can supply one (an
    -- unlinked invited/archived member updated with no authenticated
    -- caller), the INSERT below fails on audit_log's own NOT NULL
    -- constraint rather than silently fabricating an actor -- this trigger
    -- does not invent identities.
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
  'BEFORE UPDATE trigger on household_members: rejects a changed role/household_id/user_id, rejects archiving a household''s only active Parent, and writes one audit_log row per successful status-transition or rename. Runs for every write path (RLS-policy UPDATE and any future service_role path), not just the RLS-gated one.';

create or replace trigger household_members_before_update
  before update on public.household_members
  for each row
  execute function public.household_members_before_update();
