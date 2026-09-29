import { useCallback, useEffect, useState } from "react";

import { supabase } from "../../lib/supabase";
import type { RecentTransaction, RecentTransactionRow } from "./recent-activity";
import { toRecentTransactions } from "./recent-activity";

/** How many recent transactions to show on the Child dashboard. */
export const RECENT_ACTIVITY_LIMIT = 8;

export type RecentActivityState =
  | { status: "loading" }
  | { status: "error"; message: string; retry: () => void }
  | { status: "loaded"; transactions: RecentTransaction[] };

/**
 * Fetches the most recent `RECENT_ACTIVITY_LIMIT` ledger transactions charged
 * against `memberId`, newest first, for the Child dashboard's activity list.
 *
 * Ordered by `occurred_on` first (the date the expense/payment/adjustment is
 * *for*, which is what "recent activity" means to the person reading it),
 * with `created_at` as a tiebreaker for same-day rows so ordering is
 * deterministic rather than left to whatever order Postgres happens to
 * return same-`occurred_on` rows in.
 *
 * A plain `supabase.from("ledger_transactions").select(...)` is sufficient
 * here: P1.2's `ledger_transactions_select_self` RLS policy already restricts
 * a Child's SELECT to rows where `member_id` equals their own
 * `household_members.id`, so this hook does not (and must not) need a
 * `household_id`/role check of its own -- filtering by `memberId` is for
 * shaping the query, not for authorization, which Postgres already owns.
 */
export function useRecentActivity(memberId: string): RecentActivityState {
  const [state, setState] = useState<RecentActivityState>({ status: "loading" });
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
          .select("id, description, amount_cents, type, occurred_on, created_at, category:categories(name)")
          .eq("member_id", memberId)
          .order("occurred_on", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(RECENT_ACTIVITY_LIMIT)
          .returns<RecentTransactionRow[]>();

        if (!active) {
          return;
        }

        if (error) {
          setState({ status: "error", message: error.message, retry });
          return;
        }

        setState({ status: "loaded", transactions: toRecentTransactions(data ?? []) });
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

    void fetchActivity();

    return () => {
      active = false;
    };
    // `retry` is stable (useCallback, no deps) -- listed for exhaustive-deps.
  }, [memberId, retryToken, retry]);

  return state;
}
