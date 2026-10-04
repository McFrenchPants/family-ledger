import { useCallback, useEffect, useState } from "react";

import { supabase } from "../../lib/supabase";
import type { BalanceInfo } from "./balance-breakdown";
import { fetchBreakdown, type MemberBreakdown } from "./useBalanceSplitData";

type BalanceRow = {
  id: string;
  name: string;
  sort_order: number | null;
  active: boolean;
  is_everyday: boolean;
};

export type AllTrackedBalancesState =
  | { status: "loading" }
  | { status: "error"; message: string; retry: () => void }
  | {
      status: "loaded";
      /** Every balance, archived included; Everyday first, then the household's order. */
      balances: readonly BalanceInfo[];
    };

/**
 * All of the household's tracked balances, archived ones too (a child can
 * still owe on, or have plans and past payments for, a balance that has since
 * been archived). Readable by every household member, so a Child can use it.
 */
export function useAllTrackedBalances(householdId: string): AllTrackedBalancesState {
  const [state, setState] = useState<AllTrackedBalancesState>({ status: "loading" });
  const [token, setToken] = useState(0);
  const retry = useCallback(() => setToken((value) => value + 1), []);

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });

    async function load() {
      try {
        const { data, error } = await supabase
          .from("tracked_balances")
          .select("id, name, sort_order, active, is_everyday")
          .eq("household_id", householdId)
          .order("sort_order", { ascending: true, nullsFirst: false })
          .order("name", { ascending: true })
          .returns<BalanceRow[]>();
        if (!active) return;
        if (error) {
          setState({ status: "error", message: error.message, retry });
          return;
        }
        const balances = (data ?? [])
          .map((row) => ({
            id: row.id,
            name: row.name,
            isEveryday: row.is_everyday,
            active: row.active,
          }))
          .sort((a, b) => Number(b.isEveryday) - Number(a.isEveryday));
        setState({ status: "loaded", balances });
      } catch (caught) {
        if (!active) return;
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

    void load();
    return () => {
      active = false;
    };
  }, [householdId, token, retry]);

  return state;
}

/**
 * Balances plus each child's amounts per balance, for the breakdown on Home
 * and Family. Best effort, like the Record payment previews: until both reads
 * succeed (or if either fails) the matching value is null and the screens
 * show the total alone, which is always right.
 */
export function useBalanceBreakdown(householdId: string): {
  balances: readonly BalanceInfo[] | null;
  breakdown: MemberBreakdown | null;
} {
  const all = useAllTrackedBalances(householdId);
  const [breakdown, setBreakdown] = useState<MemberBreakdown | null>(null);

  useEffect(() => {
    let active = true;
    void fetchBreakdown(householdId).then((result) => {
      if (active) setBreakdown(result);
    });
    return () => {
      active = false;
    };
  }, [householdId]);

  return {
    balances: all.status === "loaded" ? all.balances : null,
    breakdown,
  };
}
