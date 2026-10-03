import { useEffect, useState } from "react";

import { supabase } from "../../lib/supabase";
import type { PlanTarget } from "../ledger/payment-split";
import type { CalendarDate } from "../../lib/dates";

type PlanRow = { id: string; tracked_balance_id: string };
type PeriodRow = { id: string; period_start: CalendarDate; due_date: CalendarDate };
type StatusRow = { minimum_cents: number; remaining_cents: number };

/**
 * Each active plan of one child, with its current period's remaining minimum:
 * the starting point for the suggested payment split. A child can have one
 * active plan per balance, so this reads them all (unlike the roster's
 * one-plan-per-child progress read).
 *
 * Best effort: a failure just means no minimums feed the suggestion (the
 * Parent can still split by hand), so there is no error state.
 */
export function useMemberPlanTargets(memberId: string): readonly PlanTarget[] | null {
  const [targets, setTargets] = useState<readonly PlanTarget[] | null>(null);

  useEffect(() => {
    let active = true;
    setTargets(null);
    if (memberId === "") return;

    async function load() {
      try {
        const { data: plans, error } = await supabase
          .from("payment_plans")
          .select("id, tracked_balance_id")
          .eq("member_id", memberId)
          .eq("active", true)
          .returns<PlanRow[]>();
        if (error) throw new Error(error.message);

        const found = await Promise.all(
          (plans ?? []).map(async (plan): Promise<PlanTarget | null> => {
            const { data: periodRaw, error: periodError } = await supabase.rpc(
              "ensure_current_payment_period",
              { p_plan_id: plan.id },
            );
            const period = periodRaw as PeriodRow | null;
            if (periodError || !period) return null;
            const { data: statusData, error: statusError } = await supabase.rpc(
              "payment_period_status",
              { p_period_id: period.id },
            );
            const status = ((statusData ?? []) as StatusRow[])[0];
            if (statusError || !status) return null;
            return {
              balanceId: plan.tracked_balance_id,
              periodStart: period.period_start,
              dueDate: period.due_date,
              minimumCents: status.minimum_cents,
              remainingCents: Math.max(0, status.remaining_cents),
            };
          }),
        );
        if (active) setTargets(found.filter((target): target is PlanTarget => target !== null));
      } catch {
        if (active) setTargets([]);
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [memberId]);

  return targets;
}
