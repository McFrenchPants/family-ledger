import { useCallback, useEffect, useState } from "react";

import { supabase } from "../../lib/supabase";

/** Row shape from `expense_presets.select(...)`, active-only. */
type PresetRow = {
  id: string;
  label: string;
  amount_cents: number;
  category_id: string | null;
  description: string | null;
  sort_order: number | null;
};

export type ExpensePreset = {
  readonly id: string;
  readonly label: string;
  readonly amountCents: number;
  readonly categoryId: string | null;
  readonly description: string | null;
  readonly sortOrder: number | null;
};

export type ExpensePresetsState =
  | { status: "loading" }
  | { status: "error"; message: string; retry: () => void }
  | { status: "loaded"; presets: readonly ExpensePreset[]; refetch: () => void };

/**
 * Fetches a household's *active* `expense_presets`, ordered by `sort_order`
 * (nulls last), for quick-add consumption on `AddExpensePage` (C4).
 *
 * Mirrors `useHouseholdCategories`'s shape exactly -- active-only,
 * `sort_order`-ordered, the same `{status: "loading"|"error"|"loaded"}`
 * union -- rather than `useManagePresets`, which is shaped for C3's Parent
 * management page (active *and* inactive rows, plus the embedded category
 * name for display there). A quick-add button only needs the raw
 * `category_id` to prefill the form's `<select>`, not the category's name.
 *
 * Plain `supabase.from("expense_presets")` read -- RLS (household-wide
 * SELECT, C2) already restricts which rows a caller may ever see; the
 * `household_id` filter here is query shaping, not authorization.
 */
export function useExpensePresets(householdId: string): ExpensePresetsState {
  const [state, setState] = useState<ExpensePresetsState>({ status: "loading" });
  const [retryToken, setRetryToken] = useState(0);

  const retry = useCallback(() => {
    setRetryToken((token) => token + 1);
  }, []);

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });

    async function fetchPresets() {
      try {
        const { data, error } = await supabase
          .from("expense_presets")
          .select("id, label, amount_cents, category_id, description, sort_order")
          .eq("household_id", householdId)
          .eq("active", true)
          .order("sort_order", { ascending: true, nullsFirst: false })
          .order("label", { ascending: true })
          .returns<PresetRow[]>();

        if (!active) {
          return;
        }

        if (error) {
          setState({ status: "error", message: error.message, retry });
          return;
        }

        setState({
          status: "loaded",
          presets: (data ?? []).map((row) => ({
            id: row.id,
            label: row.label,
            amountCents: row.amount_cents,
            categoryId: row.category_id,
            description: row.description,
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

    void fetchPresets();

    return () => {
      active = false;
    };
    // `retry` is stable (useCallback, no deps) -- listed for exhaustive-deps.
  }, [householdId, retryToken, retry]);

  return state;
}
