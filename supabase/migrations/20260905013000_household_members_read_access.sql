-- Family Ledger: S2.1 household membership read access.
--
-- household_members has carried RLS enabled with ZERO policies since P1.1
-- (20260904220228_create_households_and_members.sql) -- deliberate Phase 0
-- default-deny. This closes that gap for reads only: the UI (a later task)
-- needs to know "who am I" (own household_members row: id, household_id,
-- role, name, status) and, for a Parent, the name/role/id of every active
-- member in their household (a dashboard listing each child).
--
-- ---------------------------------------------------------------------------
-- Why direct RLS policies here, not a SECURITY DEFINER function
-- ---------------------------------------------------------------------------
--
-- P1.4's household_member_balances needed a SECURITY DEFINER function
-- specifically because its query could not be expressed as a row-level
-- policy at all: it has to start from the universe of a household's members
-- and LEFT JOIN ledger data on to that so a member with zero transactions
-- still appears with a 0 balance -- a security_invoker view or a plain RLS
-- policy over household_members can only ever filter rows that already
-- exist in the table being queried, it cannot manufacture the union of
-- "every active member" against a different table's aggregate.
--
-- That constraint does not apply here. This task is a straight row filter
-- over household_members itself: "your own row, always" OR "every active
-- row in a household you parent". Both predicates are expressible directly
-- as RLS USING clauses, and both need exactly the same identity/role lookup
-- (auth.uid(), a household_id, active-Parent-ness) that P1.2's
-- internal.is_household_parent already exists to answer -- no new
-- SECURITY DEFINER surface is needed to compute it. Two permissive SELECT
-- policies, OR'd, is also the exact shape P1.2 already used for
-- ledger_transactions_select_parent / ledger_transactions_select_self, so
-- this stays consistent with the established pattern rather than
-- introducing a second read mechanism (RPC) for the same kind of access
-- this project already does via policies elsewhere. RLS is preferred over
-- an RPC whenever a plain row filter is sufficient; P1.4's RPC is the
-- exception forced by the "0 for no transactions" requirement, not the
-- rule.
--
-- ---------------------------------------------------------------------------
-- Policy 1: household_members_select_self
-- ---------------------------------------------------------------------------
--
-- A caller can always read their own membership row, regardless of its
-- status (active/invited/archived). Deliberately NOT restricted to
-- status = 'active': an invited member who has just accepted their invite
-- (linking user_id) or an archived member both still need to be able to see
-- their own row's actual status -- gating self-visibility by status would
-- make it impossible for the UI to ever show "you are invited" or "your
-- account was archived" to the very person it is about. This mirrors
-- ledger_transactions_select_self, which is also not status-gated.
--
-- user_id is compared to auth.uid() directly (no internal.* helper needed):
-- this is the caller's own identity, not a household-scoped role lookup, so
-- there is nothing here that needs to bypass household_members' own RLS in
-- the first place.
create policy household_members_select_self
  on public.household_members
  for select
  to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Policy 2: household_members_select_parent_active_members
-- ---------------------------------------------------------------------------
--
-- An active Parent of a household may read every ACTIVE member's row in
-- that same household (siblings included). invited/archived members are
-- deliberately excluded from this policy -- matching
-- household_member_balances' own `hm.status = 'active'` filter, so a
-- Parent's membership listing and their balance listing agree on who
-- currently "counts" as a household member. A Parent who genuinely needs to
-- manage invited/archived members (resend an invite, restore an archived
-- child) is a distinct, not-yet-built feature with its own acceptance
-- criteria; widening this policy silently to cover that is exactly the kind
-- of undocumented scope creep this task's instructions warn against, so it
-- is left for that future task to decide and implement explicitly.
--
-- internal.is_household_parent(household_id) is P1.2's existing helper: it
-- is SECURITY DEFINER (bypasses household_members' own RLS to look up the
-- CALLER's own role, never a client-supplied identity), STABLE, and
-- `set search_path = ''`. Reusing it here rather than re-deriving the same
-- lookup keeps this policy's access boundary provably identical to every
-- other Parent-gated policy in this project (categories, ledger_transactions,
-- audit_log).
create policy household_members_select_parent_active_members
  on public.household_members
  for select
  to authenticated
  using (
    status = 'active'
    and internal.is_household_parent(household_id)
  );

-- ---------------------------------------------------------------------------
-- anon
-- ---------------------------------------------------------------------------
--
-- Both policies above are scoped `to authenticated` only, so anon matches
-- neither -- combined with RLS's per-command default-deny (household_members
-- still has no policy that names anon, for SELECT or otherwise), anon reads
-- zero rows. This is the identical pattern P1.2 relied on for
-- categories/ledger_transactions (policies scoped to authenticated, no
-- separate anon table-grant revoke needed for read access) rather than
-- audit_log's belt-and-suspenders table-grant revoke, which was justified
-- there by narrowing WRITE reachability, not reads. No new GRANT is issued
-- to anon or authenticated here: the table-level SELECT grant made at
-- table-creation time already exists and is left untouched, exactly as it
-- was left untouched for categories/ledger_transactions in P1.2 -- RLS is
-- the enforcement layer, not the grant.
