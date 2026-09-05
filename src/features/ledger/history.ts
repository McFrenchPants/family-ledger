import type { Cents } from "../../lib/currency";

/**
 * Row shape for the full ledger history view (`/child/:memberId/history`,
 * S2.7). A sibling module to `recent-activity.ts` rather than an extension of
 * it: the Child dashboard's recent-activity list (`RecentTransactionRow`/
 * `toRecentTransactions`) is a *different* consumer with no need for voided
 * state or creator/voider identity, and bolting those fields onto that type
 * would mean every recent-activity call site carries optional fields it never
 * reads. Keeping history's row/mapper here also keeps this query's two
 * FK-disambiguated embeds (see below) colocated with the type that documents
 * them, rather than mixed into a module whose header comment describes a
 * narrower select list.
 *
 * Selected via:
 *   select(
 *     "id, description, amount_cents, type, occurred_on, created_at, " +
 *     "voided_at, void_reason, category:categories(name), " +
 *     "created_by_member:household_members!ledger_transactions_created_by_fkey(name), " +
 *     "voided_by_member:household_members!ledger_transactions_voided_by_fkey(name)"
 *   )
 *
 * `ledger_transactions` has two FKs to `household_members` (`created_by` and
 * `voided_by`), so PostgREST's implicit embedding is ambiguous for either --
 * the `!<constraint_name>` syntax picks a specific FK. Both constraint names
 * are Postgres's auto-generated `<table>_<column>_fkey` names (the columns
 * were declared with an inline `references`, no explicit `constraint`
 * clause in 20260904223000_ledger_schema.sql), confirmed against the local
 * stack.
 *
 * `created_by_member`/`voided_by_member` can come back `null` even for a
 * legitimate row: `household_members` RLS (S2.1) only lets a Child read their
 * own row plus active siblings under `'any_member'` scope, so a Child viewing
 * their own history may see `created_by_member: null` for a row a Parent
 * created (a Parent's row is not readable by the Child under S2.1's
 * policies). This is an accepted limitation, not a bug to route around
 * client-side -- `toHistoryTransactions` renders a graceful "someone"
 * fallback instead of leaving the name blank or throwing.
 */
export type HistoryTransactionRow = {
  id: string;
  description: string;
  amount_cents: number;
  type: string;
  occurred_on: string;
  created_at: string;
  voided_at: string | null;
  void_reason: string | null;
  category: { name: string } | null;
  created_by_member: { name: string } | null;
  voided_by_member: { name: string } | null;
};

/** One row of the history view, ready to render. */
export type HistoryTransaction = {
  id: string;
  description: string;
  categoryName: string | null;
  amountCents: Cents;
  type: string;
  occurredOn: string;
  isVoided: boolean;
  voidReason: string | null;
  /** Falls back to "someone" when the creator's row is not readable -- see module comment. */
  createdByName: string;
  /** `null` when not voided; falls back to "someone" when voided but the voider's row is not readable. */
  voidedByName: string | null;
};

const UNKNOWN_MEMBER_NAME = "someone";

/**
 * Map raw `ledger_transactions` rows (plus embedded category/creator/voider)
 * to the shape the history view renders. Pure and separately testable,
 * mirroring `toRecentTransactions`.
 */
export function toHistoryTransactions(rows: readonly HistoryTransactionRow[]): HistoryTransaction[] {
  return rows.map((row) => ({
    id: row.id,
    description: row.description,
    categoryName: row.category?.name ?? null,
    amountCents: row.amount_cents,
    type: row.type,
    occurredOn: row.occurred_on,
    isVoided: row.voided_at !== null,
    voidReason: row.void_reason,
    createdByName: row.created_by_member?.name ?? UNKNOWN_MEMBER_NAME,
    voidedByName: row.voided_at !== null ? (row.voided_by_member?.name ?? UNKNOWN_MEMBER_NAME) : null,
  }));
}
