import { useCallback, useEffect, useState } from "react";

import { supabase } from "../../lib/supabase";
import type { Cents } from "../../lib/currency";
import type { MemberBalanceRow } from "./household-balances";

/**
 * Discriminated union mirroring `HouseholdBalancesState` / `MembershipState`'s
 * shape -- a failed fetch is never silently treated as a $0 balance.
 */
export type OwnBalanceState =
  | { status: "loading" }
  | { status: "error"; message: string; retry: () => void }
  | { status: "loaded"; balanceCents: Cents };

/**
 * Fetches the signed-in Child's own current balance, for their dashboard.
 *
 * Deliberately NOT built on `useHouseholdBalances`. That hook is Parent-shaped:
 * it issues two reads (a `household_members` listing plus the balances RPC)
 * and joins them client-side to build a per-child roster, because a Parent's
 * screen needs every child's *name* alongside their balance. A Child's own
 * dashboard already has its own name from `useMembership()` (via
 * `RequireRole`) and needs exactly one number -- so this hook is a single
 * call to the `household_member_balances(p_household_id)` RPC, with no
 * `household_members` read at all.
 *
 * That RPC (P1.4) already scopes its result set server-side to the caller's
 * own membership/role: a Child gets back at most one row (their own),
 * regardless of household size, and a household_id the caller does not
 * belong to yields zero rows. So no client-side filtering by member id is
 * needed for correctness -- this hook still picks out `memberId`'s row
 * explicitly (rather than blindly taking `data[0]`) so that a defensive
 * mismatch fails safe to "no balance found" (treated as 0) instead of
 * accidentally rendering whatever row happens to come back first.
 */
export function useOwnBalance(householdId: string, memberId: string): OwnBalanceState {
  const [state, setState] = useState<OwnBalanceState>({ status: "loading" });
  const [retryToken, setRetryToken] = useState(0);

  const retry = useCallback(() => {
    setRetryToken((token) => token + 1);
  }, []);

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });

    async function fetchBalance() {
      try {
        const { data, error } = await supabase.rpc("household_member_balances", {
          p_household_id: householdId,
        });

        if (!active) {
          return;
        }

        if (error) {
          setState({ status: "error", message: error.message, retry });
          return;
        }

        const rows = (data ?? []) as MemberBalanceRow[];
        const ownRow = rows.find((row) => row.member_id === memberId);
        setState({ status: "loaded", balanceCents: ownRow?.balance_cents ?? 0 });
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

    void fetchBalance();

    return () => {
      active = false;
    };
    // `retry` is stable (useCallback, no deps) -- listed for exhaustive-deps.
  }, [householdId, memberId, retryToken, retry]);

  return state;
}
