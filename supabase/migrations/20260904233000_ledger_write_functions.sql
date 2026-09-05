-- Family Ledger: P1.3 security-definer RPC functions for ledger writes.
--
-- P1.2 (20260904230000_ledger_rls_policies.sql) deliberately left
-- ledger_transactions with NO INSERT/UPDATE/DELETE policy at all: recording a
-- transaction has to check type/sign/role/household child_expense_scope
-- together, and voiding has to flip three columns atomically under a
-- Parent-only check -- more than a RLS USING/WITH CHECK clause should
-- encode. This migration adds the sanctioned write path instead: four
-- SECURITY DEFINER functions in `public` (so they ARE reachable as PostgREST
-- RPC calls -- config.toml's api.schemas includes "public"), each of which:
--
--   * re-derives the caller's own household membership and role from
--     auth.uid() via the P1.2 internal.* helpers -- NEVER from a
--     client-supplied household_id, member_id-of-caller, or role;
--   * validates the amount sign itself (defense in depth alongside the
--     P1.1 ledger_transactions_amount_sign_check CHECK -- see the pgTAP
--     verification notes for how this migration confirmed both layers
--     actually fire independently, not just one of them);
--   * writes the ledger row and a matching audit_log row together, in the
--     same transaction (a SECURITY DEFINER function body is one implicit
--     transaction block, so these cannot land only one of the two writes;
--     an exception before either write rolls back both).
--
-- Design choices worth calling out for later tasks:
--
--   * record_expense/record_payment/record_adjustment take p_member_id (the
--     household_members.id the entry is charged/credited against) and
--     derive household_id FROM THAT ROW, rather than accepting household_id
--     as a separate client-supplied parameter. This closes off a
--     mismatched-pair attack (passing a member_id from household A together
--     with a household_id the caller belongs to in household B) and means
--     there is one fewer client-trusted value in the signature.
--   * void_ledger_transaction takes only p_transaction_id + p_void_reason;
--     household_id and the caller's role are both derived by looking the
--     transaction row up first (SECURITY DEFINER bypasses
--     ledger_transactions' own RLS for this internal lookup) and checking
--     internal.is_household_parent(that row's household_id).
--   * p_occurred_on is a REQUIRED parameter on all three insert functions,
--     with no default. `current_date` inside a SECURITY DEFINER function
--     body would resolve in the database server's implicit time zone, which
--     is exactly the standing rule this project forbids ("dates use the
--     household's configured IANA time zone... never the browser's,
--     database server's, or edge runtime's implicit local time"). The
--     caller (application layer) is expected to compute the date in the
--     household's configured zone and pass it explicitly; this migration
--     does not have access to "which household" until after p_member_id is
--     resolved, so it cannot safely default this itself.
--   * payment and adjustment share one internal insert/audit helper
--     (internal.record_ledger_write) because their shape -- Parent-only,
--     amount_cents < 0, insert + audit -- is identical apart from `type`;
--     each still gets its own public, independently-callable RPC entry
--     point (record_payment, record_adjustment) per the task's design
--     intent. record_expense is NOT folded into that helper: its
--     authorization branch (child_expense_scope) is materially different
--     from the Parent-only check, so sharing would trade a few lines of
--     duplication for a helper with a confusing "sometimes parent-only,
--     sometimes not" contract. It calls a second, smaller shared helper
--     (internal.insert_ledger_row_and_audit) that only the two other
--     helpers/functions above also use, for the actual INSERT+audit_log
--     pair once authorization has already been decided by the caller.

-- ---------------------------------------------------------------------------
-- internal.insert_ledger_row_and_audit: shared INSERT + audit_log helper
-- ---------------------------------------------------------------------------
--
-- Not a public entry point -- no authorization check of its own. Every
-- caller (the three public record_* functions below) must have already
-- decided the write is allowed before calling this. Lives in `internal`
-- (not exposed via the Data API; see P1.2's header comment) purely to keep
-- it out of the PostgREST surface, not as a security boundary in itself.

create or replace function internal.insert_ledger_row_and_audit(
  p_household_id uuid,
  p_member_id uuid,
  p_amount_cents bigint,
  p_type text,
  p_description text,
  p_category_id uuid,
  p_note text,
  p_occurred_on date,
  p_created_by uuid
)
returns public.ledger_transactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.ledger_transactions;
begin
  insert into public.ledger_transactions (
    household_id, member_id, amount_cents, type, category_id, description,
    note, occurred_on, created_by
  ) values (
    p_household_id, p_member_id, p_amount_cents, p_type, p_category_id,
    p_description, p_note, p_occurred_on, p_created_by
  )
  returning * into v_row;

  insert into public.audit_log (
    household_id, actor_user_id, entity_type, entity_id, action, new_values
  ) values (
    p_household_id, auth.uid(), 'ledger_transactions', v_row.id, 'insert', to_jsonb(v_row)
  );

  return v_row;
end;
$$;

comment on function internal.insert_ledger_row_and_audit(uuid, uuid, bigint, text, text, uuid, text, date, uuid) is
  'Shared INSERT + audit_log write, no authorization check of its own -- callers must authorize first. Used by record_expense/record_payment/record_adjustment.';

-- REVOKE ... FROM PUBLIC removes only the PUBLIC pseudo-role's ACL entry.
-- Supabase's ALTER DEFAULT PRIVILEGES applies a SEPARATE, independent grant
-- of EXECUTE to anon/authenticated/service_role at function-creation time,
-- which "from public" does not touch -- confirmed by the P1.3 verifier
-- finding anon could still execute every function below despite this line.
-- Every revoke in this file is therefore explicit about every role that
-- must not be able to call it, not just "from public".
revoke execute on function internal.insert_ledger_row_and_audit(uuid, uuid, bigint, text, text, uuid, text, date, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- public.record_expense: any active member (Parent or Child), scope-checked
-- ---------------------------------------------------------------------------

create or replace function public.record_expense(
  p_member_id uuid,
  p_amount_cents bigint,
  p_description text,
  p_occurred_on date,
  p_category_id uuid default null,
  p_note text default null
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
  v_caller_is_parent boolean;
  v_scope text;
begin
  if p_amount_cents <= 0 then
    raise exception 'expense amount_cents must be positive, got %', p_amount_cents
      using errcode = 'check_violation';
  end if;

  select hm.household_id, hm.status
    into v_household_id, v_target_status
    from public.household_members hm
    where hm.id = p_member_id;

  -- Check the CALLER's own membership before revealing anything about
  -- whether p_member_id exists or its status. If v_household_id is null
  -- (no such member), current_household_member_id(null) also returns null,
  -- so a caller who is a member of no household in common with a
  -- nonexistent/foreign target gets the exact same generic rejection as one
  -- who targeted a real member outside their household -- neither response
  -- discloses whether p_member_id exists, is archived, or is in a different
  -- household. Re-derived from auth.uid() -- never trust a client-supplied
  -- identity or role for this check.
  v_caller_member_id := internal.current_household_member_id(v_household_id);
  if v_caller_member_id is null then
    raise exception 'caller is not an active member of this household'
      using errcode = '42501';
  end if;

  -- Only reachable once the caller is confirmed an active member of
  -- v_household_id, so the target's status is not privileged information
  -- from here on -- the caller can already see this member's data via RLS.
  if v_target_status <> 'active' then
    raise exception 'household member % is not active', p_member_id
      using errcode = '42501';
  end if;

  v_caller_is_parent := internal.is_household_parent(v_household_id);

  if not v_caller_is_parent then
    -- A Parent may always record for any member regardless of scope; only
    -- a Child is restricted by child_expense_scope.
    select h.child_expense_scope into v_scope
      from public.households h
      where h.id = v_household_id;

    if v_scope = 'self_only' and p_member_id <> v_caller_member_id then
      raise exception 'this household requires children to record expenses only for themselves'
        using errcode = '42501';
    end if;
  end if;

  return internal.insert_ledger_row_and_audit(
    v_household_id, p_member_id, p_amount_cents, 'expense', p_description,
    p_category_id, p_note, p_occurred_on, v_caller_member_id
  );
end;
$$;

comment on function public.record_expense(uuid, bigint, text, date, uuid, text) is
  'Record an expense (amount_cents > 0) against p_member_id. Callable by any active household member. A Child is restricted by the household''s child_expense_scope (''self_only'' vs ''any_member''); a Parent is never restricted by it. household_id is derived from p_member_id, never accepted from the client.';

revoke execute on function public.record_expense(uuid, bigint, text, date, uuid, text) from public, anon;
grant execute on function public.record_expense(uuid, bigint, text, date, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- public.record_payment / public.record_adjustment: Parent-only
-- ---------------------------------------------------------------------------
--
-- Both are balance-decreasing (amount_cents < 0) and Parent-only. They share
-- one internal helper for the authorization + validation shape; each keeps
-- its own public, independently-callable name as the RPC entry point.

create or replace function internal.record_balance_decrease(
  p_member_id uuid,
  p_amount_cents bigint,
  p_type text,
  p_description text,
  p_occurred_on date,
  p_category_id uuid,
  p_note text
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
begin
  if p_amount_cents >= 0 then
    raise exception '% amount_cents must be negative, got %', p_type, p_amount_cents
      using errcode = 'check_violation';
  end if;

  select hm.household_id, hm.status
    into v_household_id, v_target_status
    from public.household_members hm
    where hm.id = p_member_id;

  -- Check the CALLER's own role before revealing anything about whether
  -- p_member_id exists or its status. is_household_parent(null) is false
  -- (the underlying query can never match a null household_id), so a
  -- nonexistent target and a real target outside the caller's household
  -- both produce this exact same generic rejection -- see record_expense's
  -- matching comment for the full reasoning.
  if not internal.is_household_parent(v_household_id) then
    raise exception 'only an active Parent may record a %', p_type
      using errcode = '42501';
  end if;

  -- Only reachable once the caller is confirmed an active Parent of
  -- v_household_id, so the target's status is no longer privileged from
  -- here on -- the caller can already see this member's data via RLS.
  if v_target_status <> 'active' then
    raise exception 'household member % is not active', p_member_id
      using errcode = '42501';
  end if;

  v_caller_member_id := internal.current_household_member_id(v_household_id);

  return internal.insert_ledger_row_and_audit(
    v_household_id, p_member_id, p_amount_cents, p_type, p_description,
    p_category_id, p_note, p_occurred_on, v_caller_member_id
  );
end;
$$;

comment on function internal.record_balance_decrease(uuid, bigint, text, text, date, uuid, text) is
  'Shared Parent-only, amount_cents < 0 authorization + insert path for record_payment and record_adjustment. Not a public entry point -- p_type is never taken from client input at the public layer, only ''payment''/''adjustment'' literals passed by the two wrapper functions.';

revoke execute on function internal.record_balance_decrease(uuid, bigint, text, text, date, uuid, text) from public, anon, authenticated;

create or replace function public.record_payment(
  p_member_id uuid,
  p_amount_cents bigint,
  p_description text,
  p_occurred_on date,
  p_category_id uuid default null,
  p_note text default null
)
returns public.ledger_transactions
language sql
security definer
set search_path = ''
as $$
  select internal.record_balance_decrease(
    p_member_id, p_amount_cents, 'payment', p_description, p_occurred_on,
    p_category_id, p_note
  );
$$;

comment on function public.record_payment(uuid, bigint, text, date, uuid, text) is
  'Record a payment (amount_cents < 0) against p_member_id. Parent-only -- rejects a Child caller outright, including a Child recording a payment against themselves.';

revoke execute on function public.record_payment(uuid, bigint, text, date, uuid, text) from public, anon;
grant execute on function public.record_payment(uuid, bigint, text, date, uuid, text) to authenticated;

create or replace function public.record_adjustment(
  p_member_id uuid,
  p_amount_cents bigint,
  p_description text,
  p_occurred_on date,
  p_category_id uuid default null,
  p_note text default null
)
returns public.ledger_transactions
language sql
security definer
set search_path = ''
as $$
  select internal.record_balance_decrease(
    p_member_id, p_amount_cents, 'adjustment', p_description, p_occurred_on,
    p_category_id, p_note
  );
$$;

comment on function public.record_adjustment(uuid, bigint, text, date, uuid, text) is
  'Record an adjustment (amount_cents < 0) against p_member_id. Parent-only, same shape as record_payment with type = ''adjustment''.';

revoke execute on function public.record_adjustment(uuid, bigint, text, date, uuid, text) from public, anon;
grant execute on function public.record_adjustment(uuid, bigint, text, date, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- public.void_ledger_transaction: Parent-only, atomic three-column void
-- ---------------------------------------------------------------------------

create or replace function public.void_ledger_transaction(
  p_transaction_id uuid,
  p_void_reason text
)
returns public.ledger_transactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.ledger_transactions;
  v_new public.ledger_transactions;
  v_caller_member_id uuid;
begin
  if p_void_reason is null or length(trim(both from p_void_reason)) = 0 then
    raise exception 'void_reason is required'
      using errcode = 'check_violation';
  end if;

  select * into v_old
    from public.ledger_transactions
    where id = p_transaction_id;

  if v_old.id is null then
    raise exception 'no such ledger transaction: %', p_transaction_id
      using errcode = 'no_data_found';
  end if;

  -- household_id and the caller's role are both derived from the looked-up
  -- row / auth.uid() -- p_transaction_id is the only client-supplied value,
  -- and it names a row, not a household or a role.
  if not internal.is_household_parent(v_old.household_id) then
    raise exception 'only an active Parent of this transaction''s household may void it'
      using errcode = '42501';
  end if;

  if v_old.voided_at is not null then
    raise exception 'ledger transaction % is already voided', p_transaction_id
      using errcode = 'check_violation';
  end if;

  v_caller_member_id := internal.current_household_member_id(v_old.household_id);

  update public.ledger_transactions
     set voided_at = now(),
         voided_by = v_caller_member_id,
         void_reason = p_void_reason
   where id = p_transaction_id
   returning * into v_new;

  insert into public.audit_log (
    household_id, actor_user_id, entity_type, entity_id, action, old_values, new_values
  ) values (
    v_old.household_id, auth.uid(), 'ledger_transactions', v_old.id, 'void',
    to_jsonb(v_old), to_jsonb(v_new)
  );

  return v_new;
end;
$$;

comment on function public.void_ledger_transaction(uuid, text) is
  'Void a ledger transaction: sets voided_at/voided_by/void_reason atomically. Parent-only, scoped to the transaction''s own household (derived from the row, not client input). Rejects an already-voided transaction.';

revoke execute on function public.void_ledger_transaction(uuid, text) from public, anon;
grant execute on function public.void_ledger_transaction(uuid, text) to authenticated;
