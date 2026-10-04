import { useCallback, useEffect, useState } from "react";

import { supabase } from "../../lib/supabase";

/** Row shape from `categories.select(...)`. */
type CategoryRow = {
  id: string;
  name: string;
  sort_order: number | null;
  active: boolean;
  tracked_balance_id: string | null;
};

/** Row shape from `tracked_balances.select(...)`. */
type BalanceRow = {
  id: string;
  name: string;
  sort_order: number | null;
  active: boolean;
  is_everyday: boolean;
};

export type ManagedCategory = {
  readonly id: string;
  readonly name: string;
  readonly sortOrder: number | null;
  readonly active: boolean;
  /** The tracked balance this category counts toward; null means Everyday. */
  readonly trackedBalanceId: string | null;
};

export type ManagedBalance = {
  readonly id: string;
  readonly name: string;
  readonly sortOrder: number | null;
  readonly active: boolean;
  readonly isEveryday: boolean;
};

export type ManageCategoriesState =
  | { status: "loading" }
  | { status: "error"; message: string; retry: () => void }
  | {
      status: "loaded";
      categories: readonly ManagedCategory[];
      /** Every tracked balance, Everyday first, then by sort order (nulls last) and name. */
      balances: readonly ManagedBalance[];
      refetch: () => void;
    };

/**
 * Fetches every `categories` row for a household -- active and inactive --
 * for C1's "Manage categories" page. Unlike `useHouseholdCategories` (which
 * is `.eq("active", true)` for use as filter/picker options elsewhere), a
 * Parent managing categories needs to see inactive ones too, so they can be
 * reactivated.
 *
 * Ordered by `sort_order` with nulls last, matching this table's other
 * `sort_order`-ordered reads -- Postgres's default `ASC` ordering already
 * puts `NULL` last, so no extra `nullsFirst: false` is needed beyond being
 * explicit about it here.
 *
 * Also reads the household's `tracked_balances` (active and archived, for
 * the Balances section and the "Counts toward" picker) and each category's
 * `tracked_balance_id`. Balance writes go through Parent-only RPCs, not this
 * hook.
 *
 * As with every other hook in this codebase, this is a plain
 * `supabase.from("categories")` read -- RLS already restricts which rows a
 * caller may ever see; this hook's `household_id` filter is query shaping,
 * not authorization. Mutations (add/rename/deactivate/reactivate) are
 * performed directly by the page against the same Parent-only RLS policies;
 * this hook only reads and refetches.
 *
 * No realtime subscription (this codebase's established pattern, see
 * `useHouseholdMembers`/`useHouseholdBackup`): callers refetch explicitly
 * after a mutation succeeds.
 */
export function useManageCategories(householdId: string): ManageCategoriesState {
  const [state, setState] = useState<ManageCategoriesState>({ status: "loading" });
  const [retryToken, setRetryToken] = useState(0);

  const retry = useCallback(() => {
    setRetryToken((token) => token + 1);
  }, []);

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });

    async function fetchCategories() {
      try {
        const [categoriesResult, balancesResult] = await Promise.all([
          supabase
            .from("categories")
            .select("id, name, sort_order, active, tracked_balance_id")
            .eq("household_id", householdId)
            .order("sort_order", { ascending: true, nullsFirst: false })
            .order("name", { ascending: true })
            .returns<CategoryRow[]>(),
          supabase
            .from("tracked_balances")
            .select("id, name, sort_order, active, is_everyday")
            .eq("household_id", householdId)
            .order("sort_order", { ascending: true, nullsFirst: false })
            .order("name", { ascending: true })
            .returns<BalanceRow[]>(),
        ]);

        if (!active) {
          return;
        }

        const error = categoriesResult.error ?? balancesResult.error;
        if (error) {
          setState({ status: "error", message: error.message, retry });
          return;
        }

        const data = categoriesResult.data;

        const categories: ManagedCategory[] = (data ?? []).map((row) => ({
          id: row.id,
          name: row.name,
          sortOrder: row.sort_order,
          active: row.active,
          trackedBalanceId: row.tracked_balance_id,
        }));

        const balances: ManagedBalance[] = (balancesResult.data ?? [])
          .map((row) => ({
            id: row.id,
            name: row.name,
            sortOrder: row.sort_order,
            active: row.active,
            isEveryday: row.is_everyday,
          }))
          // Stable sort: Everyday first, the query's order kept for the rest.
          .sort((a, b) => Number(b.isEveryday) - Number(a.isEveryday));

        setState({ status: "loaded", categories, balances, refetch: retry });
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

    void fetchCategories();

    return () => {
      active = false;
    };
    // `retry` is stable (useCallback, no deps) -- listed for exhaustive-deps.
  }, [householdId, retryToken, retry]);

  return state;
}
