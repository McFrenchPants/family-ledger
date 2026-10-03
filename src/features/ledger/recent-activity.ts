import type { Cents } from "../../lib/currency";
import { formatCalendarDate } from "../../lib/dates";

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

/** True when `word` appears in `text` as a whole word, ignoring case. */
function mentions(text: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|\\W)${escaped}(\\W|$)`, "i").test(text);
}

/**
 * The second line of a Home recent-activity row: "Oct 1 · Gas · Alex".
 * The middle part is the expense's category, or the type label ("Payment")
 * for anything else -- dropped when the row's title already says it, so a
 * payment titled "Payment" reads "Sep 10 · Katie", not "Payment" twice.
 * `childName` is the Parent's view only; a Child's own rows never name anyone.
 */
export function activitySubline(
  transaction: RecentTransaction,
  typeLabel: string,
  childName?: string | null,
): string {
  const detail = transaction.type === "expense" ? transaction.categoryName : typeLabel;
  return [
    formatCalendarDate(transaction.occurredOn, "short"),
    detail && !mentions(transaction.description, detail) ? detail : null,
    childName,
    transaction.isVoided ? "Voided" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
