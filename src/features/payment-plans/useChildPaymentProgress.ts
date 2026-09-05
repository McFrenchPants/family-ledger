import { useCallback, useEffect, useState } from "react";

import { supabase } from "../../lib/supabase";
import type { Cents } from "../../lib/currency";
import type { CalendarDate } from "../../lib/dates";

/** The six statuses `payment_period_status` can return, verbatim. */
export type PaymentPeriodStatus =
  | "upcoming"
  | "due"
  | "partially_paid"
  | "satisfied"
  | "overdue"
  | "waived";

export type ChildPaymentProgress = {
  readonly periodStatus: PaymentPeriodStatus;
  readonly minimumCents: Cents;
  readonly paidCents: Cents;
  /** Clamped to >= 0 for display -- see module comment. */
  readonly remainingCents: Cents;
  readonly dueDate: CalendarDate;
};

/**
 * Discriminated union mirroring `useOwnBalance`/`usePaymentPlan`'s shape.
 *
 * `{status: "loaded", progress: null}` (no active plan) is a normal,
 * non-error outcome, for the same reason `usePaymentPlan`'s `plan: null` is:
 * most children simply don't have an active payment plan, and a fetch that
 * legitimately finds zero rows is not a failure. Only an actual query/RPC
 * error becomes `{status: "error"}`.
 */
export type ChildPaymentProgressState =
  | { status: "loading" }
  | { status: "error"; message: string; retry: () => void }
  | { status: "loaded"; progress: ChildPaymentProgress | null };

type PaymentPlanIdRow = { id: string };

type PaymentPeriodRow = { id: string; due_date: string };

type PaymentPeriodStatusRow = {
  period_id: string;
  status: PaymentPeriodStatus;
  minimum_cents: number;
  paid_cents: number;
  remaining_cents: number;
};

/**
 * Fetches the signed-in Child's current payment-plan progress for the
 * dashboard: their active plan's current period (created lazily via
 * `ensure_current_payment_period` if it doesn't exist yet) plus that
 * period's status/amounts.
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
          .select("id")
          .eq("member_id", memberId)
          .eq("active", true)
          .maybeSingle<PaymentPlanIdRow>();

        if (!active) {
          return;
        }

        if (planError) {
          setState({ status: "error", message: planError.message, retry });
          return;
        }

        if (!planData) {
          setState({ status: "loaded", progress: null });
          return;
        }

        const { data: periodRaw, error: periodError } = await supabase.rpc(
          "ensure_current_payment_period",
          { p_plan_id: planData.id },
        );

        if (!active) {
          return;
        }

        // `ensure_current_payment_period` returns a single `payment_periods`
        // row (not a set), so PostgREST hands back the object directly,
        // matching this project's existing `as <Row[]>` cast convention for
        // untyped RPC results (see `RecordPaymentPage.tsx`).
        const periodData = periodRaw as PaymentPeriodRow | null;

        if (periodError || !periodData) {
          setState({
            status: "error",
            message: periodError?.message ?? "Could not load the current payment period.",
            retry,
          });
          return;
        }

        const { data: statusData, error: statusError } = await supabase.rpc(
          "payment_period_status",
          { p_period_id: periodData.id },
        );

        if (!active) {
          return;
        }

        if (statusError) {
          setState({ status: "error", message: statusError.message, retry });
          return;
        }

        const statusRow = ((statusData ?? []) as PaymentPeriodStatusRow[])[0];
        if (!statusRow) {
          setState({
            status: "error",
            message: "Could not load the current payment period's status.",
            retry,
          });
          return;
        }

        setState({
          status: "loaded",
          progress: {
            periodStatus: statusRow.status,
            minimumCents: statusRow.minimum_cents,
            paidCents: statusRow.paid_cents,
            remainingCents: Math.max(0, statusRow.remaining_cents),
            dueDate: periodData.due_date,
          },
        });
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
