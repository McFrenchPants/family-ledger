import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";

import {
  buildRecordMemberOptions,
  paymentRecordedMessage,
  validateRecordForm,
} from "../features/ledger/record-transaction";
import type { RecordFormErrors, RecordTransactionType } from "../features/ledger/record-transaction";
import { AmountText } from "../components/ui/AmountText";
import { Avatar } from "../components/ui/Avatar";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { ChoiceChips } from "../components/ui/ChoiceChips";
import { Icon } from "../components/ui/Icon";
import { Segmented } from "../components/ui/Segmented";
import { StatusChip } from "../components/ui/StatusChip";
import type { StatusKind } from "../components/ui/status";
import { StickyActionBar } from "../components/ui/StickyActionBar";
import {
  AmountEntry,
  DateChips,
  ErrorSummary,
  FieldError,
  GroupLabel,
  OptionalDetails,
  SaveError,
  TextInput,
} from "../features/ledger/EntryFormParts";
import {
  paymentPreview,
  paymentShortcuts,
  recordButtonLabel,
  typedAmountCents,
} from "../features/ledger/entry-preview";
import { childCardView } from "../features/home/parent-home";
import type { KnownProgress } from "../features/home/parent-home";
import { useAddExpenseFormData } from "../features/ledger/useAddExpenseFormData";
import { useMemberBalances } from "../features/ledger/useMemberBalances";
import { useHouseholdPaymentProgress } from "../features/payment-plans/useHouseholdPaymentProgress";
import { useMembership } from "../features/auth/membership-context";
import type { Membership } from "../features/auth/membership-context";
import { supabase } from "../lib/supabase";
import { todayInZone } from "../lib/dates";
import { formatCents, toDecimalString } from "../lib/currency";
import type { Cents } from "../lib/currency";
import type { PaymentPeriodStatus } from "../features/payment-plans/useChildPaymentProgress";

/**
 * `/new/payment`. Parent-only, end to end -- there is no legitimate Child
 * use of this screen at all (`record_payment`/`record_adjustment` reject a
 * Child caller outright, including one recording "against themselves").
 *
 * Two client-side layers keep a Child away, neither of them the real control:
 * the route is wrapped in `RequireRole role="parent"` (a Child typing the
 * address is sent home), and this component still renders an explicit
 * "Parents only" message for a loaded-but-Child membership in case it is
 * ever mounted some other way. A Child who bypasses both and calls the RPC
 * directly gets the same server-side rejection either way.
 */
export function RecordPaymentPage() {
  const membership = useMembership();

  switch (membership.status) {
    case "loading":
      return (
        <p role="status" className="text-label text-subtle">
          Loading your account…
        </p>
      );

    case "signed-out":
      return <Navigate to="/sign-in" replace />;

    case "error":
      return (
        <div role="alert" className="flex flex-col items-start gap-2">
          <p className="text-label text-danger">Could not load your account: {membership.message}</p>
          <Button size="sm" onClick={membership.retry}>
            Retry
          </Button>
        </div>
      );

    case "no-membership":
      return (
        <p role="alert" className="text-label text-danger">
          Your account is not linked to a household yet. Ask a parent in your household to invite
          you.
        </p>
      );

    case "loaded":
      if (membership.membership.role !== "parent") {
        return (
          <p role="alert" className="text-label text-danger">
            Only a parent can record a payment or adjustment.
          </p>
        );
      }
      return <RecordForm membership={membership.membership} />;
  }
}

type PeriodEffect = {
  status: PaymentPeriodStatus;
  minimumCents: Cents;
  paidCents: Cents;
  remainingCents: Cents;
};

type SubmitState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "error"; message: string }
  | {
      status: "done";
      type: RecordTransactionType;
      amountCents: Cents;
      balanceCents: Cents | null;
      /**
       * Only ever populated for a `payment` (never an `adjustment` -- see
       * module comment on S3.4). `null` covers every "nothing to show" case
       * uniformly: no active plan for this child, the type was `adjustment`,
       * or the best-effort secondary fetch failed. The confirmation panel
       * treats all three identically -- just render the plain balance
       * confirmation, unchanged from Phase 1.
       */
      periodEffect: PeriodEffect | null;
      /** A light "nice one" line; payments only, null for an adjustment. */
      encouragement: string | null;
    };

