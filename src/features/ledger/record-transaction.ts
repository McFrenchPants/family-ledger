import { parseMoney } from "../../lib/currency";
import type { Cents } from "../../lib/currency";
import { isValidCalendarDate } from "../../lib/dates";
import type { ActiveMemberOption } from "./add-expense";

/**
 * `public.record_payment` / `public.record_adjustment` share one signature
 * and differ only in `type` -- see
 * `supabase/migrations/20260904233000_ledger_write_functions.sql`. This module
 * backs the combined Record Payment/Adjustment form (S2.6): one screen, a
 * type toggle, and a single RPC name chosen from `type` at submit time. Both
 * are Parent-only and both require `amount_cents < 0`.
 */
export type RecordTransactionType = "payment" | "adjustment";

/** Re-exported so call sites do not need to import from `add-expense.ts` directly. */
export type { ActiveMemberOption };

/**
 * Which active members a Parent may record a payment/adjustment against.
 *
 * Unlike `buildExpenseMemberSelector`, there is no Child-facing branch here at
 * all: `record_payment`/`record_adjustment` are Parent-only RPCs and this
 * form's route is only meaningfully reachable by a Parent (see
 * `RecordPaymentPage`'s client-side "Parents only" gate). So this is simply
 * "every active Child in the household" -- no `child_expense_scope` to
 * consult, no self-only lock.
 */
export function buildRecordMemberOptions(
  activeMembers: readonly ActiveMemberOption[],
): readonly ActiveMemberOption[] {
  return activeMembers.filter((member) => member.role === "child");
}

/** Field-level validation messages for the Record Payment/Adjustment form. */
export type RecordFormErrors = {
  memberId?: string;
  amount?: string;
  description?: string;
  occurredOn?: string;
};

export type RecordFormInput = {
  readonly memberId: string;
  /**
   * The Parent types a plain positive amount ("25.00" for a $25 payment) --
   * they are never asked to type a leading minus sign. `parseMoney` (not
   * `parsePositiveMoney`, which would reject the negative value this form
   * ultimately sends) is used here only because it is the decimal-safe
   * parser; the sign itself is applied by this function, not the caller.
   */
  readonly amountInput: string;
  readonly description: string;
  readonly occurredOn: string;
};

export type RecordFormValidation =
  | { readonly ok: true; readonly amountCents: Cents }
  | { readonly ok: false; readonly errors: RecordFormErrors };

/**
 * Validate the Record Payment/Adjustment form client-side, before any network
 * call. Mirrors `validateExpenseForm`'s shape and its documented limits: this
 * is a UX affordance, not an authorization check -- `record_payment/
 * record_adjustment` independently re-derive and enforce the Parent-only rule
 * server-side regardless of what this returns.
 *
 * The Parent types a positive dollar amount; `amountCents` returned here is
 * already negated (i.e. it is the value to send as `p_amount_cents`), so
 * callers never have to remember to flip the sign themselves.
 */
export function validateRecordForm(input: RecordFormInput): RecordFormValidation {
  const errors: RecordFormErrors = {};

  if (input.memberId.trim() === "") {
    errors.memberId = "Choose which child this is for.";
  }

  let amountCents: Cents | null = null;
  const amountResult = parseMoney(input.amountInput);
  if (!amountResult.ok) {
    errors.amount = amountResult.message;
  } else if (amountResult.cents < 0) {
    // The form only ever asks for a positive amount -- a typed leading minus
    // sign is not part of this form's grammar, so surface it as a distinct,
    // actionable error rather than silently accepting a double-negative.
    errors.amount = "Enter a positive amount (no minus sign).";
  } else if (amountResult.cents === 0) {
    errors.amount = "Amount must be greater than zero.";
  } else {
    amountCents = -amountResult.cents;
  }

  if (input.description.trim() === "") {
    errors.description = "Enter a description.";
  }

  if (!isValidCalendarDate(input.occurredOn)) {
    errors.occurredOn = "Enter a valid date.";
  }

  if (Object.keys(errors).length > 0 || amountCents === null) {
    return { ok: false, errors };
  }

  return { ok: true, amountCents };
}

/**
 * Validate a void reason client-side: `public.void_ledger_transaction`
 * rejects a null/empty (after trimming) reason with a `check_violation`, and
 * the acceptance criteria require the UI to make the action un-submittable
 * before that round-trip, not just surface the server's rejection after the
 * fact.
 */
export function validateVoidReason(reason: string): { ok: true; reason: string } | { ok: false; error: string } {
  const trimmed = reason.trim();
  if (trimmed === "") {
    return { ok: false, error: "Enter a reason for voiding this transaction." };
  }
  return { ok: true, reason: trimmed };
}
