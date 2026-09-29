import { useCallback, useEffect, useState } from "react";

import { supabase } from "../../lib/supabase";
import type { MembershipRole, MembershipStatus } from "../auth/membership-context";

export type HouseholdMemberRow = {
  id: string;
  name: string;
  role: MembershipRole;
  status: MembershipStatus;
  createdAt: string;
  archivedAt: string | null;
};

export type HouseholdMembersState =
  | { status: "loading" }
  | { status: "error"; message: string; retry: () => void }
  | { status: "loaded"; members: HouseholdMemberRow[]; refetch: () => void };

/** Row shape from `household_members.select(...)`. */
type SelectedRow = {
  id: string;
  name: string;
  role: MembershipRole;
  status: MembershipStatus;
  created_at: string;
  archived_at: string | null;
};

/**
 * Fetches every `household_members` row for a household -- any status, not
 * just `active` -- for M6.4's "Manage members" page.
 *
 * As of M6.1, a Parent's SELECT policy on `household_members` covers every
 * status of their own household's members (not just active ones, the way a
 * Child's own-row-only policy does), so this hook's `.eq("household_id",
 * ...)` shapes the query the same way every other dashboard read in this
 * codebase does -- it does not authorize it. A Child who somehow reached this
 * hook would still only see what their own read policy allows.
 *
 * Ordered role-then-name so Parents cluster before children and each group
 * reads alphabetically -- there is no natural "most relevant first" order for
 * a flat member roster the way there is for a transaction history.
 *
 * No realtime subscription (this codebase's established pattern, see
 * `useHouseholdBackup`/`useLedgerExport`): callers refetch explicitly after
 * an add/archive/restore/rename action succeeds.
 */
export function useHouseholdMembers(householdId: string): HouseholdMembersState {
  const [state, setState] = useState<HouseholdMembersState>({ status: "loading" });
  const [retryToken, setRetryToken] = useState(0);

  const retry = useCallback(() => {
    setRetryToken((token) => token + 1);
  }, []);

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });

    async function fetchMembers() {
      try {
        const { data, error } = await supabase
          .from("household_members")
          .select("id, name, role, status, created_at, archived_at")
          .eq("household_id", householdId)
          .order("role", { ascending: true })
          .order("name", { ascending: true })
          .returns<SelectedRow[]>();

        if (!active) {
          return;
        }

        if (error) {
          setState({ status: "error", message: error.message, retry });
          return;
        }

        const members: HouseholdMemberRow[] = (data ?? []).map((row) => ({
          id: row.id,
          name: row.name,
          role: row.role,
          status: row.status,
          createdAt: row.created_at,
          archivedAt: row.archived_at,
        }));

        setState({ status: "loaded", members, refetch: retry });
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

    void fetchMembers();

    return () => {
      active = false;
    };
    // `retry` is stable (useCallback, no deps) -- listed for exhaustive-deps.
  }, [householdId, retryToken, retry]);

  return state;
}
