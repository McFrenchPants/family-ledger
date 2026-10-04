import { parseMoney } from "../../lib/currency";
import type { Cents } from "../../lib/currency";
import { isValidCalendarDate } from "../../lib/dates";
import type { CalendarDate } from "../../lib/dates";
import type { BalanceInfo } from "./balance-breakdown";
import { splitText } from "./balance-breakdown";
import { validateSplit } from "./payment-split";
import type { SplitPart, SplitRow } from "./payment-split";

/**
 * Pure logic behind a Child's "Tell a parent about a payment" form and the
 * lists that show suggestions. A suggestion changes no balance: it is a note
 * to a Parent, who records the real payment. Everything here is display/UX;
 * `create_payment_suggestion` re-checks every rule in the database.
 */

export type SuggestionStatus = "pending" | "converted" | "dismissed" | "withdrawn";

/** A suggestion as the screens use it (read from `payment_suggestions` + parts). */
export type SuggestionView = {
  readonly id: string;
  readonly memberId: string;
  readonly amountCents: Cents;
  readonly suggestedOn: CalendarDate;
  readonly note: string | null;
  readonly status: SuggestionStatus;
  /** The Parent's reason when dismissed. */
  readonly resolutionNote: string | null;
  readonly createdAt: string;
  readonly parts: readonly SplitPart[];
};

export type SuggestionFormErrors = { amount?: string; occurredOn?: string; split?: string };

export type SuggestionFormValidation =
  | {
      readonly ok: true;
      readonly rpcArgs: {
        p_member_id: string;
        p_amount_cents: Cents;
        p_suggested_on: CalendarDate;
        p_note: string | null;
        /** null = the whole amount on Everyday. */
        p_parts: { tracked_balance_id: string; amount_cents: Cents }[] | null;
      };
    }
  | { readonly ok: false; readonly errors: SuggestionFormErrors };

/**
 * Validate the form and build the exact `create_payment_suggestion`
 * arguments. `splitRows` is null when the child did not open the split, which
 * means "all Everyday" and sends no parts at all.
 */
export function buildSuggestionRequest(input: {
  memberId: string;
  amountInput: string;
  occurredOn: string;
  note: string;
  splitRows: readonly SplitRow[] | null;
}): SuggestionFormValidation {
  const errors: SuggestionFormErrors = {};

  const parsed = parseMoney(input.amountInput);
  let amountCents: Cents = 0;
  if (!parsed.ok) errors.amount = parsed.message;
  else if (parsed.cents <= 0) errors.amount = "Enter an amount above zero.";
  else amountCents = parsed.cents;

  if (!isValidCalendarDate(input.occurredOn)) errors.occurredOn = "Choose the date you paid.";

  let parts: SplitPart[] | null = null;
  if (input.splitRows !== null && !errors.amount) {
    const split = validateSplit(amountCents, input.splitRows);
    if (!split.ok) errors.split = split.message;
    else parts = split.parts;
  }

  if (errors.amount || errors.occurredOn || errors.split) return { ok: false, errors };

  const trimmed = input.note.trim();
  return {
    ok: true,
    rpcArgs: {
      p_member_id: input.memberId,
      p_amount_cents: amountCents,
      p_suggested_on: input.occurredOn,
      p_note: trimmed === "" ? null : trimmed,
      p_parts: parts?.map((part) => ({
        tracked_balance_id: part.balanceId,
        amount_cents: part.cents,
      })) ?? null,
    },
  };
}

/** What happened to a suggestion, in the child's words. */
export function suggestionOutcome(suggestion: Pick<SuggestionView, "status" | "resolutionNote">): string {
  switch (suggestion.status) {
    case "pending":
      return "Waiting for a parent";
    case "converted":
      return "Recorded by a parent";
    case "withdrawn":
      return "You withdrew this";
    case "dismissed":
      return suggestion.resolutionNote
        ? `A parent dismissed this: ${suggestion.resolutionNote}`
        : "A parent dismissed this";
  }
}

/** How the proposed split reads ("$30.00 Car · $20.00 Everyday"); null for a plain all-Everyday suggestion. */
export function suggestionSplitText(
  suggestion: Pick<SuggestionView, "parts">,
  balances: readonly BalanceInfo[] | null,
): string | null {
  return splitText(suggestion.parts, balances);
}

type SuggestionRow = {
  id: string;
  member_id: string;
  amount_cents: number;
  suggested_on: CalendarDate;
  note: string | null;
  status: string;
  resolution_note: string | null;
  created_at: string;
  payment_suggestion_parts: { tracked_balance_id: string; amount_cents: number }[] | null;
};

export type PaymentSuggestionRow = SuggestionRow;

export function toSuggestionView(row: SuggestionRow): SuggestionView {
  return {
    id: row.id,
    memberId: row.member_id,
    amountCents: row.amount_cents,
    suggestedOn: row.suggested_on,
    note: row.note,
    status: row.status as SuggestionStatus,
    resolutionNote: row.resolution_note,
    createdAt: row.created_at,
    parts: (row.payment_suggestion_parts ?? []).map((part) => ({
      balanceId: part.tracked_balance_id,
      cents: part.amount_cents,
    })),
  };
}

/** Pending first (newest first), then the few most recent finished ones. */
export function childSuggestionList(
  suggestions: readonly SuggestionView[],
  finishedLimit = 3,
): SuggestionView[] {
  const newestFirst = [...suggestions].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return [
    ...newestFirst.filter((suggestion) => suggestion.status === "pending"),
    ...newestFirst.filter((suggestion) => suggestion.status !== "pending").slice(0, finishedLimit),
  ];
}

/** The Record payment address that pre-fills from a suggestion. */
export function recordFromSuggestionPath(suggestion: Pick<SuggestionView, "id" | "memberId">): string {
  return `/new/payment?child=${encodeURIComponent(suggestion.memberId)}&suggestion=${encodeURIComponent(suggestion.id)}`;
}
