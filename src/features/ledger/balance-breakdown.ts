import { formatCents, type Cents } from "../../lib/currency";
import { owedWords } from "./payment-split";

/**
 * Pure view-model for "what a child owes, by balance". Display only: the
 * numbers come from `household_member_balance_breakdown`, whose parts per
 * child always add up to that child's total, and nothing here changes them.
 */

/** A tracked balance as the screens know it (archived ones included, so old rows keep a name). */
export type BalanceInfo = {
  readonly id: string;
  readonly name: string;
  readonly isEveryday: boolean;
  readonly active: boolean;
};

export type BreakdownLine = {
  readonly balanceId: string;
  readonly name: string;
  readonly isEveryday: boolean;
  /** Negative = credit. */
  readonly cents: Cents;
  /** "$12.00 owed" / "$5.00 in credit" -- the app's existing wording. */
  readonly words: string;
};

/**
 * The balances worth showing for one child, in the household's order
 * (Everyday first). A balance is hidden when it owes nothing and has no
 * active plan; credit (negative) is kept and shown as credit.
 *
 * When only Everyday would be left, the breakdown adds nothing beyond the
 * total, so the result is empty and the screen looks as it always did.
 * `owed` undefined (not loaded or failed) also gives no lines.
 */
export function breakdownLines(
  balances: readonly BalanceInfo[],
  owed: ReadonlyMap<string, Cents> | undefined,
  planBalanceIds: ReadonlySet<string>,
): BreakdownLine[] {
  if (!owed) return [];
  const lines = balances
    .filter((balance) => (owed.get(balance.id) ?? 0) !== 0 || planBalanceIds.has(balance.id))
    .map((balance) => {
      const cents = owed.get(balance.id) ?? 0;
      return {
        balanceId: balance.id,
        name: balance.name,
        isEveryday: balance.isEveryday,
        cents,
        words: owedWords(cents),
      };
    });
  if (lines.length === 0 || (lines.length === 1 && lines[0]!.isEveryday)) return [];
  return lines;
}

/**
 * The name to put in front of a plan or shortcut, or null when the household
 * has no balance besides Everyday (so nothing needs naming) or the balance is
 * unknown.
 */
export function balanceLabeler(
  balances: readonly BalanceInfo[] | null,
): (balanceId: string) => string | null {
  const byId = new Map((balances ?? []).map((balance) => [balance.id, balance]));
  const hasOthers = (balances ?? []).some((balance) => !balance.isEveryday);
  return (balanceId) => {
    const balance = byId.get(balanceId);
    if (!balance || !hasOthers) return null;
    return balance.name;
  };
}

/* ------------------------------------------------------------------ */
/* Activity: payment splits and balance moves                          */
/* ------------------------------------------------------------------ */

export type AllocationPart = { readonly balanceId: string; readonly cents: Cents };

/**
 * How a payment or adjustment was split, e.g. "$300.00 Car · $200.00 College".
 * More than one part lists every part with its amount; a single part to
 * Everyday gives null (the row looks as it always did); a single part to
 * another balance reads "Applied to Car". Unknown balances read "another balance".
 */
export function splitText(
  parts: readonly AllocationPart[] | undefined,
  balances: readonly BalanceInfo[] | null,
  locale?: string,
): string | null {
  if (!parts || parts.length === 0) return null;
  const byId = new Map((balances ?? []).map((balance) => [balance.id, balance]));
  const nameOf = (id: string) => byId.get(id)?.name ?? "another balance";

  if (parts.length === 1) {
    const only = parts[0]!;
    return byId.get(only.balanceId)?.isEveryday === true
      ? null
      : `Applied to ${nameOf(only.balanceId)}`;
  }
  return parts
    .map((part) => `${formatCents(part.cents, { locale })} ${nameOf(part.balanceId)}`)
    .join(" · ");
}

/** "Moved $150.00 from Everyday to Car". */
export function transferText(
  transfer: { fromBalanceId: string; toBalanceId: string; amountCents: Cents },
  balances: readonly BalanceInfo[] | null,
  locale?: string,
): string {
  const byId = new Map((balances ?? []).map((balance) => [balance.id, balance.name]));
  const nameOf = (id: string) => byId.get(id) ?? "another balance";
  return `Moved ${formatCents(transfer.amountCents, { locale })} from ${nameOf(transfer.fromBalanceId)} to ${nameOf(transfer.toBalanceId)}`;
}
