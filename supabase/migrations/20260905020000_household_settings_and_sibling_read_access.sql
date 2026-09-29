-- Family Ledger: household settings read access + scope-conditional sibling
-- read access on household_members.
--
-- Closes two related gaps discovered while implementing S2.5 (Add Expense):
--
-- Gap 1: `households` has carried RLS enabled with ZERO policies since Phase 0
-- (20260904220228_create_households_and_members.sql). No caller -- Parent or
-- Child -- can read `timezone` or `child_expense_scope` from their own
-- household row. The Add Expense form needs both: `timezone` to compute
-- "today" per this project's standing time-zone rule (never the browser's,
-- database server's, or edge runtime's implicit local time), and
-- `child_expense_scope` to decide whether a Child sees a sibling selector or
-- is locked to themselves.
--
-- Gap 2: S2.1's `household_members_select_self` policy lets a Child read only
-- their own row. When a household's `child_expense_scope` is 'any_member', a
-- Child needs to see their active siblings to pick one in the expense form's
-- child selector -- currently impossible for a Child (only a Parent gets
-- broader visibility, via `household_members_select_parent_active_members`).
--
-- ---------------------------------------------------------------------------
-- households: read-only, any active member of the household
-- ---------------------------------------------------------------------------
--
-- Reuses `internal.is_household_member`, the existing SECURITY DEFINER helper
-- from 20260904230000_ledger_rls_policies.sql: SECURITY DEFINER (bypasses
-- household_members' own RLS to look up the CALLER's own membership), STABLE,
-- `set search_path = ''`, and it only ever reports the caller's OWN
-- membership (auth.uid() is read internally; a caller cannot pass an
-- arbitrary identity in). Using it here keeps this policy's access boundary
-- provably identical to every other membership-gated policy in this project.
--
-- No write policy is added -- deliberately out of scope. Households carries
-- no UPDATE/DELETE/INSERT policy for any role either before or after this
-- migration; a settings UI to change `timezone`/`child_expense_scope` is a
-- later phase's work with its own acceptance criteria.
create policy households_select_member
  on public.households
  for select
  to authenticated
  using (internal.is_household_member(id));

-- ---------------------------------------------------------------------------
-- household_members: sibling visibility, but ONLY when the household is
-- configured 'any_member' -- a THIRD policy, additive to S2.1's two
-- ---------------------------------------------------------------------------
--
-- S2.1 already established two permissive SELECT policies on
-- household_members (household_members_select_self,
-- household_members_select_parent_active_members) and this migration does
-- not touch either. This adds a third, OR'd in per Postgres RLS's normal
-- permissive-policy semantics: a row is visible to a SELECT if ANY policy's
-- USING clause holds.
--
-- The predicate is deliberately NOT "any active member of the same
-- household" unconditionally -- that would let a Child in a 'self_only'
-- household see their siblings too, which is exactly the behavior S2.1
-- intentionally withheld from Children (only Parents got the "every active
-- member" policy). Instead this is conditioned on a subquery against
-- households.child_expense_scope: it only ever adds visibility in an
-- 'any_member' household, where the product's own scope setting has already
-- decided that a Child recording an expense may pick any sibling, so the
-- Child needs to be able to see those siblings to build that picker.
--
-- In 'self_only' mode this policy's USING clause is always false, so it
-- grants nothing beyond what already existed: a Child still sees only their
-- own row (household_members_select_self), and a Parent's broader visibility
-- continues to come from household_members_select_parent_active_members
-- regardless of this policy or the household's scope setting.
--
-- Membership in the household is still checked (via
-- internal.is_household_member(household_id)) -- this policy grants no
-- cross-household visibility. Status = 'active' on the row being read matches
-- S2.1's own "active members only" scoping for its non-self policy, so a
-- sibling picker never surfaces an invited-but-not-yet-onboarded or archived
-- member as a selectable expense target.
create policy household_members_select_siblings_when_any_member
  on public.household_members
  for select
  to authenticated
  using (
    status = 'active'
    and internal.is_household_member(household_id)
    and exists (
      select 1
      from public.households h
      where h.id = household_members.household_id
        and h.child_expense_scope = 'any_member'
    )
  );

-- ---------------------------------------------------------------------------
-- anon
-- ---------------------------------------------------------------------------
--
-- Both new policies are scoped `to authenticated` only. RLS is per-command
-- default-deny, and neither table gains a policy naming `anon` here, so
-- `anon` continues to read zero rows from `households` and gains no new
-- visibility into `household_members` either -- the same pattern P1.2 and
-- S2.1 already relied on for every other read policy in this project. No
-- GRANT is touched: the table-level SELECT grants made at table-creation time
-- are left exactly as they were.
