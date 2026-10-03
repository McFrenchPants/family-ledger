import { useCallback, useEffect, useState } from "react";

import { supabase } from "../../lib/supabase";
import type { PaymentPlanDbRow, PaymentPlanRow } from "./payment-plans";
import { toPaymentPlanRow } from "./payment-plans";

/**
 * Discriminated union so a failed fetch cannot be silently treated as "no
 * plan" -- mirrors `useHouseholdBalances`/`useActivity`'s shape. `plans: []`
 * in the `loaded` state is a normal, non-error outcome (the member has no
 * active plan right now), distinct from `error`.
 */
export type PaymentPlansState =
  | { status: "loading" }
  | { status: "error"; message: string; retry: () => void }
  | { status: "loaded"; plans: readonly PaymentPlanRow[]; refetch: () => void };

/**
 * Fetches a member's current *active* payment plans (S3.1). A member can have
 * at most one active plan per tracked balance (enforced server-side), so this
 * returns one row per balance that has a plan, ordered by start date.
 *
 * Mirrors `useHouseholdBalances`'s retry-token/cleanup-on-unmount pattern:
 * the `active` boolean guards against a stale response landing after this
 * hook's inputs changed or the component unmounted, `retryToken` drives both
 * the initial fetch and any manual `retry`/`refetch` call (the same
 * `Retry` used on an error is reused as `refetch` after a successful
 * create/deactivate RPC, per this project's "refetch, don't hand-roll
 * optimistic state" convention -- see `ActivityPage`'s `onVoided`).
 */
export function usePaymentPlans(memberId: string): PaymentPlansState {
  const [state, setState] = useState<PaymentPlansState>({ status: "loading" });
  const [retryToken, setRetryToken] = useState(0);

  const retry = useCallback(() => {
    setRetryToken((token) => token + 1);
  }, []);

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });

    async function fetchPlan() {
      try {
        const { data, error } = await supabase
          .from("payment_plans")
          .select("id, minimum_cents, due_day, starts_on, ends_on, active, tracked_balance_id")
          .eq("member_id", memberId)
          .eq("active", true)
          .order("starts_on", { ascending: true })
          .returns<PaymentPlanDbRow[]>();

        if (!active) {
          return;
        }

        if (error) {
          setState({ status: "error", message: error.message, retry });
          return;
        }

        setState({
          status: "loaded",
          plans: (data ?? []).map(toPaymentPlanRow),
          refetch: retry,
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

    void fetchPlan();

    return () => {
      active = false;
    };
    // `retry` is stable (useCallback, no deps) -- listed for exhaustive-deps.
  }, [memberId, retryToken, retry]);

  return state;
}
