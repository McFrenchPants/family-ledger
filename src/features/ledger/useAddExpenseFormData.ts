import { useCallback, useEffect, useState } from "react";

import { supabase } from "../../lib/supabase";
import type { ActiveMemberOption, CategoryOption, ChildExpenseScope } from "./add-expense";

/** Row shape from `households.select("timezone, child_expense_scope")`. */
type HouseholdSettingsRow = {
  timezone: string;
  child_expense_scope: string;
};

/** Row shape from `household_members.select("id, name, role, status")`. */
type HouseholdMemberRow = {
  id: string;
  name: string;
  role: string;
  status: string;
};

/** Row shape from `categories.select("id, name")`. */
type CategoryRow = {
  id: string;
  name: string;
};

function isChildExpenseScope(value: string): value is ChildExpenseScope {
  return value === "any_member" || value === "self_only";
}

export type AddExpenseFormData = {
  /**
   * The household's configured IANA zone, used to default the "occurred on"
   * date to today per this project's standing timezone rule. Read for real
   * from `households.timezone` via `households_select_member`
   * (20260905020000_household_settings_and_sibling_read_access.sql) -- every
   * active member of a household can read their own household's row, so this
   * is always populated for a signed-in member with a valid membership.
   */
  readonly timezone: string;
  /**
   * `households.child_expense_scope`, read for real via the same policy.
   * `buildExpenseMemberSelector` still treats an (in practice unreachable
   * now) unexpected value defensively via `isChildExpenseScope`, but this is
   * no longer a documented gap -- see `childExpenseScope` below.
   */
  readonly childExpenseScope: ChildExpenseScope;
  readonly activeMembers: readonly ActiveMemberOption[];
  readonly categories: readonly CategoryOption[];
};

export type AddExpenseFormDataState =
  | { status: "loading" }
  | { status: "error"; message: string; retry: () => void }
  | ({ status: "loaded" } & AddExpenseFormData);

/**
 * Fetches everything the Add Expense form needs: the household's timezone
 * and child-expense-scope policy, the active members it may be recorded
 * against, and the household's active categories.
 *
 * `households.timezone`/`child_expense_scope` are read via
 * `households_select_member` (any active member of a household may read
 * their own household's row -- see
 * `supabase/migrations/20260905020000_household_settings_and_sibling_read_access.sql`),
 * and a Child's `activeMembers` in an `'any_member'` household now genuinely
 * includes their active siblings, via that same migration's
 * `household_members_select_siblings_when_any_member` policy. Both were
 * previously unreadable (a Phase 0 default-deny gap): this hook no longer
 * carries a browser-timezone fallback or a forced `"self_only"` default for
 * that reason -- a signed-in member with a valid household membership always
 * gets the real values.
 *
 * `.maybeSingle()` is still used for the `households` query so a genuinely
 * missing row (e.g. the household was deleted, or `householdId` is stale) is
 * `{ data: null, error: null }` rather than a thrown error, but that is now
 * treated as a real error state below -- distinct from a network/RLS error,
 * but still something the caller cannot proceed without.
 */
export function useAddExpenseFormData(householdId: string): AddExpenseFormDataState {
  const [state, setState] = useState<AddExpenseFormDataState>({ status: "loading" });
  const [retryToken, setRetryToken] = useState(0);

  const retry = useCallback(() => {
    setRetryToken((token) => token + 1);
  }, []);

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });

    async function fetchFormData() {
      try {
        const [householdResult, membersResult, categoriesResult] = await Promise.all([
          supabase
            .from("households")
            .select("timezone, child_expense_scope")
            .eq("id", householdId)
            .maybeSingle<HouseholdSettingsRow>(),
          supabase
            .from("household_members")
            .select("id, name, role, status")
            .eq("household_id", householdId)
            .eq("status", "active")
            .returns<HouseholdMemberRow[]>(),
          supabase
            .from("categories")
            .select("id, name")
            .eq("household_id", householdId)
            .eq("active", true)
            .order("sort_order", { ascending: true })
            .returns<CategoryRow[]>(),
        ]);

        if (!active) {
          return;
        }

        if (membersResult.error) {
          setState({ status: "error", message: membersResult.error.message, retry });
          return;
        }
        if (categoriesResult.error) {
          setState({ status: "error", message: categoriesResult.error.message, retry });
          return;
        }
        // A genuine network/RLS *error* (as opposed to the "no row" case,
        // handled next) is always fatal.
        if (householdResult.error) {
          setState({ status: "error", message: householdResult.error.message, retry });
          return;
        }

        const householdRow = householdResult.data;
        // With households_select_member in place, a signed-in member with a
        // valid membership always gets their own household's row back. A
        // missing row here is a genuine error (stale/invalid householdId, or
        // the household was deleted out from under an open tab) -- not a
        // policy gap to silently fall back around, so this surfaces as an
        // explicit error state rather than a fabricated browser-timezone
        // default or a forced self_only scope.
        if (!householdRow) {
          setState({
            status: "error",
            message: "Could not load this household's settings.",
            retry,
          });
          return;
        }
        if (!isChildExpenseScope(householdRow.child_expense_scope)) {
          setState({
            status: "error",
            message: `Unrecognized child expense scope: ${householdRow.child_expense_scope}`,
            retry,
          });
          return;
        }

        setState({
          status: "loaded",
          timezone: householdRow.timezone,
          childExpenseScope: householdRow.child_expense_scope,
          activeMembers: (membersResult.data ?? []).map((row) => ({
            id: row.id,
            name: row.name,
            role: row.role,
          })),
          categories: (categoriesResult.data ?? []).map((row) => ({
            id: row.id,
            name: row.name,
          })),
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

    void fetchFormData();

    return () => {
      active = false;
    };
    // `retry` is stable (useCallback, no deps) -- listed for exhaustive-deps.
  }, [householdId, retryToken, retry]);

  return state;
}
