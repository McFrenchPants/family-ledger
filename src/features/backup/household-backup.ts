/**
 * Pure serialization for S6.2's JSON snapshot export (full household backup).
 *
 * Mirrors `ledger-export.ts`'s `toLedgerCsv` pattern: data-fetching lives in
 * `useHouseholdBackup.ts`, this file only maps already-fetched rows to the
 * final JSON-serializable snapshot, so the mapping itself is unit-testable
 * without touching Supabase.
 *
 * Unlike the CSV export, amounts here stay integer cents. This is a
 * re-importable backup format, not a human report -- `formatCents` (which
 * loses precision-irrelevant but reimport-relevant structure by turning
 * `4217` into the string `"$42.17"`) has no place here. Every other column
 * is passed through close to its raw database shape for the same reason: a
 * backup should be a faithful, restorable copy of the rows, not a curated
 * view of them.
 *
 * Push subscriptions are deliberately excluded (see ARCHITECTURE.md §19):
 * devices can resubscribe, so they are not durable backup data and this
 * module has no row type for them.
 */

/**
 * Version 2 adds category balances: tracked balances, payment allocation
 * parts, balance transfers, payment suggestions and their parts, plus
 * `tracked_balance_id` on payment plans and categories (null = Everyday).
 * A version 1 file simply lacks those keys.
 */
export const HOUSEHOLD_BACKUP_SCHEMA_VERSION = 2;

export type HouseholdBackupHouseholdRow = {
  id: string;
  name: string;
  timezone: string;
};

export type HouseholdBackupMemberRow = {
  id: string;
  user_id: string | null;
  name: string;
  role: string;
  status: string;
  created_at: string;
  archived_at: string | null;
};

export type HouseholdBackupTransactionRow = {
  id: string;
  member_id: string;
  amount_cents: number;
  type: string;
  category_id: string | null;
  description: string;
  note: string | null;
  occurred_on: string;
  created_by: string;
  created_at: string;
  voided_at: string | null;
  voided_by: string | null;
  void_reason: string | null;
};

export type HouseholdBackupPaymentPlanRow = {
  id: string;
  member_id: string;
  minimum_cents: number;
  frequency: string;
  due_day: number;
  starts_on: string;
  ends_on: string | null;
  active: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
  /** The balance this plan counts payments toward; null reads as Everyday. */
  tracked_balance_id: string | null;
};

export type HouseholdBackupPaymentPeriodRow = {
  id: string;
  payment_plan_id: string;
  member_id: string;
  period_start: string;
  due_date: string;
  minimum_cents: number;
  waived_at: string | null;
  waived_by: string | null;
  waive_reason: string | null;
  created_at: string;
};

export type HouseholdBackupCategoryRow = {
  id: string;
  name: string;
  sort_order: number | null;
  active: boolean;
  /** The balance expenses in this category count toward; null reads as Everyday. */
  tracked_balance_id: string | null;
};

export type HouseholdBackupTrackedBalanceRow = {
  id: string;
  name: string;
  sort_order: number | null;
  active: boolean;
  is_everyday: boolean;
  created_at: string;
};

export type HouseholdBackupPaymentAllocationRow = {
  id: string;
  member_id: string;
  transaction_id: string;
  transaction_type: string;
  tracked_balance_id: string;
  amount_cents: number;
  created_at: string;
};

export type HouseholdBackupBalanceTransferRow = {
  id: string;
  member_id: string;
  from_tracked_balance_id: string;
  to_tracked_balance_id: string;
  amount_cents: number;
  occurred_on: string;
  note: string | null;
  created_by: string;
  created_at: string;
  voided_at: string | null;
  voided_by: string | null;
  void_reason: string | null;
};

export type HouseholdBackupPaymentSuggestionRow = {
  id: string;
  member_id: string;
  amount_cents: number;
  suggested_on: string;
  note: string | null;
  status: string;
  created_by: string;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_note: string | null;
  converted_transaction_id: string | null;
  converted_transaction_type: string | null;
};

