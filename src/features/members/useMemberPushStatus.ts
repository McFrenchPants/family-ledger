import { useCallback, useEffect, useState } from "react";

import { supabase } from "../../lib/supabase";

/**
 * Whether each member has turned reminders on (at least one push
 * subscription on some device). Keyed by member id.
 *
 * `household_member_push_status` only answers for *active* members the
 * caller may see (a Parent: every active member; anyone else: themselves),
 * so an archived member is simply absent from the map. Absent means
 * "unknown", never "off" -- callers show nothing for it.
 */
export type MemberPushStatusState =
  | { status: "loading" }
  | { status: "error"; message: string; retry: () => void }
  | { status: "loaded"; remindersOn: ReadonlyMap<string, boolean> };

type PushStatusRow = { household_member_id: string; has_subscription: boolean };

/**
 * Reads `household_member_push_status(p_household_id)`. Mirrors
 * `useHouseholdBalances`' retry-token/cleanup pattern. The function is
 * security-definer and re-derives who may see what from the caller's own
 * session; the household id here shapes the call, it does not authorize it.
 * It returns a yes/no per member, not a device count.
 */
export function useMemberPushStatus(householdId: string): MemberPushStatusState {
  const [state, setState] = useState<MemberPushStatusState>({ status: "loading" });
  const [retryToken, setRetryToken] = useState(0);

  const retry = useCallback(() => {
    setRetryToken((token) => token + 1);
  }, []);

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });

    async function fetchStatus() {
      try {
        const { data, error } = await supabase.rpc("household_member_push_status", {
          p_household_id: householdId,
        });

        if (!active) return;

        if (error) {
          setState({ status: "error", message: error.message, retry });
          return;
        }

        const remindersOn = new Map<string, boolean>();
        for (const row of (data ?? []) as PushStatusRow[]) {
          if (typeof row.has_subscription === "boolean") {
            remindersOn.set(row.household_member_id, row.has_subscription);
          }
        }
        setState({ status: "loaded", remindersOn });
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

    void fetchStatus();

    return () => {
      active = false;
    };
    // `retry` is stable (useCallback, no deps) -- listed for exhaustive-deps.
  }, [householdId, retryToken, retry]);

  return state;
}

/** A member's reminder state: true/false when known, null while unknown. */
export function remindersFor(state: MemberPushStatusState, memberId: string): boolean | null {
  if (state.status !== "loaded") return null;
  return state.remindersOn.get(memberId) ?? null;
}
