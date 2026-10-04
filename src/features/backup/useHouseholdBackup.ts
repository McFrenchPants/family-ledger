import { useCallback, useEffect, useState } from "react";

import { supabase } from "../../lib/supabase";
import type {
  HouseholdBackupAuditLogRow,
  HouseholdBackupBalanceTransferRow,
  HouseholdBackupCategoryRow,
  HouseholdBackupHouseholdRow,
  HouseholdBackupMemberRow,
  HouseholdBackupPaymentAllocationRow,
  HouseholdBackupPaymentPeriodRow,
  HouseholdBackupPaymentPlanRow,
  HouseholdBackupPaymentSuggestionPartRow,
  HouseholdBackupPaymentSuggestionRow,
  HouseholdBackupSnapshot,
  HouseholdBackupTrackedBalanceRow,
  HouseholdBackupTransactionRow,
} from "./household-backup";
import { toHouseholdBackupSnapshot } from "./household-backup";

export type HouseholdBackupState =
  | { status: "loading" }
  | { status: "error"; message: string; retry: () => void }
  | {
      status: "loaded";
      snapshot: HouseholdBackupSnapshot;
      refetch: () => void;
    };

/**
 * Fetches every table S6.2's JSON snapshot export needs for one household,
 * in parallel, mirroring `useLedgerExport`'s `Promise.all` pattern.
 *
 * All twelve queries are `.eq("household_id", householdId)` (or, for
 * `households` itself, `.eq("id", householdId)`) against the RLS-scoped
 * `supabase` client from `lib/supabase.ts` -- no service-role client, no Edge
 * Function, no writes. That `.eq` shapes each query; it is not what makes it
 * safe. Safety comes from each table's existing Parent-scoped SELECT policy
 * (`households_select_member`, `household_members` read-access policies,
 * `ledger_transactions_select_parent`, the P2.2 payment_plans/payment_periods
 * policies, and equivalents for `categories`/`audit_log`), which already
 * restrict every one of these tables to rows the caller's own household
 * actually owns -- a Child reaching this hook would get back only what their
 * own read policies allow (in most cases nothing, since these are Parent-only
 * reads), never another household's data.
 *
 * Push subscriptions are intentionally not queried here -- see
 * `household-backup.ts`'s header comment.
 */
