import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { LoadError } from "../components/ui/LoadError";
import { StickyActionBar } from "../components/ui/StickyActionBar";
import { useMembership } from "../features/auth/membership-context";
import type { Membership } from "../features/auth/membership-context";
import {
  AmountEntry,
  DateChips,
  ErrorSummary,
  OptionalDetails,
  SaveError,
  TextInput,
} from "../features/ledger/EntryFormParts";
import { typedAmountCents } from "../features/ledger/entry-preview";
import { buildSuggestionRequest } from "../features/ledger/payment-suggestions";
import type { SuggestionFormErrors } from "../features/ledger/payment-suggestions";
import { rowsFromParts, validateSplit } from "../features/ledger/payment-split";
import type { SplitRow } from "../features/ledger/payment-split";
import { SplitEditor } from "../features/ledger/SplitEditor";
import { useTrackedBalances } from "../features/ledger/useBalanceSplitData";
import { useHouseholdTimezone } from "../features/ledger/useHouseholdTimezone";
import { formatCents } from "../lib/currency";
import { todayInZone } from "../lib/dates";
import { supabase } from "../lib/supabase";

/**
 * `/new/suggestion` (Child only; the route wraps it in `RequireRole`): "Tell a
 * parent about a payment". This writes a suggestion, never a payment -- the
 * balance does not change until a parent records the real payment. The
 * database re-checks everything (`create_payment_suggestion` is Child-only
 * and self-only).
 */
export function SuggestPaymentPage() {
  const membership = useMembership();
  if (membership.status !== "loaded") return null; // unreachable under RequireRole
  return <SuggestPaymentForm membership={membership.membership} />;
}

function SuggestPaymentForm({ membership }: { membership: Membership }) {
  const navigate = useNavigate();
  const zone = useHouseholdTimezone(membership.householdId);
  const balancesState = useTrackedBalances(membership.householdId);

  const [amountInput, setAmountInput] = useState("");
  const [occurredOn, setOccurredOn] = useState("");
  const [note, setNote] = useState("");
  // null = the child has not opened the split: the whole amount is Everyday.
  const [splitOpen, setSplitOpen] = useState(false);
  const [manualRows, setManualRows] = useState<SplitRow[] | null>(null);
  const [errors, setErrors] = useState<SuggestionFormErrors>({});
  const [submitState, setSubmitState] = useState<
    { status: "idle" } | { status: "submitting" } | { status: "error"; message: string }
  >({ status: "idle" });

  if (zone.status === "loading" || balancesState.status === "loading") {
    return (
      <p role="status" className="text-label text-subtle">
        Loading…
      </p>
    );
  }
  if (zone.status === "error") {
    return (
      <LoadError
        message={`Could not load your household settings: ${zone.message}`}
        onRetry={zone.retry}
      />
    );
  }
  if (balancesState.status === "error") {
    return (
      <LoadError
        message={`Could not load balances: ${balancesState.message}`}
        onRetry={balancesState.retry}
      />
    );
  }

  const balances = balancesState.balances;
  const everyday = balances.find((balance) => balance.isEveryday) ?? balances[0];
  // The split only means something when there is more than Everyday to split across.
  const canSplit = balances.length > 1 && everyday !== undefined;
  const today = todayInZone(zone.timezone);
  // Dates default to the household's today until the child picks another.
  const date = occurredOn === "" ? today : occurredOn;
  const amountCents = typedAmountCents(amountInput);

  const rows: SplitRow[] | null =
    splitOpen && canSplit
      ? (manualRows ??
        rowsFromParts(amountCents && amountCents > 0 ? [{ balanceId: everyday.id, cents: amountCents }] : []))
      : null;
  const validation = rows && amountCents ? validateSplit(amountCents, rows) : null;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitState.status === "submitting") return;

    const result = buildSuggestionRequest({
      memberId: membership.memberId,
      amountInput,
      occurredOn: date,
      note,
      splitRows: rows,
    });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setSubmitState({ status: "submitting" });

    try {
      const { error } = await supabase.rpc("create_payment_suggestion", result.rpcArgs);
      if (error) {
        // Never queued for later replay (ADR-007): the child retries by hand.
        setSubmitState({ status: "error", message: error.message });
        return;
      }
      navigate("/home");
    } catch (caught) {
      setSubmitState({
        status: "error",
        message:
          caught instanceof Error
            ? `Could not reach the ledger service: ${caught.message}`
            : "Could not reach the ledger service.",
      });
    }
  }

  const submitting = submitState.status === "submitting";
  const errorMessages = [errors.amount, errors.occurredOn, errors.split].filter(
    (message): message is string => Boolean(message),
  );

  return (
    <section
      aria-labelledby="suggest-heading"
      className="mx-auto flex w-full max-w-[560px] flex-col gap-4"
    >
      <div className="flex flex-col gap-1">
        <h1 id="suggest-heading" className="text-title">
          Tell a parent about a payment
        </h1>
        <p className="text-label text-muted">
          Use this when you have paid, or plan to pay, someone back. This does not change what you
          owe &mdash; a parent has to confirm it and record the payment first.
        </p>
      </div>

      <form noValidate className="flex flex-col gap-4" onSubmit={(event) => void handleSubmit(event)}>
        <ErrorSummary messages={errorMessages} />

        <AmountEntry
          id="suggest-amount"
          label="Amount"
          value={amountInput}
          onChange={setAmountInput}
          error={errors.amount}
        />

        <DateChips
          idPrefix="suggest"
          today={today}
          value={date}
          onChange={setOccurredOn}
          error={errors.occurredOn}
        />

        {canSplit &&
          (rows ? (
            <SplitEditor
              rows={rows}
              balances={balances}
              amountCents={amountCents ?? 0}
              validation={validation ?? { ok: false, message: "Enter the amount first." }}
              isManual={manualRows !== null}
              onRowsChange={setManualRows}
              onReset={() => setManualRows(null)}
              after={null}
              planLines={[]}
              creditNames={[]}
              creditAcknowledged={false}
              onCreditAcknowledgedChange={() => undefined}
              showPlanEffects={false}
            />
          ) : (
            <Card as="section" className="flex flex-col items-start gap-2">
              <p className="text-label text-muted">
                Unless you say otherwise, this goes toward Everyday
                {amountCents ? ` (${formatCents(amountCents)})` : ""}.
              </p>
              <Button size="sm" onClick={() => setSplitOpen(true)}>
                Split between balances
              </Button>
            </Card>
          ))}

        <OptionalDetails label="Add a note (optional)">
          <TextInput id="suggest-note" label="Note (optional)" value={note} onChange={setNote} />
        </OptionalDetails>

        {submitState.status === "error" && (
          <SaveError
            message={`Could not send this to a parent: ${submitState.message}`}
            disabled={submitting}
          />
        )}

        <StickyActionBar>
          <Button
            type="submit"
            variant="primary"
            size="lg"
            fullWidth
            loading={submitting}
            className="whitespace-normal text-center"
          >
            {submitting ? "Sending…" : "Tell a parent"}
          </Button>
          <p className="mt-1.5 text-center text-label text-subtle">
            Your balance stays the same until a parent records it.
          </p>
        </StickyActionBar>
      </form>
    </section>
  );
}
