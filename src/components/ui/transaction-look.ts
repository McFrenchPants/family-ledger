import type { IconName } from "./icon-paths";

/**
 * Icon, icon-box colours and label for a ledger row, by transaction type.
 * One table for every list (Home, Activity, a member's page) so the same
 * entry looks the same everywhere; payments use the check mark, as in the
 * mockups.
 */
export type TransactionLook = { icon: IconName; box: string; label: string };

const TRANSACTION_LOOK: Record<string, TransactionLook> = {
  payment: { icon: "check", box: "bg-ok-soft text-ok", label: "Payment" },
  adjustment: { icon: "edit", box: "bg-accent-soft text-accent-text", label: "Adjustment" },
  expense: { icon: "tag", box: "bg-sunken text-muted", label: "Expense" },
};

/** Look for a transaction type; unknown types fall back to the expense look. */
export function transactionLook(type: string): TransactionLook {
  return TRANSACTION_LOOK[type] ?? TRANSACTION_LOOK.expense!;
}