export type HouseholdBackupPaymentSuggestionPartRow = {
  id: string;
  member_id: string;
  suggestion_id: string;
  tracked_balance_id: string;
  amount_cents: number;
  created_at: string;
};

export type HouseholdBackupAuditLogRow = {
  id: string;
  actor_user_id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  old_values: unknown;
  new_values: unknown;
  created_at: string;
};

/** Already-fetched rows for one household, ready to serialize. */
export type HouseholdBackupInput = {
  household: HouseholdBackupHouseholdRow;
  members: readonly HouseholdBackupMemberRow[];
  transactions: readonly HouseholdBackupTransactionRow[];
  paymentPlans: readonly HouseholdBackupPaymentPlanRow[];
  paymentPeriods: readonly HouseholdBackupPaymentPeriodRow[];
  categories: readonly HouseholdBackupCategoryRow[];
  trackedBalances: readonly HouseholdBackupTrackedBalanceRow[];
  paymentAllocations: readonly HouseholdBackupPaymentAllocationRow[];
  balanceTransfers: readonly HouseholdBackupBalanceTransferRow[];
  paymentSuggestions: readonly HouseholdBackupPaymentSuggestionRow[];
  paymentSuggestionParts: readonly HouseholdBackupPaymentSuggestionPartRow[];
  auditLog: readonly HouseholdBackupAuditLogRow[];
};

/** The full JSON-serializable snapshot produced for download. */
export type HouseholdBackupSnapshot = {
  schemaVersion: number;
  exportedAt: string;
  household: HouseholdBackupHouseholdRow;
  members: readonly HouseholdBackupMemberRow[];
  transactions: readonly HouseholdBackupTransactionRow[];
  paymentPlans: readonly HouseholdBackupPaymentPlanRow[];
  paymentPeriods: readonly HouseholdBackupPaymentPeriodRow[];
  categories: readonly HouseholdBackupCategoryRow[];
  trackedBalances: readonly HouseholdBackupTrackedBalanceRow[];
  paymentAllocations: readonly HouseholdBackupPaymentAllocationRow[];
  balanceTransfers: readonly HouseholdBackupBalanceTransferRow[];
  paymentSuggestions: readonly HouseholdBackupPaymentSuggestionRow[];
  paymentSuggestionParts: readonly HouseholdBackupPaymentSuggestionPartRow[];
  auditLog: readonly HouseholdBackupAuditLogRow[];
};

/**
 * Build the final snapshot object from already-fetched rows.
 *
 * `exportedAt` is a parameter (not an implicit `new Date()` inside), matching
 * this codebase's `todayInZone(timeZone, now = new Date())` convention in
 * `lib/dates.ts` -- callers and tests control the instant, nothing here
 * depends on the host clock.
 */
export function toHouseholdBackupSnapshot(
  input: HouseholdBackupInput,
  exportedAt: string,
): HouseholdBackupSnapshot {
  return {
    schemaVersion: HOUSEHOLD_BACKUP_SCHEMA_VERSION,
    exportedAt,
    household: input.household,
    members: input.members,
    transactions: input.transactions,
    paymentPlans: input.paymentPlans,
    paymentPeriods: input.paymentPeriods,
    categories: input.categories,
    trackedBalances: input.trackedBalances,
    paymentAllocations: input.paymentAllocations,
    balanceTransfers: input.balanceTransfers,
    paymentSuggestions: input.paymentSuggestions,
    paymentSuggestionParts: input.paymentSuggestionParts,
    auditLog: input.auditLog,
  };
}

/** Pretty-printed JSON text for the snapshot, ready to hand to a file download. */
export function toHouseholdBackupJson(snapshot: HouseholdBackupSnapshot): string {
  return JSON.stringify(snapshot, null, 2);
}
