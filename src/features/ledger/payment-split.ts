import { formatCents, parseMoney, sumCents, toDecimalString } from "../../lib/currency";
import type { Cents } from "../../lib/currency";
import { compareCalendarDates } from "../../lib/dates";
import type { CalendarDate } from "../../lib/dates";

/**
 * Pure logic behind the "Where does this go?" split editor on Record payment
 * and the Move money form. Everything here is integer-cent arithmetic and is
 * display/UX only: the database re-checks every rule (parts positive, no
 * duplicate balance, balances active and in the household, parts summing
 * exactly to the payment).
 */

export type SplitBalance = {
  readonly id: string;
  readonly name: string;
  readonly isEveryday: boolean;
};

/** One line of the editor. The amount stays text so half-typed input survives. */
export type SplitRow = {
  readonly key: string;
  readonly balanceId: string;
  readonly amountInput: string;
};

export type SplitPart = { readonly balanceId: string; readonly cents: Cents };

/** A plan's current period on one balance, as read from the server. */
export type PlanTarget = {
  readonly balanceId: string;
  readonly periodStart: CalendarDate;
  readonly dueDate: CalendarDate;
  readonly minimumCents: Cents;
  /** Clamped to >= 0. */
  readonly remainingCents: Cents;
};

/** What each balance currently owes (negative = credit). */
export type OwedByBalance = ReadonlyMap<string, Cents>;

/**
 * The starting split for a payment of `amountCents`:
 *  1. each plan's remaining minimum for its current period, earliest due date
 *     first, never more than what is left of the payment;
 *  2. whatever is still unassigned goes to `lastUsedBalanceId` if that balance
 *     is still available, otherwise to Everyday.
 * Always sums to `amountCents` (when it is positive) and never repeats a balance.
 */
export function suggestSplit(input: {
  amountCents: Cents;
  balances: readonly SplitBalance[];
  targets: readonly PlanTarget[];
  lastUsedBalanceId: string | null;
}): SplitPart[] {
  const { amountCents, balances, targets, lastUsedBalanceId } = input;
  const everyday = balances.find((balance) => balance.isEveryday) ?? balances[0];
  if (!everyday || amountCents <= 0) return [];

  const available = new Set(balances.map((balance) => balance.id));
  const parts: { balanceId: string; cents: Cents }[] = [];
  const add = (balanceId: string, cents: Cents) => {
    const existing = parts.find((part) => part.balanceId === balanceId);
    if (existing) existing.cents += cents;
    else parts.push({ balanceId, cents });
  };

  let left = amountCents;
  const ordered = targets
    .filter((target) => target.remainingCents > 0 && available.has(target.balanceId))
    .map((target, index) => ({ target, index }))
    .sort(
      (a, b) => compareCalendarDates(a.target.dueDate, b.target.dueDate) || a.index - b.index,
    );
  for (const { target } of ordered) {
    if (left === 0) break;
    const take = Math.min(left, target.remainingCents);
    add(target.balanceId, take);
    left -= take;
  }

  if (left > 0) {
    add(
      lastUsedBalanceId !== null && available.has(lastUsedBalanceId)
        ? lastUsedBalanceId
        : everyday.id,
      left,
    );
  }
  return parts;
}

export function rowsFromParts(parts: readonly SplitPart[]): SplitRow[] {
  return parts.map((part, index) => ({
    key: `r${index}`,
    balanceId: part.balanceId,
    amountInput: toDecimalString(part.cents),
  }));
}

export type SplitValidation =
  | { readonly ok: true; readonly parts: SplitPart[] }
  | { readonly ok: false; readonly message: string };

/** What is left of `amountCents` after the rows that parse as positive amounts. */
export function remainingToAssign(amountCents: Cents, rows: readonly SplitRow[]): Cents {
  const assigned = rows.map((row) => {
    const parsed = parseMoney(row.amountInput);
    return parsed.ok && parsed.cents > 0 ? parsed.cents : 0;
  });
  return amountCents - sumCents(assigned);
}

