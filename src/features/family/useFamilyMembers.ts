import { useRef } from "react";

import { useHouseholdMembers } from "../members/useHouseholdMembers";
import type { HouseholdMembersState, HouseholdMemberRow } from "../members/useHouseholdMembers";

export type FamilyMembers = {
  state: HouseholdMembersState;
  /**
   * The roster to show: the latest loaded list, kept on screen while a
   * refetch is in flight, and also when that refetch fails, so an open panel
   * (and its success message) is not torn down by a reload. `null` before
   * the first load, and when the first load failed.
   */
  members: HouseholdMemberRow[] | null;
  /** True while a refetch replaces an already-shown list. */
  refreshing: boolean;
  /**
   * Set when a re-read failed while an earlier list is still on screen:
   * the caller shows it beside that (possibly out-of-date) list, with retry.
   */
  refreshError: { message: string; retry: () => void } | null;
  refetch: () => void;
};

/** `useHouseholdMembers` plus "keep showing the last list while reloading". */
export function useFamilyMembers(householdId: string): FamilyMembers {
  const state = useHouseholdMembers(householdId);
  const last = useRef<HouseholdMemberRow[] | null>(null);
  const refetchRef = useRef<() => void>(() => {});

  if (state.status === "loaded") {
    last.current = state.members;
    refetchRef.current = state.refetch;
  }

  return {
    state,
    members: last.current,
    refreshing: state.status === "loading" && last.current !== null,
    refreshError:
      state.status === "error" && last.current !== null
        ? { message: state.message, retry: state.retry }
        : null,
    refetch: refetchRef.current,
  };
}
