import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";

import { supabase } from "../../lib/supabase";
import type { Membership, MembershipRole, MembershipStatus, MembershipState } from "./membership-context";
import { MembershipContext } from "./membership-context";
import { useSession } from "./session-context";

/**
 * Row shape returned by `select("id, household_id, role, name, status")`
 * against `household_members`. `role`/`status` are `text` columns in
 * Postgres (constrained by CHECKs, not a Postgres enum), so they come back
 * as plain strings here too -- narrowed to the union types below.
 */
type HouseholdMemberRow = {
  id: string;
  household_id: string;
  role: string;
  name: string;
  status: string;
};

function isMembershipRole(value: string): value is MembershipRole {
  return value === "parent" || value === "child";
}

function isMembershipStatus(value: string): value is MembershipStatus {
  return value === "active" || value === "invited" || value === "archived";
}

/**
 * Resolves the signed-in caller's own `household_members` row (their
 * household id, role, name and status) via the RLS policy added in S2.1:
 * `user_id = auth.uid()` always returns the caller's own row, whatever its
 * status.
 *
 * Like SessionProvider, this is a UX convenience only. Every route/UI
 * decision made from `role` here is advisory -- the same read is re-derived
 * (and every write independently re-checked) under RLS/security-definer
 * functions in Postgres, which is the only place that decision is actually
 * enforced.
 */
export function MembershipProvider({ children }: { children: ReactNode }) {
  const { session, loading: sessionLoading } = useSession();
  const [state, setState] = useState<MembershipState>({ status: "loading" });
  // Bumped to force a refetch from the retry button without duplicating the
  // fetch logic in two places.
  const [retryToken, setRetryToken] = useState(0);

  const retry = useCallback(() => {
    setRetryToken((token) => token + 1);
  }, []);

  useEffect(() => {
    // Still resolving the initial getSession() call -- wait rather than
    // briefly reporting "signed-out".
    if (sessionLoading) {
      return;
    }

    if (!session) {
      setState({ status: "signed-out" });
      return;
    }

    let active = true;
    setState({ status: "loading" });

    // Captured as a plain string so TypeScript doesn't need to re-narrow
    // `session` (a closed-over state value) as non-null inside the nested
    // async function below.
    const userId = session.user.id;

    async function fetchMembership() {
      try {
        // Must filter to the caller's own user_id explicitly: the S2.1 RLS
        // policy set returns more than one row for a Parent with an
        // unfiltered select (their own row via household_members_select_self,
        // PLUS every other active member's row in their household via
        // household_members_select_parent_active_members) -- exactly the
        // multi-row listing that second policy exists to support, but not
        // what "who am I" needs here.
        const { data, error } = await supabase
          .from("household_members")
          .select("id, household_id, role, name, status")
          .eq("user_id", userId)
          .maybeSingle<HouseholdMemberRow>();

        if (!active) {
          return;
        }

        if (error) {
          setState({ status: "error", message: error.message, retry });
          return;
        }

        if (!data) {
          setState({ status: "no-membership" });
          return;
        }

        if (!isMembershipRole(data.role) || !isMembershipStatus(data.status)) {
          // Defensive: the DB CHECK constraints already guarantee this, but
          // a stale client/schema mismatch should fail loud, not silently
          // mis-render as a role it never actually is.
          setState({
            status: "error",
            message: `Unrecognized membership role/status: ${data.role}/${data.status}`,
            retry,
          });
          return;
        }

        const membership: Membership = {
          memberId: data.id,
          householdId: data.household_id,
          role: data.role,
          name: data.name,
          status: data.status,
        };

        setState({ status: "loaded", membership });
      } catch (caught) {
        if (!active) {
          return;
        }

        setState({
          status: "error",
          message:
            caught instanceof Error
              ? `Could not reach the membership service: ${caught.message}`
              : "Could not reach the membership service.",
          retry,
        });
      }
    }

    void fetchMembership();

    return () => {
      active = false;
    };
    // `session` (not just its presence) so signing into a *different* user
    // re-fetches instead of reusing the previous user's membership state.
    // `retry` is stable (useCallback, no deps) -- listed for exhaustive-deps.
  }, [session, sessionLoading, retryToken, retry]);

  return <MembershipContext.Provider value={state}>{children}</MembershipContext.Provider>;
}
