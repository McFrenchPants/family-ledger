-- Family Ledger: C2 -- expense_presets schema + RLS policies.
--
-- Adds public.expense_presets: household-scoped, Parent-authored shortcuts
-- for recording a common expense (e.g. "School lunch -- $5.00") in one tap.
-- This migration deliberately mirrors 20260904223000_ledger_schema.sql's
-- categories table and 20260904230000_ledger_rls_policies.sql's categories
-- policies as closely as possible -- same shape, same household-membership
-- SELECT scoping, same internal.is_household_parent(household_id) gating for
-- writes -- so it reuses the exact security posture already reviewed for
-- categories rather than inventing a new one. internal.is_household_parent
-- already exists (20260904230000_ledger_rls_policies.sql) and is reused
-- as-is; no new helper function is added here.
--
-- Schema only in this migration: no write-side RPCs, no UI. Presets are
-- application-level convenience data, not ledger rows themselves -- using
-- one to record an expense still goes through the existing record_expense
-- RPC (a later task's work), so there is no balance-affecting logic here and
-- no audit_log interaction.

-- ---------------------------------------------------------------------------
-- expense_presets
-- ---------------------------------------------------------------------------

create table if not exists public.expense_presets (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null
    references public.households (id) on delete cascade,
  label text not null,
  amount_cents bigint not null,
  category_id uuid,
  description text,
  sort_order integer,
  active boolean not null default true,

  -- A preset is always an addition to an expense (never negative or zero) --
  -- mirrors ledger_transactions_amount_sign_check's "expense amounts are
  -- strictly positive" half, without the multi-type sign logic that table
  -- needs (a preset has no 'type' column; it only ever seeds an expense).
  constraint expense_presets_amount_positive_check
    check (amount_cents > 0),

  -- Composite FK against categories_id_household_id_key: if category_id is
  -- set, it must name a category row in this SAME household. With the
  -- default MATCH SIMPLE, a NULL category_id is exempt from the check
  -- entirely. Exact copy of ledger_transactions_category_household_fk's
  -- pattern (20260904223000_ledger_schema.sql lines 115-125).
  constraint expense_presets_category_household_fk
    foreign key (category_id, household_id)
    references public.categories (id, household_id)
);

comment on table public.expense_presets is
  'Household-scoped, Parent-authored expense shortcuts (label + preset amount + optional category) for quickly recording a common expense.';
comment on column public.expense_presets.amount_cents is
  'Integer cents. Always strictly positive -- see expense_presets_amount_positive_check.';

create index if not exists expense_presets_household_id_idx
  on public.expense_presets (household_id);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.expense_presets enable row level security;

create policy expense_presets_select_household_members
  on public.expense_presets
  for select
  to authenticated
  using (internal.is_household_member(household_id));

create policy expense_presets_insert_parent_only
  on public.expense_presets
  for insert
  to authenticated
  with check (internal.is_household_parent(household_id));

create policy expense_presets_update_parent_only
  on public.expense_presets
  for update
  to authenticated
  using (internal.is_household_parent(household_id))
  with check (internal.is_household_parent(household_id));

create policy expense_presets_delete_parent_only
  on public.expense_presets
  for delete
  to authenticated
  using (internal.is_household_parent(household_id));
