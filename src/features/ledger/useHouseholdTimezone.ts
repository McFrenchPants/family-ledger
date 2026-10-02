import { useCallback, useEffect, useState } from "react";

import { isValidTimeZone } from "../../lib/dates";
import { supabase } from "../../lib/supabase";

export type HouseholdTimezoneState =
  | { status: "loading" }
  | { status: "error"; message: string; retry: () => void }
  | { status: "loaded"; timezone: string };

/**
 * Read-only: the household's configured IANA zone (`households.timezone`),
 * which decides "today", "due soon" and "overdue" on screen per the
 * project's standing time-zone rule. Readable by any active member through
 * `households_select_member`, the same read `useAddExpenseFormData` uses.
 *
 * There is deliberately no browser-zone fallback: a missing row or an
 * unrecognised zone is an error state with a retry, never a silent guess.
 */
export function useHouseholdTimezone(householdId: string): HouseholdTimezoneState {
  const [state, setState] = useState<HouseholdTimezoneState>({ status: "loading" });
  const [retryToken, setRetryToken] = useState(0);

  const retry = useCallback(() => {
    setRetryToken((token) => token + 1);
  }, []);

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });

    async function fetchTimezone() {
      try {
        const { data, error } = await supabase
          .from("households")
          .select("timezone")
          .eq("id", householdId)
          .maybeSingle<{ timezone: string }>();

        if (!active) return;

        if (error) {
          setState({ status: "error", message: error.message, retry });
          return;
        }
        if (!data) {
          setState({ status: "error", message: "Could not load this household's settings.", retry });
          return;
        }
        if (!isValidTimeZone(data.timezone)) {
          setState({
            status: "error",
            message: `Unrecognized household time zone: ${data.timezone}`,
            retry,
          });
          return;
        }
        setState({ status: "loaded", timezone: data.timezone });
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

    void fetchTimezone();

    return () => {
      active = false;
    };
  }, [householdId, retryToken, retry]);

  return state;
}
