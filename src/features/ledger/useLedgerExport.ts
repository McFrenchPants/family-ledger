import { useCallback, useEffect, useState } from "react";

import { supabase } from "../../lib/supabase";
import type { LedgerExportRow, LedgerExportTransaction } from "./ledger-export";
import { toLedgerExportTransactions } from "./ledger-export";

/** Row shape from `households.select("timezone")`. */
type HouseholdTimezoneRow = { timezone: string };

export type LedgerExportState =
  | { status: "loading" }
  | { status: "error"; message: string; retry: () => void }
  | {
      status: "loaded";
      transactions: LedgerExportTransaction[];
      /** The household's configured IANA zone, for naming the downloaded file. */
      timezone: string;
      refetch: () => void;
    };

/**
 * Fetches every transaction in a household (S6.1's CSV export), newest-first,
 * plus the household's configured time zone (used only to name the
 * downloaded file after "today" in the household's own zone, per this
 * project's standing timezone rule -- never the browser's implicit local
 * time).
 *
 * Two independent reads, run together like `useAddExpenseFormData`'s
 * `Promise.all`:
 *  - `ledger_transactions` filtered by `household_id`, which
 *    `ledger_transactions_select_parent` (P1.2) already restricts to rows the
 *    caller's household actually owns -- this hook's `.eq("household_id", ...)`
 *    shapes the query, it does not authorize it;
 *  - `households.timezone`, readable by any active member of their own
 *    household via `households_select_member`.
 *
 * This is the RLS-scoped `supabase` client from `lib/supabase.ts`, exactly
 * like every other dashboard read in this codebase -- no service-role client,
 * no Edge Function, and this hook performs no writes.
 */
export function useLedgerExport(householdId: string): LedgerExportState {
  const [state, setState] = useState<LedgerExportState>({ status: "loading" });
  const [retryToken, setRetryToken] = useState(0);

  const retry = useCallback(() => {
    setRetryToken((token) => token + 1);
  }, []);

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });

    async function fetchExport() {
      try {
        const [transactionsResult, householdResult] = await Promise.all([
          supabase
            .from("ledger_transactions")
            .select(
              "id, description, amount_cents, type, occurred_on, voided_at, " +
                "category:categories(name), " +
                "member:household_members!ledger_transactions_member_id_fkey(name)",
            )
            .eq("household_id", householdId)
            .order("occurred_on", { ascending: false })
            .order("created_at", { ascending: false })
            .returns<LedgerExportRow[]>(),
          supabase
            .from("households")
            .select("timezone")
            .eq("id", householdId)
            .maybeSingle<HouseholdTimezoneRow>(),
        ]);

        if (!active) {
          return;
        }

        if (transactionsResult.error) {
          setState({ status: "error", message: transactionsResult.error.message, retry });
          return;
        }

        if (householdResult.error) {
          setState({ status: "error", message: householdResult.error.message, retry });
          return;
        }

        setState({
          status: "loaded",
          transactions: toLedgerExportTransactions(transactionsResult.data ?? []),
          // A signed-in Parent with a valid membership always has a readable
          // household row (see useAddExpenseFormData's identical reasoning);
          // a missing row here would mean a stale/invalid householdId, which
          // is not something to silently paper over -- fall back to UTC
          // rather than throw, since this value only names a downloaded file.
          timezone: householdResult.data?.timezone ?? "UTC",
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

    void fetchExport();

    return () => {
      active = false;
    };
    // `retry` is stable (useCallback, no deps) -- listed for exhaustive-deps.
  }, [householdId, retryToken, retry]);

  return state;
}
