import { useCallback, useEffect, useState } from "react";

import { supabase } from "../../lib/supabase";

/**
 * Row shape from `expense_presets.select(...)`, with the embedded
 * `category:categories(name)` relation used throughout this codebase for
 * showing a category's name alongside a row that only stores its id (see
 * `useHistory`/`useRecentActivity`/`useLedgerExport`). Supabase returns an
 * embedded to-one relation as an object (or `null` when `category_id` is
 * `null`), never an array, because `category_id` -> `categories.id` is a
 * many-to-one FK.
 */
type PresetRow = {
  id: string;
  label: string;
  amount_cents: number;
  category_id: string | null;
  category: { name: string } | null;
  description: string | null;
  sort_order: number | null;
  active: boolean;
};

export type ManagedPreset = {
  readonly id: string;
  readonly label: string;
  readonly amountCents: number;
  readonly categoryId: string | null;
  readonly categoryName: string | null;
  readonly description: string | null;
  readonly sortOrder: number | null;
  readonly active: boolean;
};

export type ManagePresetsState =
  | { status: "loading" }
  | { status: "error"; message: string; retry: () => void }
  | { status: "loaded"; presets: readonly ManagedPreset[]; refetch: () => void };

/**
 * Fetches every `expense_presets` row for a household -- active and
 * inactive -- for C3's "Manage presets" page. Mirrors `useManageCategories`
 * exactly: unlike `useHouseholdCategories` (active-only, for picker options),
 * a Parent managing presets needs to see inactive ones too so they can be
 * reactivated.
 *
 * Ordered by `sort_order` with nulls last, same as `useManageCategories`.
 *
 * Plain `supabase.from("expense_presets")` read -- RLS (household-wide
 * SELECT, C2) already restricts which rows a caller may ever see; the
 * `household_id` filter here is query shaping, not authorization. Mutations
 * are performed directly by the page against the same Parent-only RLS
 * policies; this hook only reads and refetches.
 *
 * No realtime subscription, matching this codebase's established pattern:
 * callers refetch explicitly after a mutation succeeds.
 */
export function useManagePresets(householdId: string): ManagePresetsState {
  const [state, setState] = useState<ManagePresetsState>({ status: "loading" });
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
          .select(
            "id, label, amount_cents, category_id, category:categories(name), description, sort_order, active",
          )
          .eq("household_id", householdId)
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

        const presets: ManagedPreset[] = (data ?? []).map((row) => ({
          id: row.id,
          label: row.label,
          amountCents: row.amount_cents,
          categoryId: row.category_id,
          categoryName: row.category?.name ?? null,
          description: row.description,
          sortOrder: row.sort_order,
          active: row.active,
        }));

        setState({ status: "loaded", presets, refetch: retry });
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
