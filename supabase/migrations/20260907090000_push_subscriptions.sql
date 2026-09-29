-- Family Ledger: N4.1 -- push_subscriptions table and RLS (Phase 4 push
-- notification technical spike).
--
-- Adds public.push_subscriptions (one row per browser/device push
-- subscription registered by a household member) and a read-only derived
-- view, public.household_member_push_status, that lets a Parent see WHETHER
-- a household member has at least one subscription without ever exposing
-- that member's actual p256dh/auth keys to anyone but the member themself.
--
-- This is schema + RLS only, matching this project's phased pattern (see
-- e.g. 20260905030000_payment_plans_schema.sql, 20260906120000_expense_
-- presets.sql): no Edge Function, no VAPID keys, no client UI here -- those
-- are separate tasks (N4.2-N4.5).
--
-- ---------------------------------------------------------------------------
-- Why no household_id column
-- ---------------------------------------------------------------------------
--
-- Every other multi-tenant table in this project so far (payment_plans,
-- payment_periods, expense_presets, ledger_transactions, categories) DOES
-- carry its own household_id column, denormalized specifically so RLS
-- policies can filter directly without joining through another table (see
-- payment_periods' own header comment in 20260905030000). push_subscriptions
-- deliberately does NOT follow that denormalization: a subscription's
-- authorization boundary is never "this household", it is always "this one
-- household_member row, and only that row's own owner" -- no policy here
-- ever needs to reason about siblings or about "any member of household X"
-- the way payment_plans/expense_presets policies do. Since household_id
-- would add nothing a policy actually filters on, and would need its own
-- trigger to keep in sync with household_members.household_id if a member
-- were ever re-homed, it is left out; household is available, when actually
-- needed (the status view below), by joining through household_member_id.
--
-- ---------------------------------------------------------------------------
-- Why no audit_log row (deliberate, not an oversight)
-- ---------------------------------------------------------------------------
--
-- Every other write-side function/trigger in this project logs to
-- audit_log because it changes something balance-affecting or
-- household-membership-affecting (money, roles, who belongs to a
-- household). Subscribing/unsubscribing a browser to push notifications is
-- neither: it is low-stakes, fully self-service (a member only ever touches
-- their own row -- see the RLS policies below), fully reversible (delete the
-- row, resubscribe later), and carries no financial or authorization
-- consequence. Logging it would just add audit_log noise with no security or
-- product value. A future task that decides otherwise should update this
-- comment, not silently add a trigger that contradicts it.

-- ---------------------------------------------------------------------------
-- internal.is_own_household_member: new helper
-- ---------------------------------------------------------------------------
--
-- push_subscriptions' ownership check is "does p_household_member_id name an
-- active household_members row belonging to the CALLING auth.uid()?" -- a
-- shape none of the existing internal.* helpers (is_household_member,
-- is_household_parent, current_household_member_id) quite cover, because all
-- three are parameterized by household_id, and push_subscriptions carries no
-- household_id column to pass in (see above). Adding a new helper rather than
-- forcing a household_id lookup keeps this migration's policies a single
-- direct predicate, and keeps the same "small SECURITY DEFINER helper,
-- STABLE, set search_path = '', only ever reports the CALLER's own
-- membership" shape as every other helper in internal
-- (20260904230000_ledger_rls_policies.sql).

create or replace function internal.is_own_household_member(p_household_member_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.household_members hm
    where hm.id = p_household_member_id
      and hm.user_id = auth.uid()
      and hm.status = 'active'
  );
$$;

comment on function internal.is_own_household_member(uuid) is
  'True if p_household_member_id names an active household_members row belonging to the calling auth.uid(). SECURITY DEFINER: bypasses household_members'' own RLS for this internal lookup, same rationale as internal.is_household_member. Only ever reports the CALLER''s own membership -- a caller cannot use this to probe another member''s id.';

revoke execute on function internal.is_own_household_member(uuid) from public;
grant execute on function internal.is_own_household_member(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- push_subscriptions
-- ---------------------------------------------------------------------------

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  household_member_id uuid not null
    references public.household_members (id) on delete cascade,
  -- The Push API subscription endpoint URL. Unique across the whole table
  -- (not just per member): a given browser/device endpoint identifies one
  -- specific push channel, and the upsert flow (INSERT ... ON CONFLICT
  -- (endpoint) DO UPDATE) that re-subscribing the same device relies on
  -- requires this to be the conflict target.
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),

  constraint push_subscriptions_endpoint_key unique (endpoint)
);

