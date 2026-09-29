import { useCallback, useEffect, useState } from "react";

import { supabase } from "../../lib/supabase";
import type { ChildBalance, HouseholdMemberRow, MemberBalanceRow } from "./household-balances";
import { joinChildBalances } from "./household-balances";

/**
 * Discriminated union so a failed fetch cannot be silently treated as an
 * empty household -- mirrors the shape of `MembershipState` in
 * `features/auth/membership-context.ts`.
 */
export type HouseholdBalancesState =
  | { status: "loading" }
  | { status: "error"; message: string; retry: () => void }
  | { status: "loaded"; children: ChildBalance[] };

/**
 * Fetches every active Child's name and current balance in a household, for
 * the Parent dashboard.
 *
 * Two independent reads, joined client-side (see `joinChildBalances`):
 *  - `household_members` (S2.1's Parent-listing RLS policy: an active Parent
 *    may select every active member's row in their own household), and
 *  - the `household_member_balances(p_household_id)` RPC, which returns
 *    every active member's balance, coalesced to 0.
 *
 * Both reads are already scoped to `householdId` server-side by RLS /
 * the RPC's own household check; this hook does not re-derive authorization,
 * it only renders what those reads return.
 */
export function useHouseholdBalances(householdId: string): HouseholdBalancesState {
  const [state, setState] = useState<HouseholdBalancesState>({ status: "loading" });
  const [retryToken, setRetryToken] = useState(0);

  const retry = useCallback(() => {
    setRetryToken((token) => token + 1);
  }, []);

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });

    async function fetchBalances() {
      try {
        const [membersResult, balancesResult] = await Promise.all([
          supabase
            .from("household_members")
            .select("id, name, role, status")
            .eq("household_id", householdId)
            .eq("status", "active")
            .returns<HouseholdMemberRow[]>(),
          supabase.rpc("household_member_balances", { p_household_id: householdId }),
        ]);

        if (!active) {
          return;
        }

        if (membersResult.error) {
          setState({ status: "error", message: membersResult.error.message, retry });
          return;
        }

        if (balancesResult.error) {
          setState({ status: "error", message: balancesResult.error.message, retry });
          return;
        }

        const children = joinChildBalances(
          membersResult.data ?? [],
          (balancesResult.data ?? []) as MemberBalanceRow[],
        );
        setState({ status: "loaded", children });
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

    void fetchBalances();

    return () => {
      active = false;
    };
    // `retry` is stable (useCallback, no deps) -- listed for exhaustive-deps.
  }, [householdId, retryToken, retry]);

  return state;
}
