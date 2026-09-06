# Implementation Plan — Phase 6: Member management

Branch: `feature/phase-6-member-management` (off `main`). Design spec:
`DESIGN_SPEC.md` (signed off 2026-09-06).

Two sequential stages, mirroring Phase 1/Phase 2's own precedent: Stage 1
(data + authorization + Edge Function, entirely verifier-routed) must be
fully done and green before Stage 2 (UI) starts.

## Stage 1 — Data, authorization, and provisioning

### M6.1 — RLS write policies and the last-active-Parent invariant

`household_members` has carried RLS-enabled/zero-write-policies since
Phase 0 (deliberate default-deny, most recently reaffirmed by the S2.1
read-access migration's own commentary). This task adds the write side:

- An UPDATE policy letting an active Parent update a member row in their
  own household, restricted to `name`, `status`, and `archived_at` (not
  `role`, `household_id`, or `user_id` — role changes are out of scope per
  the design spec, and `household_id`/`user_id` must never move under an
  existing row). Express the column restriction however this project's
  existing policies express similar narrowing (check whether `WITH CHECK`
  alone is sufficient here or whether a trigger is needed to reject
  role/household_id/user_id changes — Postgres RLS policies can't
  natively restrict which *columns* an UPDATE touches, so this likely
  needs a `BEFORE UPDATE` trigger that rejects the statement if those
  columns change, not just a USING/WITH CHECK clause).
- No direct INSERT policy — member creation must go through M6.3's Edge
  Function (which uses `service_role` and therefore bypasses RLS
  entirely, by design, exactly like every other `service_role` operation
  in this project). This keeps "create a member" a single, auditable,
  server-controlled path rather than adding a second one.
- The **last-active-Parent invariant**: reject an UPDATE that would set
  `status = 'archived'` on a row if it is the household's only remaining
  row with `role = 'parent' AND status = 'active'`. Implement as a
  `BEFORE UPDATE` trigger (not just the RLS policy) so it holds
  regardless of write path, including any future direct-SQL access —
  reuse `internal.is_household_parent`/`internal.current_household_member_id`
  where they fit, but this specific check ("is this the last one") is new
  logic, not an existing helper.
- Every successful create/archive/restore/name-edit writes an
  `audit_log` row (actor, action, target member id, before/after summary),
  reusing whatever pattern `internal.insert_ledger_row_and_audit` or the
  payment-plan write functions already established for
  audit-row-alongside-the-write, adapted for this table (a trigger is
  likely the cleanest fit here, since writes can come from both the
  UPDATE policy path and the Edge Function's `service_role` path, and a
  trigger fires for both — a security-definer RPC would only cover one).

**Acceptance criteria:**
1. An active Parent can UPDATE `name`/`status`/`archived_at` on a member
   row in their own household via the normal authenticated client.
2. The same Parent cannot change that row's `role`, `household_id`, or
   `user_id` via UPDATE — rejected at the database, not just omitted from
   the UI.
3. A Child (any role-check path) cannot UPDATE any `household_members`
   row, including their own, via any client.
4. A Parent of household A cannot UPDATE any row belonging to household B.
5. Archiving the household's only active Parent is rejected atomically
   (no partial effect); archiving a Parent when at least one other active
   Parent remains succeeds.
6. Restoring an archived member succeeds and does not require re-linking
   `user_id`.
7. Every successful create/archive/restore/name-edit produces exactly one
   `audit_log` row; ordinary application roles cannot INSERT/UPDATE/DELETE
   `audit_log` directly (already true project-wide — confirm this task
   doesn't accidentally weaken it).
8. `npx supabase db reset` succeeds cleanly; `npm run test:db` green,
   including new mutation-proofed pgTAP coverage for all of the above
   (per this project's standing "every invariant test must be
   mutation-proofed" rule — prove each negative test actually goes red
   against a deliberately broken version of the trigger/policy before
   calling it done).

### M6.2 — `add_household_member` groundwork (non-Auth half)

Before the Edge Function exists, add whatever pure-SQL pieces it will call
into, so M6.3 is "wire up the Edge Function" rather than "design the
schema under time pressure inside Deno code":

- A `SECURITY DEFINER` function, callable only by an active Parent of the
  target household, that inserts a new `household_members` row
  (`status = 'active'`, `role` as given, `user_id` as given — the
  `auth.users` row is created by the Edge Function *before* calling this,
  since only the Edge Function has `service_role` access to the Auth
  admin API) and writes the corresponding audit row.
- This function is the only thing the Edge Function calls to touch
  `household_members` — keeps the "who can create a member row" logic in
  one auditable place (SQL) rather than duplicated in Deno.
- Validates the caller is an active Parent of the household the new
  member is being added to, and that the household isn't being handed a
  duplicate `user_id` (the existing partial unique index already enforces
  this at the constraint level — the function should surface a clean
  error rather than a raw constraint-violation message).

**Acceptance criteria:**
1. Function rejects a non-Parent caller.
2. Function rejects a caller adding to a household they don't belong to.
3. Function succeeds for a valid active-Parent caller and produces exactly
   one new `household_members` row plus one `audit_log` row.
4. A duplicate `user_id` for the same household is rejected with a clear
   error, not a raw Postgres constraint message.
5. `npm run test:db` green with new coverage.

### M6.3 — Edge Function: `add-household-member`

The project's first Edge Function. Load the `supabase` skill before
starting this task for current Edge Function structure/deployment
guidance. Following `ARCHITECTURE.md` §11's model (trusted server
operation, `service_role`, never exposed to the browser):

- Receives the caller's JWT (from the invoking authenticated client),
  the target household id, new member's display name, role, email, and
  either a Parent-chosen or function-generated initial password (resolve
  the design spec's open question here — prefer whichever the Admin API
  makes simpler to implement correctly; document the choice in this
  task's own notes when done).
- Verifies the caller is an active Parent of that household **itself**,
  independently (it cannot rely on RLS, since it uses `service_role`) —
  reuse the same lookup a plain authenticated query against
  `household_members` would do, just called with the caller's own
  identity extracted from their JWT, not a client-supplied claim.
- Calls the Supabase Admin API to create the `auth.users` row
  (email-confirmed — there is no email flow to confirm through).
- Calls M6.2's `SECURITY DEFINER` function to create the linked
  `household_members` row.
- On any failure after the `auth.users` row is created but before the
  `household_members` row is created, the function must clean up (delete
  the orphaned `auth.users` row) rather than leaving a credentialed
  account with no household link — decide and document the specific
  rollback approach in this task's notes.
- Returns the initial password to the caller (the Parent) in the
  response, once, so it can be relayed out of band — never logged,
  never stored anywhere beyond the Auth system's own password hash.

**Acceptance criteria:**
1. A Child's JWT is rejected before any Auth admin API call is made.
2. A Parent's JWT for a *different* household is rejected before any Auth
   admin API call is made.
3. A valid Parent request creates exactly one new `auth.users` row and
   exactly one new `household_members` row, linked.
4. A simulated failure between the two creation steps leaves no orphaned
   `auth.users` row (verify the cleanup path actually runs, not just that
   it exists in the code).
5. The `service_role` key is read only from the Edge Function's own
   server-side environment (Supabase-provided), never passed in from the
   client, never logged.
6. This task falls in the verification floor
   (`authentication_authorization`) — verifier-routed, not spot-checked.

## Stage 2 — UI

Only starts once Stage 1 is fully done and verified.

### M6.4 — "Manage members" page

- Parent-only page (or section of an existing Parent-accessible page),
  gated the same way `/export` is gated (`RequireRole`), listing the
  household's members with role and active/archived status, not relying
  on color alone to distinguish them (§17).
- "Add member" form (name, role, email, initial password per M6.3's
  chosen approach) calling the Edge Function via the normal Supabase
  client's function-invoke path; surfaces the returned initial password
  clearly enough for the Parent to relay it, and a clear error if the
  call fails (matching this project's no-offline-write-queue rule — a
  failed provisioning call shows a retry/error state, never a silent
  queue).
- Archive action with a confirmation step whose copy makes clear the
  action is reversible (not framed like the ledger's void workflow,
  which implies something graver).
- Restore action for archived members.
- Name-edit action for active members.

**Acceptance criteria:**
1. A Child cannot reach this page (redirected/blocked, matching existing
   `RequireRole` behavior elsewhere).
2. A Parent can add a member and see it appear in the list as active.
3. A Parent can archive an active member (with confirmation) and see its
   status change; attempting to archive the household's only active
   Parent shows a clear error, not a silent no-op or a raw database
   error.
4. A Parent can restore an archived member.
5. A Parent can edit an active member's display name.
6. Default verification tier for this task specifically (it calls
   already-verified RPCs/Edge Function and doesn't itself add RLS or
   security-definer logic) — spot-checked normally, per Phase 2 Stage 2's
   precedent — unless review finds it introduces new authorization logic
   of its own, in which case route it to the verifier instead.
7. `npm run typecheck`/`lint`/`test` green; live browser verification of
   the golden path (add → appears active → archive → confirm blocked on
   last Parent case → restore) against a local Supabase stack if one is
   up during implementation, per this project's own verification
   workflow for UI changes.
