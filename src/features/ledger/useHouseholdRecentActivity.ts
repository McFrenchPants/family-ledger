import { useCallback, useEffect, useState } from "react";

import { supabase } from "../../lib/supabase";
import type { HouseholdRecentTransaction, HouseholdRecentTransactionRow } from "./recent-activity";
import { toHouseholdRecentTransactions } from "./recent-activity";

/** How many recent transactions Parent Home shows; the rest live under Activity. */
export const HOUSEHOLD_RECENT_ACTIVITY_LIMIT = 4;

export type HouseholdRecentActivityState =
  | { status: "loading" }
  | { status: "error"; message: string; retry: () => void }
  | { status: "loaded"; transactions: HouseholdRecentTransaction[] };

/**
 * Read-only: the household's most recent ledger rows across every member,
 * newest first, for Parent Home. Same columns, ordering and mapping as
 * `useRecentActivity`, plus `member_id` so each row can name its child.
 *
 * Filtering by `household_id` shapes the query; authorization is Postgres's
 * (`ledger_transactions_select_parent` lets an active Parent read the whole
 * household; anyone else would only ever get their own rows back). Voided
 * rows are included and flagged, never hidden or counted as payments.
 */
export function useHouseholdRecentActivity(householdId: string): HouseholdRecentActivityState {
  const [state, setState] = useState<HouseholdRecentActivityState>({ status: "loading" });
  const [retryToken, setRetryToken] = useState(0);

  const retry = useCallback(() => {
    setRetryToken((token) => token + 1);
  }, []);

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });

    async function fetchActivity() {
      try {
        const { data, error } = await supabase
          .from("ledger_transactions")
          .select(
            "id, member_id, description, amount_cents, type, occurred_on, created_at, voided_at, category:categories(name)",
          )
          .eq("household_id", householdId)
          .order("occurred_on", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(HOUSEHOLD_RECENT_ACTIVITY_LIMIT)
          .returns<HouseholdRecentTransactionRow[]>();

        if (!active) return;

        if (error) {
          setState({ status: "error", message: error.message, retry });
          return;
        }

        setState({ status: "loaded", transactions: toHouseholdRecentTransactions(data ?? []) });
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

    void fetchActivity();

    return () => {
      active = false;
    };
  }, [householdId, retryToken, retry]);

  return state;
}
