/**
 * Pure presentation helpers for the Add expense and Record payment screens:
 * the "balance after" previews, the payment amount shortcuts, the category
 * icons and the date chips. No React, no network.
 *
 * Every number here is integer cents, and every preview is display-only: the
 * server stays the authority on what a write does. Record payment's success
 * panel still shows the server-fetched balance after the write, never these
 * numbers.
 */
import { MINUS } from "../../components/ui/AmountText";
import type { IconName } from "../../components/ui/icon-paths";
import { formatCents, parseMoney } from "../../lib/currency";
import type { Cents } from "../../lib/currency";
import { addDays } from "../../lib/dates";
import type { CalendarDate } from "../../lib/dates";
import type { ChildPaymentProgress } from "../payment-plans/useChildPaymentProgress";

/* ------------------------------------------------------------------ */
/* Amounts                                                             */
/* ------------------------------------------------------------------ */

/**
 * The typed amount as positive cents, or null when it is not (yet) a valid
 * amount above zero. Uses the same decimal-safe parser as the validators;
 * this only decides whether a live preview can be shown, never whether the
 * form may be submitted (the validators do that).
 */
export function typedAmountCents(amountInput: string): Cents | null {
  const parsed = parseMoney(amountInput);
  if (!parsed.ok || parsed.cents <= 0) return null;
  return parsed.cents;
}

/** Balance after an expense of `amountCents` (positive) is added. */
export function balanceAfterExpense(balanceCents: Cents, amountCents: Cents): Cents {
  return balanceCents + amountCents;
}

/**
 * Balance after a payment or adjustment of `magnitudeCents` (the positive
 * amount the Parent typed; the ledger row itself is negative).
 */
export function balanceAfterPayment(balanceCents: Cents, magnitudeCents: Cents): Cents {
  return balanceCents - magnitudeCents;
}

/** Money for display with a true minus sign for negative values. */
export function formatSignedCents(cents: Cents, locale?: string): string {
  return formatCents(cents, { locale }).replace("-", MINUS);
}

/* ------------------------------------------------------------------ */
/* Who the entry is for                                                */
/* ------------------------------------------------------------------ */

/** The person an entry is for, as the sentence should name them. */
export type EntryPerson = { readonly name: string; readonly self: boolean };

