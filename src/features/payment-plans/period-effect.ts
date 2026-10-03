import { supabase } from "../../lib/supabase";
import { addMonths, compareCalendarDates } from "../../lib/dates";
import type { CalendarDate } from "../../lib/dates";
import type { Cents } from "../../lib/currency";
import type { PaymentPeriodStatus } from "./useChildPaymentProgress";

export type PeriodEffect = {
  /** The balance whose plan this is. */
  balanceId: string;
  /** The period the payment counted toward; its month names the panel. */
  periodStart: CalendarDate;
  status: PaymentPeriodStatus;
  minimumCents: Cents;
  paidCents: Cents;
  remainingCents: Cents;
};

/**
 * The start of the period after the one starting `periodStart`, mirroring
 * `payment_period_status`'s `next_period_start`: the smallest
 * `startsOn + k months` strictly after `periodStart`, always anchored to
 * `startsOn` (never compounded month to month, so a 31st-anchored plan stays
 * on the 31st where it can). Only used to decide *which* stored period a
 * backdated payment fell in -- every paid/remaining number still comes from
 * the server.
 */
export function nextPeriodStart(startsOn: CalendarDate, periodStart: CalendarDate): CalendarDate {
  const [startYear, startMonth] = startsOn.split("-").map(Number) as [number, number];
  const [periodYear, periodMonth] = periodStart.split("-").map(Number) as [number, number];
  const months = (periodYear - startYear) * 12 + (periodMonth - startMonth);
  const candidate = addMonths(startsOn, months);
  return compareCalendarDates(candidate, periodStart) > 0
    ? candidate
    : addMonths(startsOn, months + 1);
}

type PlanRow = { id: string; starts_on: CalendarDate; tracked_balance_id: string };

async function effectForPlan(plan: PlanRow, occurredOn: CalendarDate): Promise<PeriodEffect | null> {
  try {
    const { data: periodRaw, error: periodError } = await supabase.rpc(
      "ensure_current_payment_period",
      { p_plan_id: plan.id },
    );
    const current = periodRaw as { id: string; period_start: CalendarDate } | null;
    if (periodError || !current) return null;

    let target: { id: string; period_start: CalendarDate } | null = null;
    if (compareCalendarDates(occurredOn, current.period_start) >= 0) {
      target = current;
    } else {
      // A backdated payment counts toward the period whose month
      // [period_start, next_period_start) holds its date, not the current
      // one. Only periods already stored can be shown; one never
      // materialized (or a date before the plan began) gets no panel rather
      // than a misleading one.
      const { data: earlier, error: earlierError } = await supabase
        .from("payment_periods")
        .select("id, period_start")
        .eq("payment_plan_id", plan.id)
        .lte("period_start", occurredOn)
        .order("period_start", { ascending: false })
        .limit(1)
        .maybeSingle<{ id: string; period_start: CalendarDate }>();
      if (
        !earlierError &&
        earlier &&
        compareCalendarDates(occurredOn, nextPeriodStart(plan.starts_on, earlier.period_start)) < 0
      ) {
        target = earlier;
      }
    }
    if (!target) return null;

    const { data: statusData, error: statusError } = await supabase.rpc("payment_period_status", {
      p_period_id: target.id,
    });
    const statusRow = (
      (statusData ?? []) as {
        status: PaymentPeriodStatus;
        minimum_cents: number;
        paid_cents: number;
        remaining_cents: number;
      }[]
    )[0];
    if (statusError || !statusRow) return null;

    return {
      balanceId: plan.tracked_balance_id,
      periodStart: target.period_start,
      status: statusRow.status,
      minimumCents: statusRow.minimum_cents,
      paidCents: statusRow.paid_cents,
      remainingCents: Math.max(0, statusRow.remaining_cents),
    };
  } catch {
    return null;
  }
}

/**
 * After a payment: the server's view of each affected plan's period, one per
 * active plan of the child whose balance is in `affectedBalanceIds` (or every
 * active plan when that is null). Best effort -- the payment already
 * succeeded, so any failure just means that plan gets no panel.
 */
export async function fetchPeriodEffects(
  memberId: string,
  occurredOn: CalendarDate,
  affectedBalanceIds: ReadonlySet<string> | null,
): Promise<PeriodEffect[]> {
  try {
    const { data } = await supabase
      .from("payment_plans")
      .select("id, starts_on, tracked_balance_id")
      .eq("member_id", memberId)
      .eq("active", true)
      .returns<PlanRow[]>();

    const plans = (data ?? []).filter(
      (plan) => affectedBalanceIds === null || affectedBalanceIds.has(plan.tracked_balance_id),
    );
    const effects = await Promise.all(plans.map((plan) => effectForPlan(plan, occurredOn)));
    return effects.filter((effect): effect is PeriodEffect => effect !== null);
  } catch {
    return [];
  }
}