const PERIOD_STATUS_LABELS: Record<PaymentPeriodStatus, string> = {
  upcoming: "Upcoming",
  due: "Due",
  partially_paid: "Partially Paid",
  satisfied: "Satisfied",
  overdue: "Overdue",
  waived: "Waived",
};

/** Period status -> the shared status vocabulary (icon + colour). */
const PERIOD_STATUS_KIND: Record<PaymentPeriodStatus, StatusKind> = {
  upcoming: "upcoming",
  due: "due",
  partially_paid: "partial",
  satisfied: "satisfied",
  overdue: "overdue",
  waived: "waived",
};

/** Mirrors `ChildDashboardPage.tsx`'s `remainingDueCopy` phrasing per status. */
function periodEffectCopy(effect: PeriodEffect): string {
  switch (effect.status) {
    case "satisfied":
      return "Fully paid for this period.";
    case "waived":
      return "Waived for this period -- nothing due.";
    case "upcoming":
      return `${formatCents(effect.remainingCents)} will be due.`;
    case "overdue":
      return `${formatCents(effect.remainingCents)} overdue.`;
    case "due":
    case "partially_paid":
    default:
      return `${formatCents(effect.remainingCents)} remaining due.`;
  }
}

const TYPE_COPY: Record<
  RecordTransactionType,
  { label: string; verb: string; title: string; who: string; descriptionPlaceholder: string }
> = {
  payment: {
    label: "Payment",
    verb: "payment",
    title: "Record payment",
    who: "Who paid?",
    descriptionPlaceholder: "e.g. Cash payment",
  },
  adjustment: {
    label: "Adjustment",
    verb: "adjustment",
    title: "Record adjustment",
    who: "Who is it for?",
    descriptionPlaceholder: "e.g. Correcting a duplicate entry",
  },
};

const FIELD_ORDER: ReadonlyArray<keyof RecordFormErrors> = [
  "memberId",
  "amount",
  "description",
  "occurredOn",
];

/** "$187.32 owed" / "Nothing owed" / "$5.00 in credit" for a child row. */
function OwedText({ balanceCents }: { balanceCents: Cents }) {
  if (balanceCents === 0) return <span className="text-label text-subtle">Nothing owed</span>;
  const credit = balanceCents < 0;
  return (
    <span className="flex items-baseline gap-1 text-label text-muted">
      <AmountText cents={Math.abs(balanceCents)} srContext={credit ? "in credit" : "owed"} />
      <span aria-hidden="true">{credit ? "in credit" : "owed"}</span>
    </span>
  );
}

/**
 * `record_payment`/`record_adjustment` share one signature and differ only in
 * `type`, so one form serves both behind a Payment / Adjustment control.
 *
 * Deliberately distinct from Add expense, so a balance-decreasing action
 * never looks like ordinary expense entry: the green ("balance goes down")
 * main button, the entry-type control, child rows showing each child's
 * status, and a green "What this will do" preview.
 *
 * The preview and the amount shortcuts are display-only arithmetic on the
 * balance and period progress this page already read. The server stays the
 * authority: after a successful write the confirmation panel shows the
 * balance fetched again from `household_member_balances`, plus the period
 * effect from `payment_period_status`, exactly as before.
 */
