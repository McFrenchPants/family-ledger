-- Family Ledger: P1.1 ledger schema.
--
-- Adds the core ledger tables (categories, ledger_transactions, audit_log) and
-- a household-level expense policy toggle, on top of Phase 0's households /
-- household_members.
--
-- RLS is enabled on all three new tables with ZERO policies, matching
-- 20260904220228_create_households_and_members.sql. That is deliberate here
-- too: RLS with no policies is default-deny for anon/authenticated. The real
-- policy set (including what makes audit_log genuinely append-only for
-- ordinary roles) is a later task's work.

-- ---------------------------------------------------------------------------
-- categories
-- ---------------------------------------------------------------------------

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null
    references public.households (id) on delete cascade,
  name text not null,
  sort_order integer,
  active boolean not null default true
);

comment on table public.categories is
  'Household-scoped expense category lookup list.';

create index if not exists categories_household_id_idx
  on public.categories (household_id);

-- Composite uniqueness on (id, household_id) is what lets
-- ledger_transactions enforce "category must belong to the same household as
-- the transaction" via a plain composite foreign key below, rather than a
-- trigger. `id` alone is already globally unique (primary key); this adds a
-- second unique constraint pairing it with household_id so a two-column FK
-- can reference it.
alter table public.categories
  add constraint categories_id_household_id_key unique (id, household_id);

-- ---------------------------------------------------------------------------
-- ledger_transactions
-- ---------------------------------------------------------------------------
--
-- The append-only ledger. Rows are never edited after creation; corrections
-- happen by voiding a row (setting voided_at/voided_by/void_reason together)
-- and, at the application layer, inserting an offsetting entry. Balances are
-- always derived with SUM() over non-voided rows, never a stored column.
--
-- `type` has three values, not two:
--   * 'expense'    -- a child owes more. amount_cents must be positive.
--   * 'payment'    -- money paid down against the balance. amount_cents must
--                     be negative.
--   * 'adjustment' -- a parent correction that reduces the balance outside
--                     the payment flow (e.g. a waived charge). amount_cents
--                     must be negative.
-- 'payment' and 'adjustment' are both balance-decreasing and will be
-- Parent-only at the RPC/RLS layer -- not enforced here, but the sign CHECK
-- below makes the schema itself refuse the one thing that must never happen:
-- a decreasing entry recorded with a positive amount (or vice versa).
--
-- created_by / voided_by reference household_members, not auth.users
-- directly. household_members is this schema's existing model of "who acted"
-- inside a household -- household_id-scoped, and already how the codebase
-- names an actor (household_members.user_id is the *optional* link to a
-- login; household_members.id is the durable per-household identity, present
-- even for a member who currently has no auth account). Every later
-- household-scoped join (RLS policies, audit trails, "which household does
-- this actor belong to") is then a single join to household_members rather
-- than needing to cross into auth.users and match household separately.
-- Referencing auth.users directly here would also require created_by to be
-- nullable-through-archival in a different way than the rest of this schema
-- models identity.

create table if not exists public.ledger_transactions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null
    references public.households (id) on delete cascade,
  member_id uuid not null
    references public.household_members (id) on delete restrict,
  amount_cents bigint not null,
  type text not null,
  category_id uuid,
  description text not null,
  note text,
  occurred_on date not null,
  created_by uuid not null
    references public.household_members (id) on delete restrict,
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid
    references public.household_members (id) on delete restrict,
  void_reason text,

  constraint ledger_transactions_type_check
    check (type in ('expense', 'payment', 'adjustment')),

  -- The sign of amount_cents is dictated by type. Zero is never valid for
  -- any type (an expense of $0 or a payment of $0 is not a real event).
  constraint ledger_transactions_amount_sign_check
    check (
      (type = 'expense' and amount_cents > 0)
      or (type in ('payment', 'adjustment') and amount_cents < 0)
    ),

  -- A partial void is impossible to insert or update into: all three of
  -- voided_at/voided_by/void_reason are NULL together (not voided), or all
  -- three are NOT NULL together (voided). Any other combination is rejected.
  constraint ledger_transactions_void_all_or_nothing_check
    check (
      (voided_at is null and voided_by is null and void_reason is null)
      or (voided_at is not null and voided_by is not null and void_reason is not null)
    ),

  -- Composite FK against categories_id_household_id_key: if category_id is
  -- set, it must name a category row in this SAME household. With the
  -- default MATCH SIMPLE, a NULL category_id (the common case) is exempt
  -- from the check entirely, so this does not force every transaction to
  -- have a category. Chosen over a trigger or a standalone check function
  -- because it is declarative, shows up in \d+ and in any ERD/dependency
  -- tooling, and Postgres enforces it automatically on both INSERT and
  -- UPDATE without any code to keep in sync.
  constraint ledger_transactions_category_household_fk
    foreign key (category_id, household_id)
    references public.categories (id, household_id)
);

