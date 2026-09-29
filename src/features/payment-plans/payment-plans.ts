import { parsePositiveMoney } from "../../lib/currency";
import type { Cents } from "../../lib/currency";
import { compareCalendarDates, isValidCalendarDate } from "../../lib/dates";
import type { CalendarDate } from "../../lib/dates";

/**
 * S3.1's Parent payment-plan management screen (`create_payment_plan` /
 * `deactivate_payment_plan`). This module holds only pure types and
 * validation -- no React, no network -- mirroring `record-transaction.ts`'s
 * split from its page/hook.
 *
 * A member has at most one *active* plan at a time (enforced server-side);
 * this screen only ever cares about that current active plan, never a full
 * history of plans, so there is no "list all plans" type here.
 */

/**
 * The subset of `payment_plans` columns this screen actually reads
 * (`usePaymentPlan`'s `.select(...)`), camelCased. There is no UI need for
 * `household_id`/`member_id`/`frequency`/`created_by`/`created_at`/
 * `updated_at` here -- the caller already knows the household and member it
 * asked about, `frequency` is presently always monthly (not surfaced), and
 * the audit trail lives in `audit_log`, not this screen.
 */
export type PaymentPlanRow = {
  readonly id: string;
  readonly minimumCents: Cents;
  readonly dueDay: number;
  readonly startsOn: CalendarDate;
  readonly endsOn: CalendarDate | null;
  readonly active: boolean;
};

/** Raw row shape from `payment_plans.select("id, minimum_cents, due_day, starts_on, ends_on, active")`. */
export type PaymentPlanDbRow = {
  id: string;
  minimum_cents: number;
  due_day: number;
  starts_on: string;
  ends_on: string | null;
  active: boolean;
};

/** Maps a raw Supabase row (snake_case) to this module's camelCase type. */
export function toPaymentPlanRow(row: PaymentPlanDbRow): PaymentPlanRow {
  return {
    id: row.id,
    minimumCents: row.minimum_cents,
    dueDay: row.due_day,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    active: row.active,
  };
}

/** The plan-create/edit form's raw string inputs, before validation. */
export type PlanFormInput = {
  readonly minimumAmountInput: string;
  readonly dueDayInput: string;
  readonly startsOn: string;
  readonly endsOn: string;
};

/** Field-level validation messages for the plan-create/edit form. */
export type PlanFormErrors = {
  minimumAmount?: string;
  dueDay?: string;
  startsOn?: string;
  endsOn?: string;
};

export type PlanFormValidation =
  | {
      readonly ok: true;
      readonly minimumCents: Cents;
      readonly dueDay: number;
      readonly startsOn: CalendarDate;
      readonly endsOn: CalendarDate | null;
    }
  | { readonly ok: false; readonly errors: PlanFormErrors };

const MIN_DUE_DAY = 1;
const MAX_DUE_DAY = 28;
const DUE_DAY_PATTERN = /^\d+$/;

/**
 * Validate the payment-plan create/edit form client-side, before any network
 * call. A UX affordance only -- `create_payment_plan` independently re-checks
 * everything server-side (the `due_day between 1 and 28` constraint included)
 * regardless of what this returns.
 *
 * Rules:
 *  - `minimumAmountInput` must parse as a positive amount (`parsePositiveMoney`)
 *    and be greater than zero -- a $0 minimum is nonsensical for a plan.
 *  - `dueDayInput` must be an integer in `[1, 28]` (the DB sidesteps
 *    end-of-month ambiguity by disallowing 29-31; this form only ever offers
 *    valid input, but still validates in case of a stray value).
 *  - `startsOn` must be a valid calendar date.
 *  - `endsOn` is optional. Empty is fine (no end date). If non-empty it must
 *    be a valid calendar date and must not be before `startsOn`.
 */
export function validatePlanForm(input: PlanFormInput): PlanFormValidation {
  const errors: PlanFormErrors = {};

  let minimumCents: Cents | null = null;
  const amountResult = parsePositiveMoney(input.minimumAmountInput);
  if (!amountResult.ok) {
    errors.minimumAmount = amountResult.message;
  } else if (amountResult.cents === 0) {
    errors.minimumAmount = "Minimum amount must be greater than zero.";
  } else {
    minimumCents = amountResult.cents;
  }

  let dueDay: number | null = null;
  const dueDayTrimmed = input.dueDayInput.trim();
  if (dueDayTrimmed === "" || !DUE_DAY_PATTERN.test(dueDayTrimmed)) {
    errors.dueDay = "Enter a due day between 1 and 28.";
  } else {
    const parsed = Number(dueDayTrimmed);
    if (parsed < MIN_DUE_DAY || parsed > MAX_DUE_DAY) {
      errors.dueDay = "Enter a due day between 1 and 28.";
    } else {
      dueDay = parsed;
    }
  }

  if (!isValidCalendarDate(input.startsOn)) {
    errors.startsOn = "Enter a valid start date.";
  }

  let endsOn: CalendarDate | null = null;
  const endsOnTrimmed = input.endsOn.trim();
  if (endsOnTrimmed !== "") {
    if (!isValidCalendarDate(endsOnTrimmed)) {
      errors.endsOn = "Enter a valid end date.";
    } else if (
      isValidCalendarDate(input.startsOn) &&
      compareCalendarDates(endsOnTrimmed, input.startsOn) < 0
    ) {
      errors.endsOn = "End date must not be before the start date.";
    } else {
      endsOn = endsOnTrimmed;
    }
  }

  if (Object.keys(errors).length > 0 || minimumCents === null || dueDay === null) {
    return { ok: false, errors };
  }

  return { ok: true, minimumCents, dueDay, startsOn: input.startsOn, endsOn };
}
