import { useEffect, useMemo, useRef, useState } from "react";
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
import { LoadError } from "../components/ui/LoadError";
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
import { formatCalendarDate, todayInZone } from "../lib/dates";
import { formatCents, toDecimalString } from "../lib/currency";
import type { Cents } from "../lib/currency";
import type { PaymentPeriodStatus } from "../features/payment-plans/useChildPaymentProgress";
import { fetchPeriodEffects } from "../features/payment-plans/period-effect";
import type { PeriodEffect } from "../features/payment-plans/period-effect";
import { useMemberPlanTargets } from "../features/payment-plans/useMemberPlanTargets";
import { MoveMoneyForm } from "../features/ledger/MoveMoneyForm";
import {
  balancesAfter,
  creditedBalanceIds,
  largestPartBalanceId,
  owedWords,
  planEffects,
  rowsFromParts,
  suggestSplit,
  validateSplit,
} from "../features/ledger/payment-split";
import type { SplitRow } from "../features/ledger/payment-split";
import { SplitEditor } from "../features/ledger/SplitEditor";
import {
  fetchBreakdown,
  useMemberBreakdown,
  useTrackedBalances,
} from "../features/ledger/useBalanceSplitData";
import { usePaymentSuggestion } from "../features/ledger/usePaymentSuggestion";
import { readLastUsedBalance, writeLastUsedBalance } from "../features/ledger/last-used-balance";

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
        <LoadError
          message={`Could not load your account: ${membership.message}`}
          onRetry={membership.retry}
        />
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

