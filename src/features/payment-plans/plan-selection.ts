import { compareCalendarDates } from "../../lib/dates";
import type { ChildPaymentProgress } from "./useChildPaymentProgress";

/** Every active plan's current period for each child; a child with none maps to []. */
export type PlansByMember = ReadonlyMap<string, readonly ChildPaymentProgress[]>;

/** How pressing a plan is: 0 overdue, 1 something still to pay, 2 paid up, 3 waived. */
function urgency(plan: ChildPaymentProgress): number {
  if (plan.periodStatus === "overdue") return 0;
  if (plan.periodStatus === "waived") return 3;
  if (plan.periodStatus === "satisfied" || plan.remainingCents <= 0) return 2;
  return 1;
}

/**
 * The one plan that speaks for a child where there is room for a single chip
 * (the Record payment child list, Family list, Home ordering): the most
 * pressing, then the earliest due. `null` when the child has no active plan.
 * Ties keep the order given.
 */
export function headlineProgress(
  plans: readonly ChildPaymentProgress[] | undefined,
): ChildPaymentProgress | null {
  let best: ChildPaymentProgress | null = null;
  for (const plan of plans ?? []) {
    if (best === null) {
      best = plan;
      continue;
    }
    const diff = urgency(plan) - urgency(best);
    if (diff < 0 || (diff === 0 && compareCalendarDates(plan.dueDate, best.dueDate) < 0)) {
      best = plan;
    }
  }
  return best;
}

/** The plan on one balance, if the child has one. */
export function planOnBalance(
  plans: readonly ChildPaymentProgress[] | undefined,
  balanceId: string,
): ChildPaymentProgress | null {
  return (plans ?? []).find((plan) => plan.balanceId === balanceId) ?? null;
}
