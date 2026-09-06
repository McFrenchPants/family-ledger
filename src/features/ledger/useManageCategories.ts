import { useCallback, useEffect, useState } from "react";

import { supabase } from "../../lib/supabase";

/** Row shape from `categories.select(...)`. */
type CategoryRow = {
  id: string;
  name: string;
  sort_order: number | null;
  active: boolean;
};

export type ManagedCategory = {
  readonly id: string;
  readonly name: string;
  readonly sortOrder: number | null;
  readonly active: boolean;
};

export type ManageCategoriesState =
  | { status: "loading" }
  | { status: "error"; message: string; retry: () => void }
  | { status: "loaded"; categories: readonly ManagedCategory[]; refetch: () => void };

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
        const { data, error } = await supabase
          .from("categories")
          .select("id, name, sort_order, active")
          .eq("household_id", householdId)
          .order("sort_order", { ascending: true, nullsFirst: false })
          .order("name", { ascending: true })
          .returns<CategoryRow[]>();

        if (!active) {
          return;
        }

        if (error) {
          setState({ status: "error", message: error.message, retry });
          return;
        }

        const categories: ManagedCategory[] = (data ?? []).map((row) => ({
          id: row.id,
          name: row.name,
          sortOrder: row.sort_order,
          active: row.active,
        }));

        setState({ status: "loaded", categories, refetch: retry });
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
