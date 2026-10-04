import { useCallback, useEffect, useState } from "react";

import { supabase } from "../../lib/supabase";
import { toSuggestionView } from "./payment-suggestions";
import type { PaymentSuggestionRow, SuggestionView } from "./payment-suggestions";

export type PaymentSuggestionsState =
  | { status: "loading" }
  | { status: "error"; message: string; retry: () => void }
  | { status: "loaded"; suggestions: readonly SuggestionView[]; refetch: () => void };

/**
 * Payment suggestions the signed-in user can see: a Child's own (any status),
 * or, with `pendingOnly`, a Parent's household-wide waiting list. Visibility
 * is RLS (Parent: whole household; Child: own rows) -- the `.eq` filters only
 * shape the query.
 */
function usePaymentSuggestionList(
  scope: { kind: "member"; memberId: string } | { kind: "household-pending"; householdId: string },
): PaymentSuggestionsState {
  const [state, setState] = useState<PaymentSuggestionsState>({ status: "loading" });
  const [token, setToken] = useState(0);
  const retry = useCallback(() => setToken((value) => value + 1), []);
  const scopeKey = scope.kind === "member" ? `m:${scope.memberId}` : `h:${scope.householdId}`;

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });

    async function load() {
      try {
        const base = supabase
          .from("payment_suggestions")
          .select("*, payment_suggestion_parts(*)");
        const filtered =
          scope.kind === "member"
            ? base.eq("member_id", scope.memberId)
            : base.eq("household_id", scope.householdId).eq("status", "pending");
        const { data, error } = await filtered
          .order("created_at", { ascending: false })
          .returns<PaymentSuggestionRow[]>();
        if (!active) return;
        if (error) {
          setState({ status: "error", message: error.message, retry });
          return;
        }
        setState({
          status: "loaded",
          suggestions: (data ?? []).map(toSuggestionView),
          refetch: retry,
        });
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

    void load();
    return () => {
      active = false;
    };
    // `scope` is captured through `scopeKey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey, token, retry]);

  return state;
}

/** A Child's own suggestions, newest first. */
export function useOwnPaymentSuggestions(memberId: string): PaymentSuggestionsState {
  return usePaymentSuggestionList({ kind: "member", memberId });
}

/** A Parent's household-wide pending suggestions, newest first. */
export function usePendingPaymentSuggestions(householdId: string): PaymentSuggestionsState {
  return usePaymentSuggestionList({ kind: "household-pending", householdId });
}

/** Result of a write: null on success, otherwise a message to show with a retry. */
export type SuggestionActionResult = string | null;

/** Child: take back one of their own pending suggestions. */
export async function withdrawPaymentSuggestion(id: string): Promise<SuggestionActionResult> {
  try {
    const { error } = await supabase.rpc("withdraw_payment_suggestion", { p_id: id });
    return error ? error.message : null;
  } catch (caught) {
    return caught instanceof Error
      ? `Could not reach the ledger service: ${caught.message}`
      : "Could not reach the ledger service.";
  }
}

/** Parent: dismiss a pending suggestion, with an optional reason the child will see. */
export async function dismissPaymentSuggestion(
  id: string,
  reason: string,
): Promise<SuggestionActionResult> {
  const trimmed = reason.trim();
  try {
    const { error } = await supabase.rpc("dismiss_payment_suggestion", {
      p_id: id,
      p_reason: trimmed === "" ? null : trimmed,
    });
    return error ? error.message : null;
  } catch (caught) {
    return caught instanceof Error
      ? `Could not reach the ledger service: ${caught.message}`
      : "Could not reach the ledger service.";
  }
}
