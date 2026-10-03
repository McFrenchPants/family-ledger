import { useRef } from "react";

import { useHouseholdMembers } from "../members/useHouseholdMembers";
import type { HouseholdMembersState, HouseholdMemberRow } from "../members/useHouseholdMembers";

export type FamilyMembers = {
  state: HouseholdMembersState;
  /**
   * The roster to show: the latest loaded list, kept on screen while a
   * refetch is in flight so an open panel (and its message) is not torn
   * down by a reload. `null` before the first load, and after a failure.
   */
  members: HouseholdMemberRow[] | null;
  /** True while a refetch replaces an already-shown list. */
  refreshing: boolean;
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
  } else if (state.status === "error") {
    last.current = null;
  }

  return {
    state,
    members: last.current,
    refreshing: state.status === "loading" && last.current !== null,
    refetch: refetchRef.current,
  };
}