function RecordForm({ membership }: { membership: Membership }) {
  const formData = useAddExpenseFormData(membership.householdId);
  const balances = useMemberBalances(membership.householdId);
  const childIds =
    formData.status === "loaded"
      ? buildRecordMemberOptions(formData.activeMembers).map((option) => option.id)
      : [];
  const progressState = useHouseholdPaymentProgress(membership.householdId, childIds);
  const navigate = useNavigate();
  // `?child=<memberId>` (from Parent Home) picks the initial child, only if
  // it is in the roster this form already loaded; otherwise ignored.
  const [searchParams] = useSearchParams();
  const requestedChild = searchParams.get("child");

  const [type, setType] = useState<RecordTransactionType>("payment");
  const [memberId, setMemberId] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [description, setDescription] = useState("");
  const [note, setNote] = useState("");
  const [occurredOn, setOccurredOn] = useState("");
  const [fieldErrors, setFieldErrors] = useState<RecordFormErrors>({});
  const [submitState, setSubmitState] = useState<SubmitState>({ status: "idle" });

  // Seed the member selector's default and today's date once form data has
  // loaded, mirroring AddExpensePage's effect -- see its comment for why this
  // is effect-based (async dependency) and keyed only on formData.status
  // flipping to "loaded" rather than on formData's fields themselves.
  useEffect(() => {
    if (formData.status !== "loaded") {
      return;
    }

    if (memberId === "") {
      const options = buildRecordMemberOptions(formData.activeMembers);
      const requested = options.find((option) => option.id === requestedChild);
      if (requested) {
        setMemberId(requested.id);
      } else if (options[0]) {
        setMemberId(options[0].id);
      }
    }

    if (occurredOn === "") {
      setOccurredOn(todayInZone(formData.timezone));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.status]);

  if (formData.status === "loading") {
    return (
      <p role="status" className="text-label text-subtle">
        Loading…
      </p>
    );
  }

  if (formData.status === "error") {
    return (
      <div role="alert" className="flex flex-col items-start gap-2">
        <p className="text-label text-danger">Could not load this form: {formData.message}</p>
        <Button size="sm" onClick={formData.retry}>
          Retry
        </Button>
      </div>
    );
  }

  const options = buildRecordMemberOptions(formData.activeMembers);
  const copy = TYPE_COPY[type];

  if (submitState.status === "done") {
    const doneCopy = TYPE_COPY[submitState.type];
    return (
      <section
        aria-labelledby="record-done-heading"
        className="mx-auto flex w-full max-w-[560px] flex-col gap-4"
      >
        <Card className="flex flex-col gap-3 border-transparent bg-ok-soft shadow-none">
          <h1 id="record-done-heading" className="flex items-center gap-2 text-title text-ok">
            <Icon name="checkc" size={24} />
            {doneCopy.label} recorded
          </h1>
          <p className="text-body text-ink">
            Recorded a {formatCents(Math.abs(submitState.amountCents))} {doneCopy.verb}.
          </p>
          {submitState.encouragement && (
            <p
              role="status"
              aria-live="polite"
              data-testid="payment-encouragement"
              className="flex items-center gap-2 text-body font-semibold text-ok"
            >
              <Icon name="checkc" />
              {submitState.encouragement}
            </p>
          )}
          <p className="text-body font-semibold text-ink tabular-nums">
            New balance:{" "}
            {submitState.balanceCents === null
              ? "unavailable"
              : formatCents(submitState.balanceCents)}
          </p>
        </Card>
        {submitState.periodEffect && (
          <Card className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-head">Payment Period</h2>
              <StatusChip
                kind={PERIOD_STATUS_KIND[submitState.periodEffect.status]}
                label={PERIOD_STATUS_LABELS[submitState.periodEffect.status]}
              />
            </div>
            <p className="text-body text-ink">{periodEffectCopy(submitState.periodEffect)}</p>
            <p className="text-label text-subtle tabular-nums">
              {formatCents(submitState.periodEffect.paidCents)} of{" "}
              {formatCents(submitState.periodEffect.minimumCents)} paid
            </p>
          </Card>
        )}
        <Button variant="ok" size="lg" fullWidth onClick={() => navigate("/home")}>
          Done
        </Button>
      </section>
    );
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitState.status === "submitting") return;

    const result = validateRecordForm({ memberId, amountInput, description, occurredOn });
    if (!result.ok) {
      setFieldErrors(result.errors);
      return;
    }
    setFieldErrors({});
    setSubmitState({ status: "submitting" });

    const rpcName = type === "payment" ? "record_payment" : "record_adjustment";

    try {
      const { data: recorded, error } = await supabase.rpc(rpcName, {
        p_member_id: memberId,
        p_amount_cents: result.amountCents,
        p_description: description.trim(),
        p_occurred_on: occurredOn,
        p_category_id: categoryId === "" ? null : categoryId,
        p_note: note.trim() === "" ? null : note.trim(),
      });

      if (error) {
        // A rejected write (e.g. a stale session that lost Parent status, or
        // any other server-side check) surfaces here as a retry-able error
        // state. Never queued for later replay -- ADR-007.
        setSubmitState({ status: "error", message: error.message });
        return;
      }

      // Fetch the resulting balance for the confirmation panel. A failure
      // here does not roll back the write that already succeeded -- it just
      // means the confirmation cannot show a number, which is communicated
      // explicitly ("unavailable") rather than silently showing a stale one.
      const { data: balanceRows } = await supabase.rpc("household_member_balances", {
        p_household_id: membership.householdId,
      });
      const balanceRow = ((balanceRows ?? []) as { member_id: string; balance_cents: number }[]).find(
        (row) => row.member_id === memberId,
      );

      // Period effect (S3.4) is a payment-only concern -- an adjustment never
      // counts toward a period's paid amount (the allocation rule excludes
      // adjustments entirely), so showing period-shaped UI for one would be
      // misleading rather than helpful. `periodEffect` stays `null` for any
      // adjustment, with no RPC calls made at all.
      let periodEffect: PeriodEffect | null = null;

      if (type === "payment") {
        try {
          const { data: planData } = await supabase
            .from("payment_plans")
            .select("id")
            .eq("member_id", memberId)
            .eq("active", true)
            .maybeSingle<{ id: string }>();

          if (planData) {
            const { data: periodRaw, error: periodError } = await supabase.rpc(
              "ensure_current_payment_period",
              { p_plan_id: planData.id },
            );

            const periodData = periodRaw as { id: string } | null;

            if (!periodError && periodData) {
              const { data: statusData, error: statusError } = await supabase.rpc(
                "payment_period_status",
                { p_period_id: periodData.id },
              );

              const statusRow = (
                (statusData ?? []) as {
                  period_id: string;
                  status: PaymentPeriodStatus;
                  minimum_cents: number;
                  paid_cents: number;
                  remaining_cents: number;
                }[]
              )[0];

              if (!statusError && statusRow) {
                periodEffect = {
                  status: statusRow.status,
                  minimumCents: statusRow.minimum_cents,
                  paidCents: statusRow.paid_cents,
                  remainingCents: Math.max(0, statusRow.remaining_cents),
                };
              }
            }
          }
        } catch {
          // Best-effort secondary read: the payment RPC above already
          // succeeded and the write is final, so a failure here must not
          // surface as a second error state (that would read as the payment
          // itself having failed). Fall back to no period-effect display --
          // the existing plain balance confirmation still stands on its own.
          periodEffect = null;
        }
      }

      // The RPC returns the new ledger row; its id seeds the line so it stays
      // put for this payment. Without one, the amount and child still give a
      // stable seed for this panel.
      const recordedId = (recorded as { id?: string } | null)?.id;
      const childName = options.find((option) => option.id === memberId)?.name ?? "Your child";
      const encouragement = paymentRecordedMessage(
        type,
        childName,
        result.amountCents,
        recordedId ?? `${memberId}:${result.amountCents}:${occurredOn}`,
      );

      setSubmitState({
        status: "done",
        type,
        amountCents: result.amountCents,
        balanceCents: balanceRow?.balance_cents ?? null,
        periodEffect,
        encouragement,
      });
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

  const today = todayInZone(formData.timezone);
  const progressOf = (id: string): KnownProgress =>
    progressState.status === "loaded" ? (progressState.progressByMemberId.get(id) ?? null) : undefined;
  const balanceOf = (id: string): Cents | null => balances?.get(id) ?? null;

  const chosen = options.find((option) => option.id === memberId) ?? null;
  const chosenBalance = chosen ? balanceOf(chosen.id) : null;
  const amountCents = typedAmountCents(amountInput);
  const preview = chosen ? paymentPreview(chosenBalance, amountCents, chosen.name) : null;
  const shortcuts =
    type === "payment" && chosen ? paymentShortcuts(chosenBalance, progressOf(chosen.id)) : [];
  const submitting = submitState.status === "submitting";
  const errorMessages = FIELD_ORDER.flatMap((key) => (fieldErrors[key] ? [fieldErrors[key]] : []));

  return (
    <section
      aria-labelledby="record-heading"
      className="mx-auto flex w-full max-w-[560px] flex-col gap-4"
    >
      <div className="flex flex-col gap-1">
        <h1 id="record-heading" className="text-title">
          {copy.title}
        </h1>
        <p className="text-label text-subtle">
          This lowers what a child owes. It is separate from adding an expense.
        </p>
      </div>

      <Segmented
        label="Entry type"
        value={type}
        onValueChange={setType}
        options={(["payment", "adjustment"] as const).map((option) => ({
          value: option,
          label: TYPE_COPY[option].label,
        }))}
      />

      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => void handleSubmit(event)}
      >
        <ErrorSummary messages={errorMessages} />

        <div className="flex flex-col gap-1.5">
          <GroupLabel id="record-member-label">{copy.who}</GroupLabel>
          {options.length === 0 ? (
            <p className="text-body text-muted">No active children yet</p>
          ) : (
            <ChoiceChips
              label={copy.who}
              labelledBy="record-member-label"
              variant="row"
              describedBy={fieldErrors.memberId ? "record-member-error" : undefined}
              value={memberId}
              onValueChange={setMemberId}
              options={options.map((option) => {
                const balance = balanceOf(option.id);
                const chip =
                  balance === null
                    ? null
                    : childCardView(balance, progressOf(option.id), today).chip;
                return {
                  value: option.id,
                  label: option.name,
                  content: (
                    <>
                      <span className="flex min-w-0 items-center gap-3">
                        <Avatar
                          name={option.name}
                          size="sm"
                          className="group-data-[state=on]:bg-accent group-data-[state=on]:text-on-accent"
                        />
                        <span className="flex min-w-0 flex-col items-start gap-1">
                          <span className="font-semibold">{option.name}</span>
                          {chip && (
                            <StatusChip
                              kind={chip.kind}
                              label={chip.label}
                              className="px-2 py-0.5 text-caption"
                            />
                          )}
                        </span>
                      </span>
                      {balance !== null && <OwedText balanceCents={balance} />}
                    </>
                  ),
                };
              })}
            />
          )}
          <FieldError id="record-member-error">{fieldErrors.memberId}</FieldError>
        </div>

        <div className="flex flex-col gap-2">
          <AmountEntry
            id="record-amount"
            label={`${copy.label} amount`}
            value={amountInput}
            onChange={setAmountInput}
            error={fieldErrors.amount}
          />
          {shortcuts.length > 0 && (
            <div
              role="group"
              aria-label="Amount shortcuts"
              className="-mx-gutter flex gap-2 overflow-x-auto px-gutter pb-1.5 pt-0.5 [scrollbar-width:none] min-[420px]:justify-center"
            >
              {shortcuts.map((shortcut) => {
                const pressed = amountCents === shortcut.cents;
                return (
                  <button
                    key={shortcut.kind}
                    type="button"
                    aria-pressed={pressed}
                    onClick={() => setAmountInput(toDecimalString(shortcut.cents))}
                    className={
                      pressed
                        ? "inline-flex min-h-touch shrink-0 items-center whitespace-nowrap rounded-full border border-accent bg-accent-soft px-3.5 text-[0.9375rem] font-semibold text-accent-text tabular-nums"
                        : "inline-flex min-h-touch shrink-0 items-center whitespace-nowrap rounded-full border border-border-strong bg-surface px-3.5 text-[0.9375rem] font-medium text-ink tabular-nums"
                    }
                  >
                    {shortcut.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <TextInput
          id="record-description"
          label="Description"
          placeholder={copy.descriptionPlaceholder}
          value={description}
          onChange={setDescription}
          error={fieldErrors.description}
        />

        <DateChips
          idPrefix="record"
          today={today}
          value={occurredOn}
          onChange={setOccurredOn}
          error={fieldErrors.occurredOn}
        />

        <OptionalDetails label="Add a note or category (optional)">
          <TextInput
            id="record-note"
            label="Note (optional)"
            placeholder="Cash, Venmo, etc."
            value={note}
            onChange={setNote}
          />
          {formData.categories.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="record-category" className="text-label font-semibold text-muted">
                Category (optional)
              </label>
              <select
                id="record-category"
                value={categoryId}
                onChange={(event) => setCategoryId(event.target.value)}
                className="min-h-touch-lg rounded-control border border-border-strong bg-surface px-3 text-body text-ink"
              >
                <option value="">No category</option>
                {formData.categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </OptionalDetails>

        {preview && (
          <div
            data-testid="record-preview"
            className="rounded-panel bg-ok-soft p-4 text-label text-ink"
          >
            <h2 className="text-label font-semibold text-ok">What this will do</h2>
            <ul className="mt-1.5 list-disc pl-5 tabular-nums">
              <li>{preview.line}</li>
              {preview.creditLine && <li>{preview.creditLine}</li>}
            </ul>
            {preview.overNote && (
              <p className="mt-2 flex items-center gap-1.5 text-muted">
                <Icon name="bell" size={16} />
                {preview.overNote}
              </p>
            )}
          </div>
        )}

        {submitState.status === "error" && (
          <SaveError
            message={`Could not save this ${copy.verb}: ${submitState.message}`}
            disabled={submitting}
          />
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
            {submitting ? "Saving…" : recordButtonLabel(type, amountCents, chosen?.name ?? null)}
          </Button>
        </StickyActionBar>
      </form>
    </section>
  );
}
