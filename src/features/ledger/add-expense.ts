import { parsePositiveMoney } from "../../lib/currency";
import type { Cents } from "../../lib/currency";
import { isValidCalendarDate } from "../../lib/dates";
import type { CalendarDate } from "../../lib/dates";
import type { MembershipRole } from "../auth/membership-context";

/**
 * `households.child_expense_scope`'s two allowed values (see
 * `households_child_expense_scope_check` in
 * `supabase/migrations/20260904223000_ledger_schema.sql`).
 * `useAddExpenseFormData` now reads this for real via
 * `households_select_member`
 * (`supabase/migrations/20260905020000_household_settings_and_sibling_read_access.sql`),
 * so a `"loaded"` form state always carries a genuine value -- `null` is
 * accepted by `buildExpenseMemberSelector` below only as defensive
 * unknown-value handling, not as an expected steady state.
 */
export type ChildExpenseScope = "any_member" | "self_only";

/** A household member the caller might record an expense against. */
export type ActiveMemberOption = {
  readonly id: string;
  readonly name: string;
  readonly role: string;
};

/** An active category the caller might file the expense under. */
export type CategoryOption = {
  readonly id: string;
  readonly name: string;
};

/** What the "who is this expense for" control should show and pre-select. */
export type ExpenseMemberSelector = {
  /** Choices to render, in display order. Never empty when `locked` is true. */
  readonly options: readonly ActiveMemberOption[];
  /**
   * True when the caller has no real choice and the control should render as
   * fixed text (or a disabled control), not an interactive selector.
   */
  readonly locked: boolean;
  /** The option id to pre-select, or `null` if there is nothing to select. */
  readonly defaultMemberId: string | null;
};

/**
 * Decide which household members a caller may record an expense against, and
 * whether that choice should be offered as a selector at all.
 *
 * Reasoning, per role:
 *
 * - Parent: the product's core use case is a Parent logging money a *child*
 *   owes them (PROJECT_REQUIREMENTS.md's household ledger is framed entirely
 *   around children's balances). `record_expense` technically accepts any
 *   active member id, including another Parent's, but exposing that in the
 *   selector would let a Parent record an "expense" against another Parent's
 *   membership -- a case the product has no concept of (Parents do not have
 *   a tracked balance anywhere else in this app) and that would just be
 *   confusing UI surface for no real use case. So the Parent selector is
 *   Children only.
 *
 * - Child, `childExpenseScope === "self_only"` (or `null`, unknown -- see
 *   below): locked to the caller's own membership. No dropdown, no illusion
 *   of choice.
 *
 * - Child, `childExpenseScope === "any_member"`: offered a selector of
 *   active Children (siblings + self). `activeMembers` for a Child caller in
 *   an `any_member` household now genuinely includes their active siblings
 *   (`household_members_select_siblings_when_any_member`,
 *   `supabase/migrations/20260905020000_household_settings_and_sibling_read_access.sql`),
 *   so this produces a real multi-option selector rather than degenerating
 *   to a single-option one. `locked` still reflects the actual option count
 *   directly (`true` whenever there is at most one option, e.g. an only
 *   child) rather than hard-coding on `childExpenseScope` alone -- that
 *   stays correct regardless of household composition.
 *
 * `childExpenseScope === null` is treated exactly like `"self_only"`. In
 * practice `useAddExpenseFormData` never produces `null` for a `"loaded"`
 * state any more (see its doc comment), so this branch is defensive
 * unknown-value handling, not a documented gap. It never under-*enforces*
 * anything either way since `record_expense` re-checks the real scope
 * server-side regardless; it only avoids showing a Child a sibling-selecting
 * control that the server might reject.
 */
export function buildExpenseMemberSelector(params: {
  readonly callerRole: MembershipRole;
  readonly callerMemberId: string;
  readonly callerName: string;
  readonly activeMembers: readonly ActiveMemberOption[];
  readonly childExpenseScope: ChildExpenseScope | null;
}): ExpenseMemberSelector {
  const { callerRole, callerMemberId, callerName, activeMembers, childExpenseScope } = params;

  if (callerRole === "parent") {
    const options = activeMembers.filter((member) => member.role === "child");
    return {
      options,
      locked: false,
      defaultMemberId: options[0]?.id ?? null,
    };
  }

  if (childExpenseScope === "any_member") {
    const children = activeMembers.filter((member) => member.role === "child");
    // Defensive: the caller should always appear in `activeMembers` (their
    // own row is always RLS-visible to themselves), but do not let a
    // surprising omission produce a selector that cannot represent "myself".
    const options = children.some((member) => member.id === callerMemberId)
      ? children
      : [...children, { id: callerMemberId, name: callerName, role: "child" }];

    return {
      options,
      locked: options.length <= 1,
      defaultMemberId: callerMemberId,
    };
  }

  // "self_only", or null (unknown -- conservative fallback, see doc comment).
  return {
    options: [{ id: callerMemberId, name: callerName, role: "child" }],
    locked: true,
    defaultMemberId: callerMemberId,
  };
}

/** Field-level validation messages for the Add Expense form. */
export type ExpenseFormErrors = {
  memberId?: string;
  amount?: string;
  description?: string;
  occurredOn?: string;
};

export type ExpenseFormInput = {
  readonly memberId: string;
  readonly amountInput: string;
  readonly description: string;
  readonly occurredOn: string;
};

export type ExpenseFormValidation =
  | { readonly ok: true; readonly amountCents: Cents }
  | { readonly ok: false; readonly errors: ExpenseFormErrors };

/**
 * Validate the Add Expense form client-side, before any network call.
 *
 * This is a UX affordance, matching `parsePositiveMoney`'s own module
 * comment: the amount is parsed decimal-safely and rejected if zero or
 * malformed, but the *authorization* rule ("a Child recording for someone
 * else may be rejected") is never checked here -- that is `record_expense`'s
 * job, server-side, and this function does not try to predict its answer.
 */
export function validateExpenseForm(input: ExpenseFormInput): ExpenseFormValidation {
  const errors: ExpenseFormErrors = {};

  if (input.memberId.trim() === "") {
    errors.memberId = "Choose who this expense is for.";
  }

  let amountCents: Cents | null = null;
  const amountResult = parsePositiveMoney(input.amountInput);
  if (!amountResult.ok) {
    errors.amount = amountResult.message;
  } else if (amountResult.cents === 0) {
    // parsePositiveMoney accepts 0 (it only rejects negative); record_expense
    // requires amount_cents > 0, so 0 is a distinct, client-checkable error.
    errors.amount = "Amount must be greater than zero.";
  } else {
    amountCents = amountResult.cents;
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

/** Re-exported for callers that only need the type, not the validator. */
export type { CalendarDate };
