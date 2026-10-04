import { supabase } from "../../lib/supabase";
import type { CalendarDate } from "../../lib/dates";
import type { ChildPaymentProgress, PaymentPeriodStatus } from "./useChildPaymentProgress";

/** An active plan row, as selected by the progress hooks. */
export type ActivePlanRef = { id: string; tracked_balance_id: string };

type PaymentPeriodRow = { id: string; due_date: CalendarDate };

type PaymentPeriodStatusRow = {
  period_id: string;
  status: PaymentPeriodStatus;
  minimum_cents: number;
  paid_cents: number;
  remaining_cents: number;
};

/**
 * One active plan's current period and its status, from the server
 * (`ensure_current_payment_period` then `payment_period_status`). Throws with
 * the server's message on any failure so the calling hook can show one error
 * state for the whole batch. `remainingCents` is clamped to >= 0 for display.
 */
export async function fetchPlanProgress(plan: ActivePlanRef): Promise<ChildPaymentProgress> {
  const { data: periodRaw, error: periodError } = await supabase.rpc(
    "ensure_current_payment_period",
    { p_plan_id: plan.id },
  );
  if (periodError) throw new Error(periodError.message);

  // `ensure_current_payment_period` returns a single `payment_periods` row
  // (not a set), so PostgREST hands back the object directly.
  const period = periodRaw as PaymentPeriodRow | null;
  if (!period) throw new Error("Could not load the current payment period.");

  const { data: statusData, error: statusError } = await supabase.rpc("payment_period_status", {
    p_period_id: period.id,
  });
  if (statusError) throw new Error(statusError.message);

  const statusRow = ((statusData ?? []) as PaymentPeriodStatusRow[])[0];
  if (!statusRow) throw new Error("Could not load the current payment period's status.");

  return {
    balanceId: plan.tracked_balance_id,
    periodStatus: statusRow.status,
    minimumCents: statusRow.minimum_cents,
    paidCents: statusRow.paid_cents,
    remainingCents: Math.max(0, statusRow.remaining_cents),
    dueDate: period.due_date,
  };
}