/** The save gate: every row has a balance and a positive amount, no balance twice, parts add up exactly. */
export function validateSplit(amountCents: Cents, rows: readonly SplitRow[]): SplitValidation {
  if (rows.length === 0) return { ok: false, message: "Add at least one balance." };

  const parts: SplitPart[] = [];
  for (const row of rows) {
    const parsed = parseMoney(row.amountInput);
    if (row.balanceId === "" || !parsed.ok || parsed.cents <= 0) {
      return { ok: false, message: "Give every balance a positive amount." };
    }
    parts.push({ balanceId: row.balanceId, cents: parsed.cents });
  }

  if (new Set(parts.map((part) => part.balanceId)).size !== parts.length) {
    return { ok: false, message: "Each balance can only be used once." };
  }

  const remaining = amountCents - sumCents(parts.map((part) => part.cents));
  if (remaining > 0) return { ok: false, message: `${formatCents(remaining)} still to assign.` };
  if (remaining < 0) {
    return { ok: false, message: `${formatCents(-remaining)} too much -- reduce a part.` };
  }
  return { ok: true, parts };
}

/** Parts that are more than their balance currently owes, so would leave it in credit. */
export function creditedBalanceIds(
  parts: readonly SplitPart[],
  owed: OwedByBalance | null,
): string[] {
  if (owed === null) return [];
  return parts
    .filter((part) => part.cents > (owed.get(part.balanceId) ?? 0))
    .map((part) => part.balanceId);
}

export type BalanceAfter = { balanceId: string; before: Cents; after: Cents };

export function balancesAfter(parts: readonly SplitPart[], owed: OwedByBalance): BalanceAfter[] {
  return parts.map((part) => {
    const before = owed.get(part.balanceId) ?? 0;
    return { balanceId: part.balanceId, before, after: before - part.cents };
  });
}

/**
 * Plain-English effect on each plan's current period for the parts that land
 * on that plan's balance. A payment dated before the period began does not
 * count toward it, so it is skipped (the confirmation shows the server's view).
 */
export function planEffects(input: {
  parts: readonly SplitPart[];
  targets: readonly PlanTarget[];
  occurredOn: CalendarDate;
}): { balanceId: string; remainingAfterCents: Cents }[] {
  const effects: { balanceId: string; remainingAfterCents: Cents }[] = [];
  for (const target of input.targets) {
    const part = input.parts.find((candidate) => candidate.balanceId === target.balanceId);
    if (!part || compareCalendarDates(input.occurredOn, target.periodStart) < 0) continue;
    effects.push({
      balanceId: target.balanceId,
      remainingAfterCents: Math.max(0, target.remainingCents - part.cents),
    });
  }
  return effects;
}

/** The balance that received the most (first wins a tie): remembered per child as the default for next time. */
export function largestPartBalanceId(parts: readonly SplitPart[]): string | null {
  let best: SplitPart | null = null;
  for (const part of parts) {
    if (best === null || part.cents > best.cents) best = part;
  }
  return best?.balanceId ?? null;
}

/** "$12.00 owed" / "$5.00 in credit" / "nothing owed". */
export function owedWords(cents: Cents): string {
  if (cents === 0) return "nothing owed";
  return cents < 0 ? `${formatCents(-cents)} in credit` : `${formatCents(cents)} owed`;
}

// ---------------------------------------------------------------------------
// Move money
// ---------------------------------------------------------------------------

export type TransferErrors = { from?: string; to?: string; amount?: string };

export type TransferValidation =
  | { ok: true; amountCents: Cents }
  | { ok: false; errors: TransferErrors };

export function validateTransfer(input: {
  fromId: string;
  toId: string;
  amountInput: string;
}): TransferValidation {
  const errors: TransferErrors = {};
  if (input.fromId === "") errors.from = "Choose the balance to move from.";
  if (input.toId === "") errors.to = "Choose the balance to move to.";
  if (input.fromId !== "" && input.fromId === input.toId) {
    errors.to = "Choose two different balances.";
  }
  const parsed = parseMoney(input.amountInput);
  if (!parsed.ok) errors.amount = parsed.message;
  else if (parsed.cents <= 0) errors.amount = "Enter an amount above zero.";

  if (errors.from || errors.to || errors.amount || !parsed.ok) return { ok: false, errors };
  return { ok: true, amountCents: parsed.cents };
}

/**
 * A transfer from X to Y moves paid credit: X's balance goes UP by the amount
 * and Y's goes DOWN by it. The child's total never changes.
 */
export function transferPreview(input: {
  fromBefore: Cents;
  toBefore: Cents;
  amountCents: Cents;
}): { fromAfter: Cents; toAfter: Cents } {
  return {
    fromAfter: input.fromBefore + input.amountCents,
    toAfter: input.toBefore - input.amountCents,
  };
}
