import { useState } from "react";
import type { ReactNode } from "react";

import { AmountText } from "../../components/ui/AmountText";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { LinkButton } from "../../components/ui/LinkButton";
import { LoadError } from "../../components/ui/LoadError";
import { StatusChip } from "../../components/ui/StatusChip";
import { formatCents } from "../../lib/currency";
import { formatCalendarDate } from "../../lib/dates";
import type { BalanceInfo } from "./balance-breakdown";
import {
  childSuggestionList,
  recordFromSuggestionPath,
  suggestionOutcome,
  suggestionSplitText,
} from "./payment-suggestions";
import type { SuggestionView } from "./payment-suggestions";
import {
  dismissPaymentSuggestion,
  useOwnPaymentSuggestions,
  usePendingPaymentSuggestions,
  withdrawPaymentSuggestion,
} from "./usePaymentSuggestions";

/** Date, split and note lines shared by both cards. */
function SuggestionDetails({
  suggestion,
  balances,
}: {
  suggestion: SuggestionView;
  balances: readonly BalanceInfo[] | null;
}) {
  const split = suggestionSplitText(suggestion, balances);
  return (
    <>
      <p className="text-label text-muted">Paid {formatCalendarDate(suggestion.suggestedOn)}</p>
      {split && <p className="text-label text-muted">Split: {split}</p>}
      {suggestion.note && <p className="text-label text-muted">&ldquo;{suggestion.note}&rdquo;</p>}
    </>
  );
}

/** Small inline failure with the action left available to try again. */
function ActionError({ message }: { message: string | null }): ReactNode {
  if (!message) return null;
  return (
    <p role="alert" className="text-label font-semibold text-danger">
      {message} Please try again.
    </p>
  );
}

/* ------------------------------------------------------------------ */
/* Child: their own suggestions                                         */
/* ------------------------------------------------------------------ */

/**
 * A Child's own suggestions with what happened to each, and Withdraw on the
 * waiting ones. Hidden until there is something to show. Nothing is editable.
 */
