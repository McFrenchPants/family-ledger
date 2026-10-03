import { useCallback, useEffect, useState } from "react";

import type { Cents } from "../../lib/currency";
import { supabase } from "../../lib/supabase";
import type { SplitBalance } from "./payment-split";

type BalanceRow = {
  id: string;
  name: string;
  sort_order: number | null;
  active: boolean;
  is_everyday: boolean;
};

export type TrackedBalancesState =
  | { status: "loading" }
  | { status: "error"; message: string; retry: () => void }
  | {
      status: "loaded";
      /** Active balances only, Everyday first, then the household's own order. */
      balances: readonly SplitBalance[];
    };

/**
 * The household's active tracked balances (Everyday first). Unlike the
 * best-effort previews, the Record payment screen needs this to know whether
 * to show the split editor, so a failure is surfaced with a retry rather than
 * quietly sending everything to Everyday.
 */
export function useTrackedBalances(householdId: string): TrackedBalancesState {
  const [state, setState] = useState<TrackedBalancesState>({ status: "loading" });
  const [retryToken, setRetryToken] = useState(0);
  const retry = useCallback(() => setRetryToken((token) => token + 1), []);

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });

    async function fetchBalances() {
      try {
        const { data, error } = await supabase
          .from("tracked_balances")
          .select("id, name, sort_order, active, is_everyday")
          .eq("household_id", householdId)
          .eq("active", true)
          .order("sort_order", { ascending: true, nullsFirst: false })
          .order("name", { ascending: true })
          .returns<BalanceRow[]>();
        if (!active) return;
        if (error) {
          setState({ status: "error", message: error.message, retry });
          return;
        }
        const balances = (data ?? [])
          .map((row) => ({ id: row.id, name: row.name, isEveryday: row.is_everyday }))
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

    void fetchBalances();
    return () => {
      active = false;
    };
  }, [householdId, retryToken, retry]);

  return state;
}

/** member id -> (balance id -> amount owed, negative = credit). */
export type MemberBreakdown = ReadonlyMap<string, ReadonlyMap<string, Cents>>;

type BreakdownRow = { member_id: string; tracked_balance_id: string; balance_cents: number };

/** One read of `household_member_balance_breakdown`; null on any failure. */
export async function fetchBreakdown(householdId: string): Promise<MemberBreakdown | null> {
  try {
    const { data, error } = await supabase.rpc("household_member_balance_breakdown", {
      p_household_id: householdId,
    });
    if (error) return null;
    const byMember = new Map<string, Map<string, Cents>>();
    for (const row of (data ?? []) as BreakdownRow[]) {
      if (!Number.isInteger(row.balance_cents)) continue;
      const inner = byMember.get(row.member_id) ?? new Map<string, Cents>();
      inner.set(row.tracked_balance_id, row.balance_cents);
      byMember.set(row.member_id, inner);
    }
    return byMember;
  } catch {
    return null;
  }
}

/**
 * What each child owes per balance, for display-only previews and for the
 * "this creates a credit" check. `null` while loading or after a failure: the
 * forms keep working, just without those previews (the server is the
 * authority either way).
 */
export function useMemberBreakdown(householdId: string): {
  breakdown: MemberBreakdown | null;
  refetch: () => void;
} {
  const [breakdown, setBreakdown] = useState<MemberBreakdown | null>(null);
  const [token, setToken] = useState(0);
  const refetch = useCallback(() => setToken((value) => value + 1), []);

  useEffect(() => {
    let active = true;
    void fetchBreakdown(householdId).then((result) => {
      if (active) setBreakdown(result);
    });
    return () => {
      active = false;
    };
  }, [householdId, token]);

  return { breakdown, refetch };
}