/** "Alex’s" / "your". */
export function possessive(person: EntryPerson): string {
  return person.self ? "your" : `${person.name}’s`;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * The Add expense button: "Add $42.17 to Alex’s balance", or plain
 * "Add expense" until there is a valid amount and a person.
 */
export function addExpenseButtonLabel(
  amountCents: Cents | null,
  person: EntryPerson | null,
  locale?: string,
): string {
  if (amountCents === null || person === null) return "Add expense";
  return `Add ${formatCents(amountCents, { locale })} to ${possessive(person)} balance`;
}

/**
 * The line under the Add expense button: "Alex’s balance will be $229.49",
 * or, if the balance would end up below zero, "Alex will be $5.00 in
 * credit". Null when there is nothing honest to show (no valid amount yet, or
 * the person's balance is not known to this caller).
 */
export function expensePreviewLine(
  balanceCents: Cents | null,
  amountCents: Cents | null,
  person: EntryPerson | null,
  locale?: string,
): string | null {
  if (balanceCents === null || amountCents === null || person === null) return null;
  const after = balanceAfterExpense(balanceCents, amountCents);
  if (after < 0) {
    return `${person.self ? "You" : person.name} will be ${formatCents(-after, { locale })} in credit`;
  }
  return `${capitalise(possessive(person))} balance will be ${formatCents(after, { locale })}`;
}

export type PaymentPreview = {
  /** "Alex’s balance goes from $187.32 to $172.32". */
  readonly line: string;
  /** "Alex will be $5.00 in credit." when the balance would go below zero. */
  readonly creditLine: string | null;
  /**
   * "This is more than Alex owes." -- a gentle, non-blocking note. Never
   * used to stop the form being submitted.
   */
  readonly overNote: string | null;
};

/**
 * The "What this will do" preview for a payment or adjustment. Null when the
 * amount is not valid yet or the balance is not known.
 */
export function paymentPreview(
  balanceCents: Cents | null,
  magnitudeCents: Cents | null,
  name: string,
  locale?: string,
): PaymentPreview | null {
  if (balanceCents === null || magnitudeCents === null) return null;
  const after = balanceAfterPayment(balanceCents, magnitudeCents);
  return {
    line: `${name}’s balance goes from ${formatSignedCents(balanceCents, locale)} to ${formatSignedCents(after, locale)}`,
    creditLine: after < 0 ? `${name} will be ${formatCents(-after, { locale })} in credit.` : null,
    overNote: magnitudeCents > balanceCents ? `This is more than ${name} owes.` : null,
  };
}

/** "Record $15.00 from Alex" / "Record $15.00 adjustment for Alex". */
export function recordButtonLabel(
  type: "payment" | "adjustment",
  amountCents: Cents | null,
  name: string | null,
  locale?: string,
): string {
  if (amountCents === null || name === null) {
    return type === "payment" ? "Record payment" : "Record adjustment";
  }
  const money = formatCents(amountCents, { locale });
  return type === "payment"
    ? `Record ${money} from ${name}`
    : `Record ${money} adjustment for ${name}`;
}

/* ------------------------------------------------------------------ */
/* Payment shortcuts                                                   */
/* ------------------------------------------------------------------ */

export type PaymentShortcut = {
  readonly kind: "catch-up" | "minimum" | "full";
  readonly cents: Cents;
  /** "Catch up $15.00" / "Minimum $40.00" / "Pay in full $187.32". */
  readonly label: string;
};

/**
 * Amount shortcuts for a payment, from what the page already knows:
 *
 * - period overdue with something left -> "Catch up" (what is left);
 * - otherwise due / partially paid / upcoming with something left ->
 *   "Minimum" (what is left of this period's minimum);
 * - anything owed -> "Pay in full" (the whole balance).
 *
 * A period shortcut never exceeds the balance; two shortcuts for the same
 * amount collapse to the first. `progress` is `null` for "no plan" and
 * `undefined` when plan status is unknown (loading or failed): both give
 * only "Pay in full". An unknown balance, or nothing owed, gives none.
 */
export function paymentShortcuts(
  balanceCents: Cents | null,
  progress: ChildPaymentProgress | null | undefined,
  locale?: string,
): PaymentShortcut[] {
  if (balanceCents === null || balanceCents <= 0) return [];
  const money = (cents: Cents) => formatCents(cents, { locale });
  const candidates: PaymentShortcut[] = [];

  if (progress && progress.remainingCents > 0) {
    const cents = Math.min(progress.remainingCents, balanceCents);
    if (progress.periodStatus === "overdue") {
      candidates.push({ kind: "catch-up", cents, label: `Catch up ${money(cents)}` });
    } else if (
      progress.periodStatus === "due" ||
      progress.periodStatus === "partially_paid" ||
      progress.periodStatus === "upcoming"
    ) {
      candidates.push({ kind: "minimum", cents, label: `Minimum ${money(cents)}` });
    }
  }

  candidates.push({ kind: "full", cents: balanceCents, label: `Pay in full ${money(balanceCents)}` });

  const seen = new Set<Cents>();
  return candidates.filter((shortcut) => {
    if (seen.has(shortcut.cents)) return false;
    seen.add(shortcut.cents);
    return true;
  });
}

/* ------------------------------------------------------------------ */
/* Categories                                                          */
/* ------------------------------------------------------------------ */

const CATEGORY_ICON_WORDS: ReadonlyArray<[RegExp, IconName]> = [
  [/\b(gas|fuel|petrol)\b/, "fuel"],
  [/\b(food|grocer\w*|meal\w*|lunch|dinner|snack\w*|restaurant\w*|eat\w*)\b/, "food"],
  [/\b(phone|mobile|cell)\b/, "phone"],
  [/\b(auto|car|vehicle|insurance|repair\w*)\b/, "car"],
  [/\b(fun|entertainment|movie\w*|game\w*|ticket\w*|event\w*)\b/, "ticket"],
  [/\b(school|book\w*|tuition|class\w*|education)\b/, "book"],
  [/\b(household|home|house|rent|utilit\w*)\b/, "home"],
];

/**
 * Categories are free text the household names, so the tile icon is a
 * best-effort guess from the name; anything unrecognised gets a tag.
 */
export function categoryIcon(name: string): IconName {
  const lower = name.toLowerCase();
  for (const [pattern, icon] of CATEGORY_ICON_WORDS) {
    if (pattern.test(lower)) return icon;
  }
  return "tag";
}

/* ------------------------------------------------------------------ */
/* Date chips                                                          */
/* ------------------------------------------------------------------ */

export type DateChoice = "today" | "yesterday" | "pick";

/**
 * Which date chip a chosen date corresponds to. `today` must be today in the
 * household's time zone (`todayInZone`), never the browser's clock.
 */
export function dateChoiceFor(occurredOn: string, today: CalendarDate): DateChoice {
  if (occurredOn === today) return "today";
  if (occurredOn === addDays(today, -1)) return "yesterday";
  return "pick";
}

/** The date a chip stands for; `pick` keeps whatever is already chosen. */
export function dateForChoice(
  choice: DateChoice,
  today: CalendarDate,
  current: string,
): string {
  if (choice === "today") return today;
  if (choice === "yesterday") return addDays(today, -1);
  return current;
}