export function ChildSuggestionsCard({
  memberId,
  balances,
}: {
  memberId: string;
  balances: readonly BalanceInfo[] | null;
}) {
  const state = useOwnPaymentSuggestions(memberId);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ id: string; message: string } | null>(null);

  if (state.status === "loading") return null;
  if (state.status === "error") {
    return (
      <LoadError
        message={`Could not load your payment notes: ${state.message}`}
        onRetry={state.retry}
      />
    );
  }
  const list = childSuggestionList(state.suggestions);
  if (list.length === 0) return null;

  async function withdraw(id: string) {
    if (state.status !== "loaded") return;
    setBusyId(id);
    setFailure(null);
    const message = await withdrawPaymentSuggestion(id);
    setBusyId(null);
    if (message) setFailure({ id, message });
    else state.refetch();
  }

  return (
    <Card as="section" aria-labelledby="my-suggestions-heading">
      <h2 id="my-suggestions-heading" className="text-head">
        Payments you told a parent about
      </h2>
      <ul className="mt-1">
        {list.map((suggestion) => (
          <li
            key={suggestion.id}
            data-suggestion={suggestion.status}
            className="flex flex-col gap-1 border-t border-border py-3 first:border-t-0"
          >
            <div className="flex items-baseline justify-between gap-2">
              <AmountText cents={suggestion.amountCents} tone="ink" />
              <StatusChip
                kind={suggestion.status === "pending" ? "due" : suggestion.status === "converted" ? "clear" : "upcoming"}
                label={suggestion.status === "pending" ? "Waiting" : suggestion.status === "converted" ? "Recorded" : suggestion.status === "dismissed" ? "Dismissed" : "Withdrawn"}
              />
            </div>
            <p className="text-body font-semibold">{suggestionOutcome(suggestion)}</p>
            <SuggestionDetails suggestion={suggestion} balances={balances} />
            {suggestion.status === "pending" && (
              <div className="mt-1 flex flex-col items-start gap-1.5">
                <Button
                  size="sm"
                  loading={busyId === suggestion.id}
                  onClick={() => void withdraw(suggestion.id)}
                >
                  Withdraw
                  <span className="sr-only"> this note for {formatCents(suggestion.amountCents)}</span>
                </Button>
                <ActionError message={failure?.id === suggestion.id ? failure.message : null} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Parent: pending suggestions                                          */
/* ------------------------------------------------------------------ */

/**
 * A Parent's waiting suggestions. "Record this payment" opens Record payment
 * pre-filled (recording it closes the suggestion); "Dismiss" closes it with an
 * optional reason the child sees. Hidden when there are none.
 */
export function ParentSuggestionsCard({
  householdId,
  names,
  balances,
}: {
  householdId: string;
  /** member id -> display name. */
  names: ReadonlyMap<string, string>;
  balances: readonly BalanceInfo[] | null;
}) {
  const state = usePendingPaymentSuggestions(householdId);
  const [dismissing, setDismissing] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ id: string; message: string } | null>(null);

  if (state.status === "loading") return null;
  if (state.status === "error") {
    return (
      <LoadError
        message={`Could not load payment suggestions: ${state.message}`}
        onRetry={state.retry}
      />
    );
  }
  if (state.suggestions.length === 0) return null;

  async function dismiss(id: string) {
    if (state.status !== "loaded") return;
    setBusy(true);
    setFailure(null);
    const message = await dismissPaymentSuggestion(id, reason);
    setBusy(false);
    if (message) {
      setFailure({ id, message });
      return;
    }
    setDismissing(null);
    setReason("");
    state.refetch();
  }

  return (
    <section aria-labelledby="pending-suggestions-heading">
      <h2 id="pending-suggestions-heading" className="mb-2 text-head">
        Payments to confirm
      </h2>
      <ul className="flex flex-col gap-2.5">
        {state.suggestions.map((suggestion) => {
          const name = names.get(suggestion.memberId) ?? "A child";
          const isDismissing = dismissing === suggestion.id;
          return (
            <Card
              as="li"
              key={suggestion.id}
              data-suggestion="pending"
              className="flex flex-col gap-2 border-l-4 border-l-accent px-3.5 py-3"
            >
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-body font-semibold">{name} says they paid</p>
                <AmountText cents={suggestion.amountCents} tone="ink" />
              </div>
              <SuggestionDetails suggestion={suggestion} balances={balances} />

              {isDismissing ? (
                <div className="flex flex-col gap-2">
                  <label
                    htmlFor={`dismiss-reason-${suggestion.id}`}
                    className="text-label font-semibold text-muted"
                  >
                    Reason (optional, {name} will see it)
                  </label>
                  <input
                    id={`dismiss-reason-${suggestion.id}`}
                    type="text"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    className="min-h-touch-lg w-full rounded-control border border-border-strong bg-surface px-3.5 text-body text-ink"
                  />
                  <ActionError message={failure?.id === suggestion.id ? failure.message : null} />
                  <div className="flex gap-2">
                    <Button
                      variant="danger"
                      className="flex-1"
                      loading={busy}
                      onClick={() => void dismiss(suggestion.id)}
                    >
                      Dismiss this
                    </Button>
                    <Button
                      className="flex-1"
                      disabled={busy}
                      onClick={() => {
                        setDismissing(null);
                        setReason("");
                        setFailure(null);
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2">
                  <LinkButton to={recordFromSuggestionPath(suggestion)} icon="check" className="flex-1">
                    Record this payment<span className="sr-only"> from {name}</span>
                  </LinkButton>
                  <Button
                    className="flex-1"
                    onClick={() => {
                      setDismissing(suggestion.id);
                      setReason("");
                      setFailure(null);
                    }}
                  >
                    Dismiss<span className="sr-only"> {name}&rsquo;s note</span>
                  </Button>
                </div>
              )}
            </Card>
          );
        })}
      </ul>
    </section>
  );
}
