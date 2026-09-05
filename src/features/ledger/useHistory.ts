import { useCallback, useEffect, useState } from "react";

import { supabase } from "../../lib/supabase";
import type { HistoryTransaction, HistoryTransactionRow } from "./history";
import { toHistoryTransactions } from "./history";

export type HistoryState =
  | { status: "loading" }
  | { status: "error"; message: string; retry: () => void }
  | { status: "loaded"; transactions: HistoryTransaction[]; refetch: () => void };

/**
 * Fetches a member's *full* ledger history (S2.7), newest-first, for the
 * `/child/:memberId/history` view. Mirrors `useRecentActivity`'s
 * loading/error(+retry)/loaded shape and its `occurred_on` then `created_at`
 * ordering, but deliberately does not `.limit()` -- a history view exists to
 * show everything, and capping it would hide data the acceptance criteria
 * require to be visible (including voided rows, which stay in the result set
 * rather than being filtered out).
 *
 * As with `useRecentActivity`, a plain `supabase.from("ledger_transactions")`
 * read is sufficient: P1.2's `ledger_transactions_select_self` /
 * `_select_parent` RLS policies already restrict what rows come back for the
 * caller's actual role, so this hook filters by `memberId` for shaping the
 * query, not for authorization. If `memberId` does not resolve to a readable
 * row for the caller (wrong household, a Child requesting a sibling with no
 * access, a nonexistent id), Postgres returns zero rows rather than an error
 * -- that surfaces here as a normal `{ status: "loaded", transactions: [] }`,
 * which the page renders as an empty/not-found state, not a crash.
 *
 * See `history.ts` for the FK-disambiguation embed syntax needed for
 * `created_by`/`voided_by` (two separate FKs to `household_members`) and the
 * documented "creator/voider row may not be readable" caveat.
 */
export function useHistory(memberId: string): HistoryState {
  const [state, setState] = useState<HistoryState>({ status: "loading" });
  const [retryToken, setRetryToken] = useState(0);

  const retry = useCallback(() => {
    setRetryToken((token) => token + 1);
  }, []);

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });

    async function fetchHistory() {
      try {
        const { data, error } = await supabase
          .from("ledger_transactions")
          .select(
            "id, description, amount_cents, type, occurred_on, created_at, voided_at, void_reason, " +
              "category:categories(name), " +
              "created_by_member:household_members!ledger_transactions_created_by_fkey(name), " +
              "voided_by_member:household_members!ledger_transactions_voided_by_fkey(name)",
          )
          .eq("member_id", memberId)
          .order("occurred_on", { ascending: false })
          .order("created_at", { ascending: false })
          .returns<HistoryTransactionRow[]>();

        if (!active) {
          return;
        }

        if (error) {
          setState({ status: "error", message: error.message, retry });
          return;
        }

        setState({
          status: "loaded",
          transactions: toHistoryTransactions(data ?? []),
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

    void fetchHistory();

    return () => {
      active = false;
    };
    // `retry` is stable (useCallback, no deps) -- listed for exhaustive-deps.
  }, [memberId, retryToken, retry]);

  return state;
}
