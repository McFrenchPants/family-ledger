import { useCallback, useEffect, useState } from "react";

import { supabase } from "../../lib/supabase";

/** Row shape from `categories.select("id, name, sort_order")`. */
type CategoryRow = {
  id: string;
  name: string;
  sort_order: number;
};

export type HouseholdCategory = {
  readonly id: string;
  readonly name: string;
  readonly sortOrder: number;
};

export type HouseholdCategoriesState =
  | { status: "loading" }
  | { status: "error"; message: string; retry: () => void }
  | { status: "loaded"; categories: readonly HouseholdCategory[]; refetch: () => void };

/**
 * Fetches a household's active categories, ordered by `sort_order`, for use
 * as filter options (F6.1) elsewhere in the ledger UI.
 *
 * Takes `householdId` directly rather than resolving it internally, the same
 * way `useAddExpenseFormData(householdId)` does -- callers already have it
 * from `useMembership()` (see `AddExpensePage.tsx`), and keeping this hook
 * decoupled from the auth context keeps it usable anywhere a household id is
 * already in hand.
 *
 * The `.eq("active", true).order("sort_order", ...)` query mirrors
 * `useAddExpenseFormData`'s categories fetch exactly. As with every other
 * hook in this file, this is a plain `supabase.from("categories")` read --
 * RLS already restricts which rows a caller may ever see; this hook's
 * `household_id` filter is query shaping, not authorization.
 */
export function useHouseholdCategories(householdId: string): HouseholdCategoriesState {
  const [state, setState] = useState<HouseholdCategoriesState>({ status: "loading" });
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
          .select("id, name, sort_order")
          .eq("household_id", householdId)
          .eq("active", true)
          .order("sort_order", { ascending: true })
          .returns<CategoryRow[]>();

        if (!active) {
          return;
        }

        if (error) {
          setState({ status: "error", message: error.message, retry });
          return;
        }

        setState({
          status: "loaded",
          categories: (data ?? []).map((row) => ({
            id: row.id,
            name: row.name,
            sortOrder: row.sort_order,
          })),
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

    void fetchCategories();

    return () => {
      active = false;
    };
    // `retry` is stable (useCallback, no deps) -- listed for exhaustive-deps.
  }, [householdId, retryToken, retry]);

  return state;
}
