import { useCallback, useEffect, useState } from "react";

import { supabase } from "../../lib/supabase";
import type { CalendarDate } from "../../lib/dates";
import type { ChildPaymentProgress, PaymentPeriodStatus } from "./useChildPaymentProgress";

/**
 * Discriminated union mirroring `useHouseholdBalances`'s shape (a household-
 * wide fetch, one loading/error state for the whole batch) and
 * `useChildPaymentProgress`'s per-child result type.
 *
 * `progressByMemberId` always has one entry per id in the `memberIds` this
 * hook was called with -- a child with no active plan maps to `null`, never
 * an absent key -- so the page component never has to guess whether a
 * missing entry means "no plan" or "not fetched yet".
 */
export type HouseholdPaymentProgressState =
  | { status: "loading" }
  | { status: "error"; message: string; retry: () => void }
  | { status: "loaded"; progressByMemberId: ReadonlyMap<string, ChildPaymentProgress | null> };

type PaymentPlanRow = { id: string; member_id: string };

type PaymentPeriodRow = { id: string; due_date: CalendarDate };

type PaymentPeriodStatusRow = {
  period_id: string;
  status: PaymentPeriodStatus;
  minimum_cents: number;
  paid_cents: number;
  remaining_cents: number;
};

/**
 * Fetches every active Child's current payment-plan progress in one
 * household, for the Parent dashboard.
 *
 * One batched `payment_plans` query finds which children have an active
 * plan; then, only for children that do, `ensure_current_payment_period` ->
 * `payment_period_status` runs per child via `Promise.all` (no batched RPC
 * exists for that pair -- see the calling task's notes; a small household
 * does not warrant inventing one). Children with no active plan map to
 * `null` immediately, with no RPC calls at all.
 *
 * Mirrors `useChildPaymentProgress`'s per-child fetch logic exactly (same
 * `Math.max(0, remaining_cents)` clamping, same row types) so a Parent and a
 * Child see identical status derivation, just aggregated across a roster.
 */
export function useHouseholdPaymentProgress(
  householdId: string,
  memberIds: readonly string[],
): HouseholdPaymentProgressState {
  const [state, setState] = useState<HouseholdPaymentProgressState>({ status: "loading" });
  const [retryToken, setRetryToken] = useState(0);

  const retry = useCallback(() => {
    setRetryToken((token) => token + 1);
  }, []);

  // Keyed on the joined id list (not the array reference) alongside
  // householdId/retryToken: `memberIds` is recomputed fresh from
  // `useHouseholdBalances`'s result on every render, so using the array
  // itself as a dep would refetch every render even when the roster hasn't
  // actually changed.
  const memberIdsKey = memberIds.join(",");

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });

    async function fetchProgress() {
      if (memberIds.length === 0) {
        if (active) {
          setState({ status: "loaded", progressByMemberId: new Map() });
        }
        return;
      }

      try {
        const { data: planRows, error: planError } = await supabase
          .from("payment_plans")
          .select("id, member_id")
          .in("member_id", memberIds)
          .eq("active", true)
          .returns<PaymentPlanRow[]>();

        if (!active) {
          return;
        }

        if (planError) {
          setState({ status: "error", message: planError.message, retry });
          return;
        }

        const planByMemberId = new Map<string, PaymentPlanRow>();
        for (const row of planRows ?? []) {
          planByMemberId.set(row.member_id, row);
        }

        const entries = await Promise.all(
          memberIds.map(async (memberId): Promise<[string, ChildPaymentProgress | null]> => {
            const plan = planByMemberId.get(memberId);
            if (!plan) {
              return [memberId, null];
            }

            const { data: periodRaw, error: periodError } = await supabase.rpc(
              "ensure_current_payment_period",
              { p_plan_id: plan.id },
            );

            if (periodError) {
              throw new Error(periodError.message);
            }

            // `ensure_current_payment_period` returns a single `payment_periods`
            // row (not a set), so PostgREST hands back the object directly --
            // matching `useChildPaymentProgress`'s existing cast convention.
            const period = periodRaw as PaymentPeriodRow | null;
            if (!period) {
              throw new Error("Could not load the current payment period.");
            }

            const { data: statusData, error: statusError } = await supabase.rpc(
              "payment_period_status",
              { p_period_id: period.id },
            );

            if (statusError) {
              throw new Error(statusError.message);
            }

            const statusRow = ((statusData ?? []) as PaymentPeriodStatusRow[])[0];
            if (!statusRow) {
              throw new Error("Could not load the current payment period's status.");
            }

            return [
              memberId,
              {
                periodStatus: statusRow.status,
                minimumCents: statusRow.minimum_cents,
                paidCents: statusRow.paid_cents,
                remainingCents: Math.max(0, statusRow.remaining_cents),
                dueDate: period.due_date,
              },
            ];
          }),
        );

        if (!active) {
          return;
        }

        setState({ status: "loaded", progressByMemberId: new Map(entries) });
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
    // `memberIds` is intentionally represented by `memberIdsKey` (see comment
    // above); `retry` is stable (useCallback, no deps).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [householdId, memberIdsKey, retryToken, retry]);

  return state;
}
