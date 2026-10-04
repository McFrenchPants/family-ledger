import { useCallback, useEffect, useState } from "react";

import { supabase } from "../../lib/supabase";
import type { Cents } from "../../lib/currency";
import type { CalendarDate } from "../../lib/dates";
import { fetchPlanProgress, type ActivePlanRef } from "./plan-progress";

/** The six statuses `payment_period_status` can return, verbatim. */
export type PaymentPeriodStatus =
  | "upcoming"
  | "due"
  | "partially_paid"
  | "satisfied"
  | "overdue"
  | "waived";

export type ChildPaymentProgress = {
  /** The tracked balance this plan is on (a child can have one plan per balance). */
  readonly balanceId: string;
  readonly periodStatus: PaymentPeriodStatus;
  readonly minimumCents: Cents;
  readonly paidCents: Cents;
  /** Clamped to >= 0 for display -- see module comment. */
  readonly remainingCents: Cents;
  readonly dueDate: CalendarDate;
};

/**
 * Discriminated union mirroring `useOwnBalance`/`usePaymentPlans`'s shape.
 *
 * `{status: "loaded", plans: []}` (no active plan) is a normal, non-error
 * outcome: most children simply don't have an active payment plan, and a
 * fetch that legitimately finds zero rows is not a failure. Only an actual
 * query/RPC error becomes `{status: "error"}`.
 */
export type ChildPaymentProgressState =
  | { status: "loading" }
  | { status: "error"; message: string; retry: () => void }
  | { status: "loaded"; plans: readonly ChildPaymentProgress[] };

/**
 * Fetches a Child's current payment-plan progress for one child: every active
 * plan (one per tracked balance at most), each with its current period
 * (created lazily via `ensure_current_payment_period` if it doesn't exist
 * yet) and that period's status/amounts.
 *
 * Mirrors `useOwnBalance`'s retry-token/cleanup-on-unmount pattern exactly.
 */
export function useChildPaymentProgress(memberId: string): ChildPaymentProgressState {
  const [state, setState] = useState<ChildPaymentProgressState>({ status: "loading" });
  const [retryToken, setRetryToken] = useState(0);

  const retry = useCallback(() => {
    setRetryToken((token) => token + 1);
  }, []);

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });

    async function fetchProgress() {
      try {
        const { data: planData, error: planError } = await supabase
          .from("payment_plans")
          .select("id, tracked_balance_id")
          .eq("member_id", memberId)
          .eq("active", true)
          .returns<ActivePlanRef[]>();

        if (!active) {
          return;
        }

        if (planError) {
          setState({ status: "error", message: planError.message, retry });
          return;
        }

        const plans = await Promise.all((planData ?? []).map(fetchPlanProgress));

        if (!active) {
          return;
        }

        setState({ status: "loaded", plans });
      } catch (caught) {
        if (!active) {
          return;
        }

        setState({
          status: "error",
          message:
            caught instanceof Error
              ? `Could not reach the ledger service: ${caught.message}`
              : "Could not reach the ledger service.",
          retry,
        });
      }
    }

    void fetchProgress();

    return () => {
      active = false;
    };
    // `retry` is stable (useCallback, no deps) -- listed for exhaustive-deps.
  }, [memberId, retryToken, retry]);

  return state;
}
