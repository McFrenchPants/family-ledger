import { useEffect, useState } from "react";

import type { Cents } from "../../lib/currency";
import { supabase } from "../../lib/supabase";
import type { MemberBalanceRow } from "./household-balances";

/**
 * Balances the caller may see, keyed by member id, for the entry forms'
 * display-only previews. `null` while loading or after a failure: the forms
 * must keep working without a preview, so this never surfaces an error.
 *
 * `household_member_balances` returns every member for a Parent but only the
 * caller's own row for a Child. Unlike `joinChildBalances`, a member missing
 * from the result is simply absent here -- never defaulted to 0 -- so a
 * Child who picks a sibling gets no preview rather than a wrong one.
 */
export function useMemberBalances(householdId: string): ReadonlyMap<string, Cents> | null {
  const [balances, setBalances] = useState<ReadonlyMap<string, Cents> | null>(null);

  useEffect(() => {
    let active = true;
    setBalances(null);

    async function fetchBalances() {
      try {
        const { data, error } = await supabase.rpc("household_member_balances", {
          p_household_id: householdId,
        });
        if (!active || error) return;
        const map = new Map<string, Cents>();
        for (const row of (data ?? []) as MemberBalanceRow[]) {
          if (Number.isInteger(row.balance_cents)) map.set(row.member_id, row.balance_cents);
        }
        setBalances(map);
      } catch {
        // Best effort: no preview, the form still works.
      }
    }

    void fetchBalances();
    return () => {
      active = false;
    };
  }, [householdId]);

  return balances;
}