comment on table public.ledger_transactions is
  'Append-only ledger of expenses, payments, and adjustments. Never edited after creation; corrections happen via void.';
comment on column public.ledger_transactions.type is
  'expense (amount_cents > 0) | payment | adjustment (both amount_cents < 0). Constrained by ledger_transactions_type_check and ledger_transactions_amount_sign_check.';
comment on column public.ledger_transactions.amount_cents is
  'Integer cents. Sign is dictated by type -- see ledger_transactions_amount_sign_check.';
comment on column public.ledger_transactions.member_id is
  'The household_members row this transaction is charged/credited against (whose balance it affects).';
comment on column public.ledger_transactions.created_by is
  'The household_members row that recorded this transaction (who acted), not necessarily who it is charged against.';
comment on column public.ledger_transactions.voided_at is
  'Set together with voided_by and void_reason, or not at all -- see ledger_transactions_void_all_or_nothing_check.';

create index if not exists ledger_transactions_household_id_idx
  on public.ledger_transactions (household_id);

create index if not exists ledger_transactions_member_id_idx
  on public.ledger_transactions (member_id);

create index if not exists ledger_transactions_category_id_idx
  on public.ledger_transactions (category_id);

create index if not exists ledger_transactions_created_by_idx
  on public.ledger_transactions (created_by);

create index if not exists ledger_transactions_voided_by_idx
  on public.ledger_transactions (voided_by);

-- Balance derivation is always "SUM(amount_cents) over non-voided rows for
-- this member" -- this partial index is exactly that query's access path.
create index if not exists ledger_transactions_household_member_active_idx
  on public.ledger_transactions (household_id, member_id)
  where voided_at is null;

-- ---------------------------------------------------------------------------
-- audit_log
-- ---------------------------------------------------------------------------
--
-- Append-only record of balance-affecting and security-sensitive actions.
-- For THIS task, RLS is enabled with no policies (default-deny for
-- anon/authenticated). That stops ordinary API roles from reading or writing
-- through PostgREST, but it is not on its own a guarantee of "insert-only
-- forever" -- see the note below and in the task report.

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null
    references public.households (id) on delete cascade,
  actor_user_id uuid not null
    references auth.users (id) on delete restrict,
  entity_type text not null,
  entity_id uuid not null,
  action text not null,
  old_values jsonb,
  new_values jsonb,
  created_at timestamptz not null default now()
);

comment on table public.audit_log is
  'Append-only audit trail for balance-affecting and security-sensitive actions. Not writable by ordinary application roles once the append-only policy layer (a later task) is in place.';
comment on column public.audit_log.actor_user_id is
  'auth.users id of whoever performed the action, independent of which household_members row (if any) they were acting as.';
comment on column public.audit_log.entity_type is
  'Free-text discriminator for entity_id''s table, e.g. ''ledger_transactions''. Deliberately not a foreign key: audit_log spans multiple entity tables (polymorphic reference).';

create index if not exists audit_log_household_id_idx
  on public.audit_log (household_id);

create index if not exists audit_log_actor_user_id_idx
  on public.audit_log (actor_user_id);

create index if not exists audit_log_entity_idx
  on public.audit_log (entity_type, entity_id);

-- ---------------------------------------------------------------------------
-- households: child expense policy toggle
-- ---------------------------------------------------------------------------
--
-- Governs who a child may record an expense against. Defaults to the
-- permissive behaviour ('any_member': any household member may create an
-- expense for any child) so existing/newly-created households keep working
-- unchanged. A household can later opt into 'self_only' (children may only
-- expense themselves). Schema only -- no enforcement here; that is a later
-- task's RLS/RPC work.
--
-- A text enum (rather than a boolean flag) because "who may a child expense
-- against" is plausibly a >2-value policy later (e.g. a future
-- 'self_and_siblings' mode), and a named value reads at the call site
-- ('self_only') instead of requiring a comment to explain what true/false
-- means.

alter table public.households
  add column if not exists child_expense_scope text not null default 'any_member';

alter table public.households
  add constraint households_child_expense_scope_check
    check (child_expense_scope in ('any_member', 'self_only'));

comment on column public.households.child_expense_scope is
  'any_member (default): any member may record an expense for any child. self_only: a child may only expense themselves. Enforcement is added in a later task.';

-- ---------------------------------------------------------------------------
-- Row Level Security (enabled, intentionally without policies)
-- ---------------------------------------------------------------------------

alter table public.categories enable row level security;
alter table public.ledger_transactions enable row level security;
alter table public.audit_log enable row level security;
