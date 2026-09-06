import type { Cents } from "../../lib/currency";
import { formatCents } from "../../lib/currency";

/**
 * Row shape for the household-wide CSV export (S6.1), selected via:
 *
 *   select(
 *     "id, description, amount_cents, type, occurred_on, voided_at, " +
 *       "category:categories(name), " +
 *       "member:household_members!ledger_transactions_member_id_fkey(name)"
 *   )
 *   .eq("household_id", householdId)
 *
 * Scoped to a whole household (every member's transactions), unlike
 * `history.ts`'s per-member `HistoryTransactionRow` -- this is a Parent-only
 * export of the full ledger, not one child's history. `ledger_transactions`
 * has a `household_id` column directly (see
 * `20260904223000_ledger_schema.sql`), and `ledger_transactions_select_parent`
 * (`20260904230000_ledger_rls_policies.sql`) already restricts the rows
 * PostgREST returns to the caller's own household for a Parent -- this type
 * documents the shape of what comes back, it is not itself an authorization
 * boundary.
 *
 * `member` embeds the transaction's *owner* (the child the money is owed
 * by/to), via the same `!<constraint_name>` disambiguation `history.ts` uses
 * for `created_by`/`voided_by` -- `ledger_transactions` has three FKs to
 * `household_members` (`member_id`, `created_by`, `voided_by`), so
 * PostgREST's implicit embedding needs to be told which one. This export
 * intentionally surfaces only the owning member's name (not creator/voider)
 * -- that is what "whose transaction is this" means to someone reading a CSV
 * export, mirroring how `HistoryPage` groups by the member being viewed.
 */
export type LedgerExportRow = {
  id: string;
  description: string;
  amount_cents: number;
  type: string;
  occurred_on: string;
  voided_at: string | null;
  category: { name: string } | null;
  member: { name: string } | null;
};

/** One row of the CSV export, ready to serialize. */
export type LedgerExportTransaction = {
  id: string;
  occurredOn: string;
  memberName: string;
  type: string;
  amountCents: Cents;
  categoryName: string | null;
  description: string;
  isVoided: boolean;
};

/**
 * Falls back the same way `history.ts`'s `UNKNOWN_MEMBER_NAME` does: a member
 * row can come back `null` from the embed if RLS does not let this Parent
 * read it (should not happen for an active Parent's own household, but the
 * mapper must not assume the embed always resolves).
 */
const UNKNOWN_MEMBER_NAME = "someone";

const TYPE_LABELS: Record<string, string> = {
  expense: "Expense",
  payment: "Payment",
  adjustment: "Adjustment",
};

function typeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type;
}

/**
 * Map raw `ledger_transactions` rows (plus embedded category/member) to the
 * shape the CSV export serializes. Pure and separately testable, mirroring
 * `toHistoryTransactions`.
 */
export function toLedgerExportTransactions(
  rows: readonly LedgerExportRow[],
): LedgerExportTransaction[] {
  return rows.map((row) => ({
    id: row.id,
    occurredOn: row.occurred_on,
    memberName: row.member?.name ?? UNKNOWN_MEMBER_NAME,
    type: row.type,
    amountCents: row.amount_cents,
    categoryName: row.category?.name ?? null,
    description: row.description,
    isVoided: row.voided_at !== null,
  }));
}

const CSV_HEADER = ["Date", "Member", "Type", "Amount", "Category", "Description", "Voided"] as const;

/**
 * RFC 4180-style field escaping. A field is wrapped in double quotes, with
 * any internal double quote doubled, whenever it contains a comma, a double
 * quote, or a line break (CR or LF) -- exactly the characters that would
 * otherwise corrupt the row/column structure of the file. A field containing
 * none of those characters is left bare, matching how most spreadsheet tools
 * emit CSV (quoting everything is valid RFC4180 too, but unquoted plain
 * fields are more readable when opened as text).
 */
export function escapeCsvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function toCsvRow(values: readonly string[]): string {
  return values.map(escapeCsvField).join(",");
}

/**
 * Serialize ledger transactions to an RFC4180-style CSV string: a header row
 * followed by one row per transaction, `\r\n` line endings (the RFC4180
 * convention, and what makes the file open cleanly in spreadsheet tools on
 * every platform).
 *
 * Money is rendered via `formatCents` (this project's `Intl.NumberFormat`
 * based formatter), never as raw integer cents -- the export is meant to be
 * human-readable, and integer cents is an internal storage detail, not
 * something to hand a parent reviewing their ledger.
 */
export function toLedgerCsv(transactions: readonly LedgerExportTransaction[]): string {
  const lines: string[] = [toCsvRow(CSV_HEADER)];

  for (const transaction of transactions) {
    lines.push(
      toCsvRow([
        transaction.occurredOn,
        transaction.memberName,
        typeLabel(transaction.type),
        formatCents(transaction.amountCents),
        transaction.categoryName ?? "",
        transaction.description,
        transaction.isVoided ? "Voided" : "",
      ]),
    );
  }

  return `${lines.join("\r\n")}\r\n`;
}
