import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Icon } from "../../components/ui/Icon";
import { StickyActionBar } from "../../components/ui/StickyActionBar";
import { INPUT_CLASS } from "../../components/ui/styles";
import { formatCents } from "../../lib/currency";
import type { Cents } from "../../lib/currency";
import type { CalendarDate } from "../../lib/dates";
import { supabase } from "../../lib/supabase";
import { AmountEntry, DateChips, FieldError, SaveError, TextInput } from "./EntryFormParts";
import { owedWords, transferPreview, validateTransfer } from "./payment-split";
import type { SplitBalance, TransferErrors } from "./payment-split";
import { fetchBreakdown } from "./useBalanceSplitData";
import type { MemberBreakdown } from "./useBalanceSplitData";

type MoveState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "error"; message: string }
  | {
      status: "done";
      amountCents: Cents;
      fromName: string;
      toName: string;
      /** The server's numbers after the move; null if that read failed. */
      after: { from: Cents; to: Cents } | null;
    };

/**
 * Move money (Parent-only). A transfer from X to Y moves money a child has
 * already paid: X's balance goes UP and Y's goes DOWN, and the child's total
 * never changes. The preview is display-only arithmetic on the balances this
 * page already read; the confirmation shows what the server reports.
 */
export function MoveMoneyForm({
  householdId,
  children: kids,
  balances,
  breakdown,
  initialMemberId,
  today,
  onMoved,
}: {
  householdId: string;
  children: readonly { id: string; name: string }[];
  balances: readonly SplitBalance[];
  breakdown: MemberBreakdown | null;
  initialMemberId: string;
  today: CalendarDate;
  onMoved: () => void;
}) {
  const navigate = useNavigate();
  const everyday = balances.find((balance) => balance.isEveryday) ?? balances[0];
  const firstOther = balances.find((balance) => balance.id !== everyday?.id);

  const [memberId, setMemberId] = useState(initialMemberId || kids[0]?.id || "");
  const [fromId, setFromId] = useState(everyday?.id ?? "");
  const [toId, setToId] = useState(firstOther?.id ?? "");
  const [amountInput, setAmountInput] = useState("");
  const [occurredOn, setOccurredOn] = useState(today);
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<TransferErrors>({});
  const [state, setState] = useState<MoveState>({ status: "idle" });

  const nameOf = (id: string) => balances.find((balance) => balance.id === id)?.name ?? "that balance";
  const owed = breakdown ? (breakdown.get(memberId) ?? new Map<string, Cents>()) : null;
  const memberName = kids.find((kid) => kid.id === memberId)?.name ?? "the child";

  const checked = validateTransfer({ fromId, toId, amountInput });
  const preview =
    owed && checked.ok
      ? {
          fromBefore: owed.get(fromId) ?? 0,
          toBefore: owed.get(toId) ?? 0,
          ...transferPreview({
            fromBefore: owed.get(fromId) ?? 0,
            toBefore: owed.get(toId) ?? 0,
            amountCents: checked.amountCents,
          }),
        }
      : null;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (state.status === "submitting") return;

    const result = validateTransfer({ fromId, toId, amountInput });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    if (memberId === "") return;
    setErrors({});
    setState({ status: "submitting" });

    try {
      const { error } = await supabase.rpc("record_balance_transfer", {
        p_member_id: memberId,
        p_from_tracked_balance_id: fromId,
        p_to_tracked_balance_id: toId,
        p_amount_cents: result.amountCents,
        p_occurred_on: occurredOn,
        p_note: note.trim() === "" ? null : note.trim(),
      });
      if (error) {
        // Shown inline with a retry; never queued for later replay (ADR-007).
        setState({ status: "error", message: error.message });
        return;
      }

      const fresh = await fetchBreakdown(householdId);
      const row = fresh?.get(memberId);
      onMoved();
      setState({
        status: "done",
        amountCents: result.amountCents,
        fromName: nameOf(fromId),
        toName: nameOf(toId),
        after: row ? { from: row.get(fromId) ?? 0, to: row.get(toId) ?? 0 } : null,
      });
    } catch (caught) {
      setState({
        status: "error",
        message:
          caught instanceof Error
            ? `Could not reach the ledger service: ${caught.message}`
            : "Could not reach the ledger service.",
      });
    }
  }

  if (state.status === "done") {
    return (
      <section className="flex flex-col gap-4" aria-labelledby="move-done-heading">
        <Card className="flex flex-col gap-3 border-transparent bg-ok-soft shadow-none">
          <h2 id="move-done-heading" className="flex items-center gap-2 text-title text-ok">
            <Icon name="checkc" size={24} />
            Money moved
          </h2>
          <p className="text-body text-ink">
            Moved {formatCents(state.amountCents)} from {state.fromName} to {state.toName} for{" "}
            {memberName}.
          </p>
          {state.after && (
            <p className="text-body font-semibold text-ink tabular-nums">
              {state.fromName}: {owedWords(state.after.from)}. {state.toName}:{" "}
              {owedWords(state.after.to)}.
            </p>
          )}
        </Card>
        <Button
          variant="secondary"
          size="lg"
          fullWidth
          onClick={() => {
            setAmountInput("");
            setNote("");
            setState({ status: "idle" });
          }}
        >
          Move more
        </Button>
        <Button variant="ok" size="lg" fullWidth onClick={() => navigate("/home")}>
          Done
        </Button>
      </section>
    );
  }

  const submitting = state.status === "submitting";
  const fromName = nameOf(fromId);
  const toName = nameOf(toId);

  return (
    <form
      noValidate
      aria-label="Move money"
      className="flex flex-col gap-4"
      onSubmit={(event) => void handleSubmit(event)}
    >
      <p className="text-label text-muted">
        Use this to put money a child has already paid where it belongs. Moving money from{" "}
        {fromName} to {toName} means {fromName} owes more and {toName} owes less. The child&rsquo;s
        total does not change.
      </p>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="move-child" className="text-label font-semibold text-muted">
          Child
        </label>
        <select
          id="move-child"
          value={memberId}
          onChange={(event) => setMemberId(event.target.value)}
          className={INPUT_CLASS}
        >
          {kids.map((kid) => (
            <option key={kid.id} value={kid.id}>
              {kid.name}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="move-from" className="text-label font-semibold text-muted">
            Move from
          </label>
          <select
            id="move-from"
            value={fromId}
            onChange={(event) => setFromId(event.target.value)}
            className={INPUT_CLASS}
          >
            {balances.map((balance) => (
              <option key={balance.id} value={balance.id}>
                {balance.name}
              </option>
            ))}
          </select>
          <FieldError id="move-from-error">{errors.from}</FieldError>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="move-to" className="text-label font-semibold text-muted">
            Move to
          </label>
          <select
            id="move-to"
            value={toId}
            onChange={(event) => setToId(event.target.value)}
            className={INPUT_CLASS}
          >
            {balances.map((balance) => (
              <option key={balance.id} value={balance.id}>
                {balance.name}
              </option>
            ))}
          </select>
          <FieldError id="move-to-error">{errors.to}</FieldError>
        </div>
      </div>

      <AmountEntry
        id="move-amount"
        label="Amount to move"
        value={amountInput}
        onChange={setAmountInput}
        error={errors.amount}
      />

      <DateChips idPrefix="move" today={today} value={occurredOn} onChange={setOccurredOn} />

      <TextInput id="move-note" label="Note (optional)" value={note} onChange={setNote} />

      {preview && (
        <div
          data-testid="move-preview"
          className="rounded-panel bg-ok-soft p-4 text-label tabular-nums text-ink"
        >
          <h2 className="text-label font-semibold text-ok">What this will do</h2>
          <p className="mt-1.5">
            {fromName} goes from {formatCents(preview.fromBefore)} to{" "}
            {formatCents(preview.fromAfter)}, {toName} goes from {formatCents(preview.toBefore)} to{" "}
            {formatCents(preview.toAfter)}.
          </p>
        </div>
      )}

      {state.status === "error" && (
        <SaveError message={`Could not move the money: ${state.message}`} disabled={submitting} />
      )}

      <StickyActionBar>
        <Button
          type="submit"
          variant="ok"
          size="lg"
          fullWidth
          loading={submitting}
          icon="check"
          className="whitespace-normal text-center"
        >
          {submitting ? "Moving…" : "Move money"}
        </Button>
      </StickyActionBar>
    </form>
  );
}
