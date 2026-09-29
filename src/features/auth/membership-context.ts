import { createContext, useContext } from "react";

export type MembershipRole = "parent" | "child";
export type MembershipStatus = "active" | "invited" | "archived";

export type Membership = {
  memberId: string;
  householdId: string;
  role: MembershipRole;
  name: string;
  status: MembershipStatus;
};

export type MembershipState =
  // No Supabase auth session yet (or the session was just cleared by sign-out).
  // There is nothing to fetch.
  | { status: "signed-out" }
  // A session exists and the `household_members` row lookup is in flight.
  | { status: "loading" }
  // The lookup returned no row at all -- an auth user with no membership row
  // (e.g. a Supabase user created outside this app's invite flow). Distinct
  // from "error" because retrying the same query will not change the answer.
  | { status: "no-membership" }
  // The lookup failed (network error, RLS surprise, etc). Distinct from
  // "no-membership" so the UI can offer a retry instead of a dead end.
  | { status: "error"; message: string; retry: () => void }
  | { status: "loaded"; membership: Membership };

/**
 * Kept in its own module for the same reason as session-context.ts: the
 * provider file stays a pure component module so Vite fast refresh preserves
 * state across edits.
 */
export const MembershipContext = createContext<MembershipState | null>(null);

export function useMembership(): MembershipState {
  const value = useContext(MembershipContext);

  if (!value) {
    throw new Error("useMembership must be used inside <MembershipProvider>.");
  }

  return value;
}
