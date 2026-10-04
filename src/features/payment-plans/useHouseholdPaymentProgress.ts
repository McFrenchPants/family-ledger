import { useCallback, useEffect, useState } from "react";

import { supabase } from "../../lib/supabase";
import type { ChildPaymentProgress } from "./useChildPaymentProgress";
import { fetchPlanProgress, type ActivePlanRef } from "./plan-progress";

/**
 * Discriminated union mirroring `useHouseholdBalances`'s shape (a household-
 * wide fetch, one loading/error state for the whole batch) and
 * `useChildPaymentProgress`'s per-child result type.
 *
 * `plansByMemberId` always has one entry per id in the `memberIds` this hook
 * was called with -- a child with no active plan maps to `[]`, never an
 * absent key -- so the page component never has to guess whether a missing
 * entry means "no plan" or "not fetched yet". A child can have one active
 * plan per tracked balance.
 */
export type HouseholdPaymentProgressState =
  | { status: "loading" }
  | { status: "error"; message: string; retry: () => void }
  | { status: "loaded"; plansByMemberId: ReadonlyMap<string, readonly ChildPaymentProgress[]> };

type PaymentPlanRow = ActivePlanRef & { member_id: string };

/**
 * Fetches every active Child's current payment-plan progress in one
 * household, for the Parent dashboard.
 *
 * One batched `payment_plans` query finds which children have an active
 * plan; then, only for children that do, `ensure_current_payment_period` ->
 * `payment_period_status` runs per child via `Promise.all` (no batched RPC
 * exists for that pair -- see the calling task's notes; a small household
 * does not warrant inventing one). Children with no active plan map to
 * `[]` immediately, with no RPC calls at all.
 *
 * Shares `useChildPaymentProgress`'s per-plan fetch (`fetchPlanProgress`) so a Parent and a
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
          setState({ status: "loaded", plansByMemberId: new Map() });
        }
        return;
      }

      try {
        const { data: planRows, error: planError } = await supabase
          .from("payment_plans")
          .select("id, member_id, tracked_balance_id")
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

        const rowsByMemberId = new Map<string, PaymentPlanRow[]>();
        for (const row of planRows ?? []) {
          rowsByMemberId.set(row.member_id, [...(rowsByMemberId.get(row.member_id) ?? []), row]);
        }

        const entries = await Promise.all(
          memberIds.map(async (memberId): Promise<[string, ChildPaymentProgress[]]> => [
            memberId,
            await Promise.all((rowsByMemberId.get(memberId) ?? []).map(fetchPlanProgress)),
          ]),
        );

        if (!active) {
          return;
        }

        setState({ status: "loaded", plansByMemberId: new Map(entries) });
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
