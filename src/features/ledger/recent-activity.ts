import type { Cents } from "../../lib/currency";

/**
 * Row shape returned by
 * `select("id, description, amount_cents, type, occurred_on, created_at, category:categories(name)")`
 * against `ledger_transactions`, restricted by P1.2's
 * `ledger_transactions_select_self` policy to the caller's own rows.
 * `category` embeds the many-to-one `categories` relationship via
 * `category_id`; it is `null` when the transaction has no category.
 */
export type RecentTransactionRow = {
  id: string;
  description: string;
  amount_cents: number;
  type: string;
  occurred_on: string;
  created_at: string;
  /** Set when a parent voided the row (it stays visible; it no longer counts). */
  voided_at?: string | null;
  category: { name: string } | null;
};

/** One row of a Child's recent-activity list, ready to render. */
export type RecentTransaction = {
  id: string;
  description: string;
  categoryName: string | null;
  amountCents: Cents;
  type: string;
  occurredOn: string;
  /** Present (and true) only for a voided row. */
  isVoided?: true;
};

/**
 * Map raw `ledger_transactions` rows (plus embedded category) to the shape
 * the recent-activity list renders. Pure and separately testable, mirroring
 * `joinChildBalances` in `household-balances.ts`.
 */
export function toRecentTransactions(rows: readonly RecentTransactionRow[]): RecentTransaction[] {
  return rows.map((row) => ({
    id: row.id,
    description: row.description,
    categoryName: row.category?.name ?? null,
    amountCents: row.amount_cents,
    type: row.type,
    occurredOn: row.occurred_on,
    ...(row.voided_at ? { isVoided: true as const } : {}),
  }));
}

/** `RecentTransactionRow` plus the member it is charged to (household-wide reads). */
export type HouseholdRecentTransactionRow = RecentTransactionRow & { member_id: string };

/** A recent-activity row that also says whose it is, for the Parent's household view. */
export type HouseholdRecentTransaction = RecentTransaction & { memberId: string };

/** Same mapping as `toRecentTransactions`, keeping each row's `member_id`. */
export function toHouseholdRecentTransactions(
  rows: readonly HouseholdRecentTransactionRow[],
): HouseholdRecentTransaction[] {
  return toRecentTransactions(rows).map((transaction, index) => ({
    ...transaction,
    memberId: (rows[index] as HouseholdRecentTransactionRow).member_id,
  }));
}