comment on table public.push_subscriptions is
  'One row per registered Web Push subscription (browser/device) for a household member. No household_id column -- see this migration''s header comment. Not audit-logged -- deliberate, see header comment.';
comment on column public.push_subscriptions.endpoint is
  'The Push API subscription endpoint URL. Globally unique -- the conflict target for the self-service upsert (re-subscribe) flow.';
comment on column public.push_subscriptions.p256dh is
  'Push API subscription public key. Never exposed to anyone but the owning member -- see household_member_push_status for the only other client-reachable view of this table, which never selects this column.';
comment on column public.push_subscriptions.auth is
  'Push API subscription auth secret. Same exposure rule as p256dh.';

create index if not exists push_subscriptions_household_member_id_idx
  on public.push_subscriptions (household_member_id);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
--
-- Enabled before any policy is added, matching this project's convention
-- elsewhere (e.g. 20260904220228_create_households_and_members.sql): RLS
-- with zero policies is default-deny for anon/authenticated, so there is no
-- window between "table created" and "policies added" in which this table is
-- readable/writable by an ordinary role.

alter table public.push_subscriptions enable row level security;

--
-- Four policies, all scoped by the same internal.is_own_household_member
-- predicate: a member may INSERT, SELECT, UPDATE, and DELETE only rows whose
-- household_member_id resolves to their own active membership. No policy
-- ever names another member's id, and no policy is scoped by role (a Child
-- manages their own push subscription exactly like a Parent manages theirs
-- -- this is unlike every balance/membership-affecting policy elsewhere in
-- this project, because subscribing a device is not a privileged action).
--
-- Why an UPDATE policy exists despite "no UPDATE policy is needed" being the
-- original framing: the self-service re-subscribe flow is
-- `INSERT ... ON CONFLICT (endpoint) DO UPDATE`, and Postgres evaluates the
-- DO UPDATE arm of an upsert against the table's UPDATE privileges (RLS
-- USING on the pre-existing conflicting row, WITH CHECK on the row that
-- would result) -- not its INSERT privileges. Without an UPDATE policy, RLS
-- would default-deny the UPDATE arm for every caller, and re-subscribing an
-- already-registered endpoint would fail outright rather than refresh the
-- row. So an UPDATE policy, scoped identically to INSERT (same predicate in
-- both USING and WITH CHECK), is required for the feature to work AND is
-- what makes the upsert path safe: if the conflicting endpoint belongs to a
-- DIFFERENT member, that row does not satisfy this UPDATE policy's USING
-- clause, so Postgres rejects the DO UPDATE arm outright with 42501 ("new
-- row violates row-level security policy (USING expression)") rather than
-- silently upserting -- confirmed empirically while building this migration
-- (not the 23505 a plain unique-index collision would raise; RLS's USING
-- check on the conflicting row is evaluated, and fails, before unique-
-- constraint handling ever comes into play). A member attempting to
-- "re-subscribe" someone else's endpoint is rejected outright, never granted
-- a takeover of that row. This is proven by a dedicated negative pgTAP test
-- below, not merely asserted here.

create policy push_subscriptions_select_own
  on public.push_subscriptions
  for select
  to authenticated
  using (internal.is_own_household_member(household_member_id));

create policy push_subscriptions_insert_own
  on public.push_subscriptions
  for insert
  to authenticated
  with check (internal.is_own_household_member(household_member_id));

create policy push_subscriptions_update_own
  on public.push_subscriptions
  for update
  to authenticated
  using (internal.is_own_household_member(household_member_id))
  with check (internal.is_own_household_member(household_member_id));

create policy push_subscriptions_delete_own
  on public.push_subscriptions
  for delete
  to authenticated
  using (internal.is_own_household_member(household_member_id));

-- ---------------------------------------------------------------------------
-- household_member_push_status: read-only derived view
-- ---------------------------------------------------------------------------
--
-- Exposes only household_member_id + has_subscription (boolean), never
-- p256dh/auth, so a Parent can build a "which of my kids have notifications
-- enabled" UI without ever touching push_subscriptions' sensitive columns
-- directly.
--
-- Why this is a plain view (security_invoker NOT set), deliberately, rather
-- than the security_invoker=true this project's own security checklist
-- otherwise calls for on every new view:
--
-- The visibility rule this view must implement is exactly
-- household_member_balances' rule (20260905010000_ledger_member_balances.sql)
-- -- "a Parent sees every active member of their own household; a Child sees
-- only themselves; anyone else sees nothing" -- applied here to "has at least
-- one push_subscriptions row" instead of "sum of ledger_transactions". That
-- file's header comment already explains why a security_invoker view cannot
-- do this: it would run the FROM/EXISTS subquery as the calling role, subject
-- to push_subscriptions' own RLS above (owner-only), so a Parent's EXISTS
-- lookup against a CHILD's subscriptions would itself be blocked by RLS and
-- always read false -- silently breaking the entire feature for the one
-- audience (Parents) it exists to serve. household_member_balances solved
-- this with a SECURITY DEFINER function instead of a view; this migration
-- uses a view (per this task's spec) that gets the equivalent property for
-- free from ordinary Postgres view semantics: a view's query runs with the
-- privileges of the view's OWNER (the migration-applying role, which is not
-- subject to RLS on tables it owns) unless security_invoker is set, so this
-- view's own EXISTS subquery against push_subscriptions bypasses that
-- table's RLS by construction -- exactly the same "read as owner, but only
-- ever report the CALLER's own authorized slice" pattern as every
-- SECURITY DEFINER helper in this file, just expressed as a view instead of
-- a function. Safety does not come from that RLS bypass being narrow by
-- accident -- it comes from the outer WHERE clause below re-deriving the
-- caller's own membership/role via the exact same internal.is_household_
-- parent / internal.current_household_member_id helpers household_member_
-- balances uses, so the access boundary is provably identical: a
-- p_household this caller does not actively belong to (or another
-- household's members) yields zero rows, never someone else's data. This is
-- the intentional exception to "use security_invoker=true" that the project
-- security checklist itself anticipates ("protect your views ... by putting
-- them in an unexposed schema" or, as here, by encoding an equivalent access
-- boundary directly in the view body) -- not an oversight.
--
-- p256dh/auth are never selected here at all, so even a caller who could
-- somehow widen this view's WHERE clause in a future edit still could not
-- exfiltrate key material through it without also changing the SELECT list
-- -- there is no column to leak by relaxing the predicate alone.

create or replace view public.household_member_push_status as
select
  hm.id as household_member_id,
  exists (
    select 1
    from public.push_subscriptions ps
    where ps.household_member_id = hm.id
  ) as has_subscription
from public.household_members hm
where hm.status = 'active'
  and (
    internal.is_household_parent(hm.household_id)
    or hm.id = internal.current_household_member_id(hm.household_id)
  );

comment on view public.household_member_push_status is
  'For each active household member the caller is authorized to see (Parent: every active member of their own household; Child/other member: only themselves), whether they have at least one push_subscriptions row. Never exposes p256dh/auth. Deliberately NOT security_invoker -- see this migration''s header comment for why that is required (and safe) here, mirroring public.household_member_balances'' SECURITY DEFINER function for the identical visibility rule.';

-- Supabase's default privileges grant SELECT on every new table/view to
-- anon and authenticated at creation time, independent of RLS/view logic.
-- The view's own WHERE clause is what actually protects it (views are not
-- policy-gated the way tables are), but anon is revoked explicitly anyway,
-- matching this project's explicit-revoke posture for every other
-- privileged read/write surface (see e.g. 20260904233000_ledger_write_
-- functions.sql's revoke/grant pattern) rather than relying solely on
-- "anon has no auth.uid() so it would see nothing anyway".
revoke select on public.household_member_push_status from public, anon;
grant select on public.household_member_push_status to authenticated;