export function useHouseholdBackup(householdId: string): HouseholdBackupState {
  const [state, setState] = useState<HouseholdBackupState>({ status: "loading" });
  const [retryToken, setRetryToken] = useState(0);

  const retry = useCallback(() => {
    setRetryToken((token) => token + 1);
  }, []);

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });

    async function fetchBackup() {
      try {
        const [
          householdResult,
          membersResult,
          transactionsResult,
          paymentPlansResult,
          paymentPeriodsResult,
          categoriesResult,
          trackedBalancesResult,
          paymentAllocationsResult,
          balanceTransfersResult,
          paymentSuggestionsResult,
          paymentSuggestionPartsResult,
          auditLogResult,
        ] = await Promise.all([
          supabase
            .from("households")
            .select("id, name, timezone")
            .eq("id", householdId)
            .maybeSingle<HouseholdBackupHouseholdRow>(),
          supabase
            .from("household_members")
            .select("id, user_id, name, role, status, created_at, archived_at")
            .eq("household_id", householdId)
            .returns<HouseholdBackupMemberRow[]>(),
          supabase
            .from("ledger_transactions")
            .select(
              "id, member_id, amount_cents, type, category_id, description, note, " +
                "occurred_on, created_by, created_at, voided_at, voided_by, void_reason",
            )
            .eq("household_id", householdId)
            .returns<HouseholdBackupTransactionRow[]>(),
          supabase
            .from("payment_plans")
            .select(
              "id, member_id, minimum_cents, frequency, due_day, starts_on, ends_on, " +
                "active, created_by, created_at, updated_at, tracked_balance_id",
            )
            .eq("household_id", householdId)
            .returns<HouseholdBackupPaymentPlanRow[]>(),
          supabase
            .from("payment_periods")
            .select(
              "id, payment_plan_id, member_id, period_start, due_date, minimum_cents, " +
                "waived_at, waived_by, waive_reason, created_at",
            )
            .eq("household_id", householdId)
            .returns<HouseholdBackupPaymentPeriodRow[]>(),
          supabase
            .from("categories")
            .select("id, name, sort_order, active, tracked_balance_id")
            .eq("household_id", householdId)
            .returns<HouseholdBackupCategoryRow[]>(),
          supabase
            .from("tracked_balances")
            .select("id, name, sort_order, active, is_everyday, created_at")
            .eq("household_id", householdId)
            .returns<HouseholdBackupTrackedBalanceRow[]>(),
          supabase
            .from("payment_allocations")
            .select(
              "id, member_id, transaction_id, transaction_type, tracked_balance_id, " +
                "amount_cents, created_at",
            )
            .eq("household_id", householdId)
            .returns<HouseholdBackupPaymentAllocationRow[]>(),
          supabase
            .from("balance_transfers")
            .select(
              "id, member_id, from_tracked_balance_id, to_tracked_balance_id, amount_cents, " +
                "occurred_on, note, created_by, created_at, voided_at, voided_by, void_reason",
            )
            .eq("household_id", householdId)
            .returns<HouseholdBackupBalanceTransferRow[]>(),
          supabase
            .from("payment_suggestions")
            .select(
              "id, member_id, amount_cents, suggested_on, note, status, created_by, created_at, " +
                "resolved_at, resolved_by, resolution_note, converted_transaction_id, " +
                "converted_transaction_type",
            )
            .eq("household_id", householdId)
            .returns<HouseholdBackupPaymentSuggestionRow[]>(),
          supabase
            .from("payment_suggestion_parts")
            .select("id, member_id, suggestion_id, tracked_balance_id, amount_cents, created_at")
            .eq("household_id", householdId)
            .returns<HouseholdBackupPaymentSuggestionPartRow[]>(),
          supabase
            .from("audit_log")
            .select("id, actor_user_id, entity_type, entity_id, action, old_values, new_values, created_at")
            .eq("household_id", householdId)
            .returns<HouseholdBackupAuditLogRow[]>(),
        ]);

        if (!active) {
          return;
        }

        const results = [
          householdResult,
          membersResult,
          transactionsResult,
          paymentPlansResult,
          paymentPeriodsResult,
          categoriesResult,
          trackedBalancesResult,
          paymentAllocationsResult,
          balanceTransfersResult,
          paymentSuggestionsResult,
          paymentSuggestionPartsResult,
          auditLogResult,
        ];
        const firstError = results.find((result) => result.error)?.error;
        if (firstError) {
          setState({ status: "error", message: firstError.message, retry });
          return;
        }

        if (!householdResult.data) {
          // A signed-in Parent with a valid membership always has a readable
          // household row (see useLedgerExport's identical reasoning for a
          // missing households row) -- treat it as an error rather than
          // fabricate a snapshot with no household identity.
          setState({
            status: "error",
            message: "Could not load this household's settings.",
            retry,
          });
          return;
        }

        const snapshot = toHouseholdBackupSnapshot(
          {
            household: householdResult.data,
            members: membersResult.data ?? [],
            transactions: transactionsResult.data ?? [],
            paymentPlans: paymentPlansResult.data ?? [],
            paymentPeriods: paymentPeriodsResult.data ?? [],
            categories: categoriesResult.data ?? [],
            trackedBalances: trackedBalancesResult.data ?? [],
            paymentAllocations: paymentAllocationsResult.data ?? [],
            balanceTransfers: balanceTransfersResult.data ?? [],
            paymentSuggestions: paymentSuggestionsResult.data ?? [],
            paymentSuggestionParts: paymentSuggestionPartsResult.data ?? [],
            auditLog: auditLogResult.data ?? [],
          },
          new Date().toISOString(),
        );

        setState({ status: "loaded", snapshot, refetch: retry });
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

    void fetchBackup();

    return () => {
      active = false;
    };
    // `retry` is stable (useCallback, no deps) -- listed for exhaustive-deps.
  }, [householdId, retryToken, retry]);

  return state;
}
