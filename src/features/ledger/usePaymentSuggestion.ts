import { useEffect, useState } from "react";

import type { Cents } from "../../lib/currency";
import type { CalendarDate } from "../../lib/dates";
import { supabase } from "../../lib/supabase";

export type PaymentSuggestion = {
  readonly id: string;
  readonly memberId: string;
  readonly amountCents: Cents;
  readonly suggestedOn: CalendarDate;
  readonly note: string | null;
  readonly status: string;
  readonly parts: readonly { balanceId: string; cents: Cents }[];
};

export type PaymentSuggestionState =
  | { status: "none" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; suggestion: PaymentSuggestion };

type SuggestionRow = {
  id: string;
  member_id: string;
  amount_cents: number;
  suggested_on: CalendarDate;
  note: string | null;
  status: string;
  payment_suggestion_parts: { tracked_balance_id: string; amount_cents: number }[] | null;
};

/** A child's payment suggestion, when the page was opened with `?suggestion=<id>`. */
export function usePaymentSuggestion(suggestionId: string | null): PaymentSuggestionState {
  const [state, setState] = useState<PaymentSuggestionState>(
    suggestionId ? { status: "loading" } : { status: "none" },
  );

  useEffect(() => {
    let active = true;
    if (!suggestionId) {
      setState({ status: "none" });
      return;
    }
    setState({ status: "loading" });

    async function load() {
      try {
        const { data, error } = await supabase
          .from("payment_suggestions")
          .select("*, payment_suggestion_parts(*)")
          .eq("id", suggestionId)
          .maybeSingle<SuggestionRow>();
        if (!active) return;
        if (error) {
          setState({ status: "error", message: error.message });
          return;
        }
        if (!data) {
          setState({ status: "error", message: "That suggestion could not be found." });
          return;
        }
        setState({
          status: "loaded",
          suggestion: {
            id: data.id,
            memberId: data.member_id,
            amountCents: data.amount_cents,
            suggestedOn: data.suggested_on,
            note: data.note,
            status: data.status,
            parts: (data.payment_suggestion_parts ?? []).map((part) => ({
              balanceId: part.tracked_balance_id,
              cents: part.amount_cents,
            })),
          },
        });
      } catch (caught) {
        if (!active) return;
        setState({
          status: "error",
          message: caught instanceof Error ? caught.message : "Could not load the suggestion.",
        });
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [suggestionId]);

  return state;
}
