import { useCallback, useEffect, useState } from "react";

import { supabase } from "../../lib/supabase";
import type { HistoryTransaction, HistoryTransactionRow } from "./history";
import { toHistoryTransactions } from "./history";

export type HistoryState =
  | { status: "loading" }
  | { status: "error"; message: string; retry: () => void }
  | { status: "loaded"; transactions: HistoryTransaction[]; refetch: () => void };

/**
 * Optional server-side refinements for `useHistory`. All fields are
 * optional; omitting the whole object (or leaving every field `undefined`)
 * preserves the hook's original unfiltered/unlimited/newest-first behavior
 * exactly -- these are additional `.eq()/.gte()/.lte()` predicates layered
 * onto the existing query, not a replacement for it, and they combine with
 * AND semantics the same way any chained PostgREST filter does.
 *
 * `type` matches `ledger_transactions.type` (`expense` / `payment` /
 * `adjustment`) verbatim. `categoryId` matches `ledger_transactions
 * .category_id`. `from`/`to` are inclusive `YYYY-MM-DD` bounds compared
 * against the `occurred_on` date column (not `created_at`), matching how the
 * rest of this hook already orders by `occurred_on`.
 */
export type HistoryFilters = {
  type?: string;
  categoryId?: string;
  from?: string;
  to?: string;
};

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
 * `filters` (F6.1) adds optional server-side refinements on top of that same
 * RLS-scoped result set -- see `HistoryFilters` above. They are query
 * shaping, not authorization, exactly like the existing `memberId` filter.
 *
 * See `history.ts` for the FK-disambiguation embed syntax needed for
 * `created_by`/`voided_by` (two separate FKs to `household_members`) and the
 * documented "creator/voider row may not be readable" caveat.
 */
export function useHistory(memberId: string, filters?: HistoryFilters): HistoryState {
  const [state, setState] = useState<HistoryState>({ status: "loading" });
  const [retryToken, setRetryToken] = useState(0);

  const retry = useCallback(() => {
    setRetryToken((token) => token + 1);
  }, []);

  // Serialized so a change in filter *values* re-triggers the effect without
  // depending on the caller passing a referentially-stable filters object
  // (most callers will construct a new object each render).
  const filtersKey = JSON.stringify(filters ?? {});

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });

    async function fetchHistory() {
      try {
        let query = supabase
          .from("ledger_transactions")
          .select(
            "id, description, amount_cents, type, occurred_on, created_at, voided_at, void_reason, " +
              "category:categories(name), " +
              "created_by_member:household_members!ledger_transactions_created_by_fkey(name), " +
              "voided_by_member:household_members!ledger_transactions_voided_by_fkey(name)",
          )
          .eq("member_id", memberId);

        if (filters?.type !== undefined) {
          query = query.eq("type", filters.type);
        }
        if (filters?.categoryId !== undefined) {
          query = query.eq("category_id", filters.categoryId);
        }
        if (filters?.from !== undefined) {
          query = query.gte("occurred_on", filters.from);
        }
        if (filters?.to !== undefined) {
          query = query.lte("occurred_on", filters.to);
        }

        const { data, error } = await query
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
    // `filters` is intentionally represented by `filtersKey` (see comment
    // above); `retry` is stable (useCallback, no deps).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberId, filtersKey, retryToken, retry]);

  return state;
}
