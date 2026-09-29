-- Family Ledger: M6.2 -- public.add_household_member SQL groundwork (the
-- non-Auth half of the add-member flow).
--
-- household_members has carried RLS enabled with NO INSERT policy since
-- Phase 0, and M6.1's header comment explains why that is permanent, not an
-- oversight: a future invite Edge Function will create the auth.users row
-- itself via the Auth Admin API (using the service_role key, which bypasses
-- RLS entirely) and does not need a PostgREST-reachable INSERT policy to do
-- it. This migration is the OTHER half of that flow -- the household_members
-- row -- and it deliberately is NOT the Edge Function itself (that is a
-- separate task, M6.3). It assumes p_user_id already names a real,
-- already-created auth.users row; creating that row is entirely outside this
-- function's job and outside this SQL layer's reach.
--
-- Design choices worth calling out for later tasks:
--
--   * This is a SECURITY DEFINER function in `public`, following the exact
--     shape of P1.3's record_expense/record_payment/record_adjustment
--     (20260904233000_ledger_write_functions.sql): re-derive the caller's
--     own role from auth.uid() via internal.is_household_parent (never trust
--     a client-supplied household_id/role pair on its own), validate, INSERT
--     + write a matching audit_log row in the same implicit transaction, then
--     revoke from public/anon and grant only to authenticated.
--   * The future Edge Function calls this AFTER creating the auth.users row,
--     using the CALLING PARENT's own JWT (not service_role) -- so this
--     function's own is_household_parent(p_household_id) check is exactly
--     what stops a non-Parent (or a Parent of a different household) from
--     using it to plant a row. Nothing here trusts "some Edge Function called
--     me" as an implicit authorization signal; the check is caller-derived,
--     same as every other SECURITY DEFINER entry point in this project.
--   * New members are created directly `status = 'active'`, per the design
--     spec's decision for this flow -- there is no 'invited' intermediate
--     state here (the constant literal is passed explicitly, not defaulted
--     by the table, so that intent is visible at the call site rather than
--     riding on household_members.status's table-level default of
--     'invited', which exists for a different, not-yet-built flow).
--   * p_role is still validated explicitly even though
--     household_members_role_check already enforces the same values at the
--     column level -- matching record_expense/record_balance_decrease's
--     "defense in depth, and a clearer error than a raw constraint-violation
--     message" pattern rather than relying solely on the CHECK.
--   * Duplicate-(household_id, user_id) is pre-checked explicitly for the
--     same reason: household_members_household_id_user_id_key (the partial
--     unique index from Phase 0) already enforces this at the constraint
--     level, so the pre-check exists only to surface a clean, expected
--     application error instead of a raw 23505 unique-violation reaching the
--     caller. The underlying index is untouched and remains the real
--     backstop -- this function has no INSERT policy alternative to fall
--     back on if the pre-check were ever wrong, so the constraint is what
--     actually matters. This migration deliberately does NOT add any
--     constraint against the same user_id appearing in a DIFFERENT
--     household's household_members: nothing in the existing schema
--     (Phase 0's partial unique index is scoped per household_id) or in
--     ARCHITECTURE.md forbids one auth user from holding membership rows in
--     more than one household, and inventing that restriction here would be
--     scope beyond this task's acceptance criteria, which only name the
--     same-household duplicate case. A Parent adding a user_id who already
--     belongs to some OTHER household therefore succeeds -- this function
--     only ever authorizes and scopes by p_household_id, and never reveals
--     anything about the target user's membership elsewhere.
--   * p_user_id is required (not null): unlike household_members.user_id
--     itself, which is nullable to support the invited-with-no-account state
--     used by a different flow, this function's entire contract per the task
--     spec is "the auth.users row already exists" -- a null here would only
--     ever be a caller bug (the Edge Function skipped the Admin API step),
--     so it fails loudly rather than silently inserting an unlinked row that
--     the invited-member flow was never asked to produce.

create or replace function public.add_household_member(
  p_household_id uuid,
  p_user_id uuid,
  p_name text,
  p_role text
)
returns public.household_members
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.household_members;
begin
  -- Caller must be an active Parent of p_household_id, re-derived from
  -- auth.uid() -- never trust a client-supplied household_id/role pair on
  -- its own. Rejecting here, before touching household_members at all,
  -- discloses nothing about p_household_id's existence or contents beyond
  -- "you may not add a member to it".
  if not internal.is_household_parent(p_household_id) then
    raise exception 'only an active Parent of this household may add a member'
      using errcode = '42501';
  end if;

  if p_user_id is null then
    raise exception 'p_user_id is required -- the auth.users row must already exist'
      using errcode = 'check_violation';
  end if;

  if p_name is null or length(trim(both from p_name)) = 0 then
    raise exception 'p_name is required'
      using errcode = 'check_violation';
  end if;

  if p_role not in ('parent', 'child') then
    raise exception 'role must be ''parent'' or ''child'', got %', p_role
      using errcode = 'check_violation';
  end if;

  -- Clean, explicit duplicate check -- household_members_household_id_
  -- user_id_key (the partial unique index) is the real backstop and remains
  -- untouched; this only turns what would otherwise be a raw 23505 into an
  -- expected, application-level error.
  if exists (
    select 1
    from public.household_members hm
    where hm.household_id = p_household_id
      and hm.user_id = p_user_id
  ) then
    raise exception 'this user is already a member of this household'
      using errcode = 'unique_violation';
  end if;

  insert into public.household_members (
    household_id, user_id, name, role, status
  ) values (
    p_household_id, p_user_id, p_name, p_role, 'active'
  )
  returning * into v_row;

  insert into public.audit_log (
    household_id, actor_user_id, entity_type, entity_id, action, new_values
  ) values (
    p_household_id, auth.uid(), 'household_members', v_row.id, 'created', to_jsonb(v_row)
  );

  return v_row;
end;
$$;

comment on function public.add_household_member(uuid, uuid, text, text) is
  'Add a new active household_members row (household_id, user_id, name, role) to p_household_id. Parent-only, scoped to the caller''s own household (re-derived from auth.uid(), never client input). Assumes p_user_id already names a real auth.users row -- creating that row (the invite Edge Function''s Admin API step) is out of scope here. Writes exactly one household_members INSERT + one audit_log ''created'' row.';

revoke execute on function public.add_household_member(uuid, uuid, text, text) from public, anon;
grant execute on function public.add_household_member(uuid, uuid, text, text) to authenticated;
