import type { Cents } from "../../lib/currency";
import { compareCalendarDates } from "../../lib/dates";
import type { ActivityTransaction } from "./history";

/**
 * Balance moves ("Moved $150 from Everyday to Car") shown in the Activity
 * list next to ledger rows. A move is not an expense or a payment: it never
 * changes a child's total, only how it is split between balances.
 */

/** Raw `balance_transfers` row as the Activity page selects it. */
export type BalanceTransferRow = {
  id: string;
  member_id: string;
  from_tracked_balance_id: string;
  to_tracked_balance_id: string;
  amount_cents: number;
  occurred_on: string;
  note: string | null;
  created_at: string;
  voided_at: string | null;
  void_reason: string | null;
};

export type BalanceTransfer = {
  id: string;
  memberId: string;
  fromBalanceId: string;
  toBalanceId: string;
  amountCents: Cents;
  occurredOn: string;
  note: string | null;
  createdAt: string;
  isVoided: boolean;
  voidReason: string | null;
};

export function toBalanceTransfers(rows: readonly BalanceTransferRow[]): BalanceTransfer[] {
  return rows.map((row) => ({
    id: row.id,
    memberId: row.member_id,
    fromBalanceId: row.from_tracked_balance_id,
    toBalanceId: row.to_tracked_balance_id,
    amountCents: row.amount_cents,
    occurredOn: row.occurred_on,
    note: row.note,
    createdAt: row.created_at,
    isVoided: row.voided_at !== null,
    voidReason: row.void_reason,
  }));
}

export type FeedItem =
  | { kind: "transaction"; transaction: ActivityTransaction }
  | { kind: "transfer"; transfer: BalanceTransfer };

export const feedDate = (item: FeedItem): string =>
  item.kind === "transaction" ? item.transaction.occurredOn : item.transfer.occurredOn;

const feedCreatedAt = (item: FeedItem): string =>
  item.kind === "transaction" ? item.transaction.createdAt : item.transfer.createdAt;

/**
 * The Activity list: ledger rows (already newest first, loaded a page at a
 * time) with balance moves slotted in by date, newest first.
 *
 * Moves are read in one go while ledger rows come 50 at a time, so while
 * older ledger pages remain (`hasMore`) only moves as recent as the oldest
 * loaded ledger row are shown; "Load more" then reveals the older ones along
 * with their rows. Ledger rows keep the order the server gave them.
 */
export function mergeFeed(
  transactions: readonly ActivityTransaction[],
  transfers: readonly BalanceTransfer[],
  hasMore: boolean,
): FeedItem[] {
  const oldest = transactions[transactions.length - 1]?.occurredOn ?? null;
  const shown =
    hasMore && oldest !== null
      ? transfers.filter((transfer) => compareCalendarDates(transfer.occurredOn, oldest) >= 0)
      : transfers;

  const rows = transactions.map((transaction): FeedItem => ({ kind: "transaction", transaction }));
  if (shown.length === 0) return rows;

  const items: FeedItem[] = [
    ...rows,
    ...shown.map((transfer): FeedItem => ({ kind: "transfer", transfer })),
  ];
  // Array sort is stable, so ledger rows that tie keep the server's order.
  return items.sort(
    (a, b) =>
      compareCalendarDates(feedDate(b), feedDate(a)) ||
      (feedCreatedAt(a) < feedCreatedAt(b) ? 1 : feedCreatedAt(a) > feedCreatedAt(b) ? -1 : 0),
  );
}