type SubmitState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "error"; message: string }
  | {
      status: "done";
      type: RecordTransactionType;
      amountCents: Cents;
      balanceCents: Cents | null;
      /** Each balance's amount owed after the write (split households only). */
      balanceLines: { name: string; cents: Cents }[] | null;
      /**
       * Only ever populated for a `payment` (never an `adjustment` -- see
       * module comment on S3.4), one entry per affected plan. An empty list
       * covers every "nothing to show" case uniformly: no active plan on
       * the balances paid, the type was `adjustment`, a backdated payment no
       * stored period covers, or the best-effort secondary fetch failed.
       */
      periodEffects: PeriodEffect[];
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
  const [mode, setMode] = useState<"record" | "move">("record");
  // The split the Parent edited by hand; null while the suggested split is in use.
  const [manualRows, setManualRows] = useState<SplitRow[] | null>(null);
  // Which set of credit-creating balances the Parent has confirmed.
  const [creditAckedFor, setCreditAckedFor] = useState("");

  const balancesState = useTrackedBalances(membership.householdId);
  const { breakdown, refetch: refetchBreakdown } = useMemberBreakdown(membership.householdId);
  const planTargets = useMemberPlanTargets(memberId);
  const suggestionId = searchParams.get("suggestion");
  const suggestionState = usePaymentSuggestion(suggestionId);
  // Set once a pending suggestion has been copied into the form.
  const appliedSuggestion = useRef<string | null>(null);

  const splitBalances = balancesState.status === "loaded" ? balancesState.balances : [];
  const splitMode = splitBalances.length > 1;
  const typedAmount = typedAmountCents(amountInput);
  const suggestedRows = useMemo(
    () =>
      typedAmount === null || !splitMode
        ? []
        : rowsFromParts(
            suggestSplit({
              amountCents: typedAmount,
              balances: splitBalances,
              targets: planTargets ?? [],
              lastUsedBalanceId: memberId === "" ? null : readLastUsedBalance(memberId),
            }),
          ),
    // `splitBalances` is derived from `balancesState` alone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [typedAmount, splitMode, balancesState, planTargets, memberId],
  );

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

  // `?suggestion=<id>` (from a child's payment suggestion): copy its child,
  // amount, date, note and parts into the form once. Declared after the
  // seeding effect so its values win when both run on the same render.
  useEffect(() => {
    if (formData.status !== "loaded" || suggestionState.status !== "loaded") return;
    const { suggestion } = suggestionState;
    if (suggestion.status !== "pending" || appliedSuggestion.current === suggestion.id) return;
    appliedSuggestion.current = suggestion.id;

    if (buildRecordMemberOptions(formData.activeMembers).some((o) => o.id === suggestion.memberId)) {
      setMemberId(suggestion.memberId);
    }
    setType("payment");
    setAmountInput(toDecimalString(suggestion.amountCents));
    setOccurredOn(suggestion.suggestedOn);
    setNote(suggestion.note ?? "");
    setManualRows(rowsFromParts(suggestion.parts));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.status, suggestionState]);

  if (formData.status === "loading") {
    return (
      <p role="status" className="text-label text-subtle">
        Loading…
      </p>
    );
  }

  if (formData.status === "error") {
    return (
      <LoadError
        message={`Could not load this form: ${formData.message}`}
        onRetry={formData.retry}
      />
    );
  }

  const options = buildRecordMemberOptions(formData.activeMembers);
  const copy = TYPE_COPY[type];
  const today = todayInZone(formData.timezone);
  const balanceNameOf = (id: string) =>
    splitBalances.find((balance) => balance.id === id)?.name ?? "Balance";
  const rows = manualRows ?? suggestedRows;
  const owedByBalance = breakdown ? (breakdown.get(memberId) ?? new Map<string, Cents>()) : null;
  const split = splitMode && typedAmount !== null ? validateSplit(typedAmount, rows) : null;
  const creditedIds =
    split?.ok === true ? creditedBalanceIds(split.parts, owedByBalance) : [];
  const creditKey = creditedIds.join(",");
  const creditPending = creditedIds.length > 0 && creditAckedFor !== creditKey;
  const splitBlocked =
    balancesState.status !== "loaded" || (split !== null && (!split.ok || creditPending));

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
          {submitState.balanceLines && (
            <ul className="list-disc pl-5 text-body text-ink tabular-nums">
              {submitState.balanceLines.map((line) => (
                <li key={line.name}>
                  {line.name}: {owedWords(line.cents)}
                </li>
              ))}
            </ul>
          )}
        </Card>
        {submitState.periodEffects.map((effect) => (
          <Card key={effect.balanceId} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-head">
                {submitState.balanceLines
                  ? `${balanceNameOf(effect.balanceId)}: ${formatCalendarDate(effect.periodStart, "month")} payment period`
                  : `${formatCalendarDate(effect.periodStart, "month")} payment period`}
              </h2>
              <StatusChip
                kind={PERIOD_STATUS_KIND[effect.status]}
                label={PERIOD_STATUS_LABELS[effect.status]}
              />
            </div>
            <p className="text-body text-ink">{periodEffectCopy(effect)}</p>
            <p className="text-label text-subtle tabular-nums">
              {formatCents(effect.paidCents)} of {formatCents(effect.minimumCents)} paid
            </p>
          </Card>
        ))}
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
    if (splitBlocked) return;
    setFieldErrors({});
    setSubmitState({ status: "submitting" });

    const rpcName = type === "payment" ? "record_payment" : "record_adjustment";
    // Parts the Parent chose; null (wholly Everyday) when there is nothing to split.
    const parts = split?.ok === true ? split.parts : null;
    const everydayId = splitBalances.find((balance) => balance.isEveryday)?.id ?? null;

    try {
      const { data: recorded, error } = await supabase.rpc(rpcName, {
        p_member_id: memberId,
        p_amount_cents: result.amountCents,
        p_description: description.trim(),
        p_occurred_on: occurredOn,
        p_category_id: categoryId === "" ? null : categoryId,
        p_note: note.trim() === "" ? null : note.trim(),
        p_allocations: parts
          ? parts.map((part) => ({
              tracked_balance_id: part.balanceId,
              amount_cents: part.cents,
            }))
          : null,
        // Only a payment can come from a child's suggestion.
        // Dropped if the Parent switched to a different child afterwards.
        ...(type === "payment" &&
        appliedSuggestion.current &&
        suggestionState.status === "loaded" &&
        suggestionState.suggestion.id === appliedSuggestion.current &&
        suggestionState.suggestion.memberId === memberId
          ? { p_suggestion_id: appliedSuggestion.current }
          : {}),
      });

      if (error) {
        // A rejected write (e.g. a stale session that lost Parent status, or
        // any other server-side check such as a split that does not add up)
        // surfaces here as a retry-able error state. Never queued for later
        // replay -- ADR-007.
        setSubmitState({ status: "error", message: error.message });
        return;
      }

      if (parts) {
        const largest = largestPartBalanceId(parts);
        if (largest) writeLastUsedBalance(memberId, largest);
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

      // Per-balance amounts owed now, for households with more than Everyday.
      let balanceLines: { name: string; cents: Cents }[] | null = null;
      if (splitMode) {
        const fresh = await fetchBreakdown(membership.householdId);
        const owedNow = fresh?.get(memberId);
        if (owedNow) {
          balanceLines = splitBalances.map((balance) => ({
            name: balance.name,
            cents: owedNow.get(balance.id) ?? 0,
          }));
        }
        refetchBreakdown();
      }

      // Period effect (S3.4) is a payment-only concern -- an adjustment never
      // counts toward a period's paid amount (the allocation rule excludes
      // adjustments entirely), so showing period-shaped UI for one would be
      // misleading rather than helpful. No RPC calls at all for an adjustment.
      // Only plans on the balances actually paid are shown (Everyday when no
      // split was sent).
      const periodEffects =
        type === "payment"
          ? await fetchPeriodEffects(
              memberId,
              occurredOn,
              parts
                ? new Set(parts.map((part) => part.balanceId))
                : everydayId
                  ? new Set([everydayId])
                  : null,
            )
          : [];

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
        balanceLines,
        periodEffects,
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

  const splitAfter =
    split?.ok === true && owedByBalance ? balancesAfter(split.parts, owedByBalance) : null;
  const planLines =
    type === "payment" && split?.ok === true
      ? planEffects({ parts: split.parts, targets: planTargets ?? [], occurredOn }).map((effect) =>
          effect.remainingAfterCents === 0
            ? `${balanceNameOf(effect.balanceId)} plan: this period's minimum will be met.`
            : `${balanceNameOf(effect.balanceId)} plan: ${formatCents(effect.remainingAfterCents)} will still be due this period.`,
        )
      : [];
  const suggestionNote =
    suggestionState.status === "loaded" && suggestionState.suggestion.status !== "pending"
      ? "That payment suggestion has already been handled, so nothing was filled in."
      : suggestionState.status === "error"
        ? `Could not load that payment suggestion: ${suggestionState.message}`
        : null;

  const modeSwitch = splitMode && (
    <Segmented
      label="What would you like to do?"
      value={mode}
      onValueChange={setMode}
      options={[
        { value: "record", label: "Record payment" },
        { value: "move", label: "Move money" },
      ]}
    />
  );

  if (mode === "move") {
    return (
      <section
        aria-labelledby="record-heading"
        className="mx-auto flex w-full max-w-[560px] flex-col gap-4"
      >
        <h1 id="record-heading" className="text-title">
          Move money
        </h1>
        {modeSwitch}
        <MoveMoneyForm
          householdId={membership.householdId}
          children={options}
          balances={splitBalances}
          breakdown={breakdown}
          initialMemberId={memberId}
          today={today}
          onMoved={refetchBreakdown}
        />
      </section>
    );
  }

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

      {modeSwitch}

      {suggestionNote && (
        <p role="status" className="text-label text-muted">
          {suggestionNote}
        </p>
      )}

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
              onValueChange={(next) => {
                setMemberId(next);
                setManualRows(null);
              }}
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

        {balancesState.status === "error" && (
          <div
            role="alert"
            className="flex flex-col items-start gap-2 rounded-control bg-danger-soft px-3 py-2.5 text-label font-medium text-danger"
          >
            <p>Could not load the child&rsquo;s balances: {balancesState.message}</p>
            <Button size="sm" onClick={balancesState.retry}>
              Try again
            </Button>
          </div>
        )}

        {splitMode && typedAmount !== null && (
          <SplitEditor
            rows={rows}
            balances={splitBalances}
            amountCents={typedAmount}
            validation={split ?? { ok: false, message: "" }}
            isManual={manualRows !== null}
            onRowsChange={setManualRows}
            onReset={() => setManualRows(null)}
            after={splitAfter}
            planLines={planLines}
            showPlanEffects={type === "payment"}
            creditNames={creditedIds.map(balanceNameOf)}
            creditAcknowledged={!creditPending && creditedIds.length > 0}
            onCreditAcknowledgedChange={(checked) => setCreditAckedFor(checked ? creditKey : "")}
          />
        )}

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
            disabled={splitBlocked}
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
