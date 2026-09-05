import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";

import {
  buildRecordMemberOptions,
  validateRecordForm,
} from "../features/ledger/record-transaction";
import type { RecordFormErrors, RecordTransactionType } from "../features/ledger/record-transaction";
import { useAddExpenseFormData } from "../features/ledger/useAddExpenseFormData";
import { useMembership } from "../features/auth/membership-context";
import type { Membership } from "../features/auth/membership-context";
import { supabase } from "../lib/supabase";
import { todayInZone } from "../lib/dates";
import { formatCents } from "../lib/currency";
import type { Cents } from "../lib/currency";
import type { PaymentPeriodStatus } from "../features/payment-plans/useChildPaymentProgress";

/**
 * `/record-payment` (S2.6). Parent-only, end to end -- unlike `/add-expense`
 * and `/child/:memberId/history` there is no legitimate Child use of this
 * route at all (`record_payment`/`record_adjustment` reject a Child caller
 * outright, including one recording "against themselves"). This page still
 * is not wrapped in `RequireRole role="parent"`: that guard's own
 * `Navigate`-away behavior is built for `/parent` vs `/child`'s two-role
 * split, and re-using it here would either redirect a Child away with no
 * explanation or need a third case bolted on. Instead this component reads
 * `useMembership()` directly (mirroring `AddExpensePage`'s pattern for the
 * shared loading/signed-out/error/no-membership states) and renders an
 * explicit "Parents only" message for a loaded-but-Child membership -- a UX
 * nicety, not the real control. A Child who bypasses this and calls the RPC
 * directly gets the exact same server-side rejection either way.
 */
export function RecordPaymentPage() {
  const membership = useMembership();

  switch (membership.status) {
    case "loading":
      return (
        <p role="status" className="text-label text-ink-subtle">
          Loading your account…
        </p>
      );

    case "signed-out":
      return <Navigate to="/sign-in" replace />;

    case "error":
      return (
        <div role="alert" className="flex flex-col items-start gap-2">
          <p className="text-label text-owed">
            Could not load your account: {membership.message}
          </p>
          <button
            type="button"
            onClick={membership.retry}
            className="min-h-touch rounded-card border border-surface-border px-3 text-label text-ink-muted"
          >
            Retry
          </button>
        </div>
      );

    case "no-membership":
      return (
        <p role="alert" className="text-label text-owed">
          Your account is not linked to a household yet. Ask a parent in your household to invite
          you.
        </p>
      );

    case "loaded":
      if (membership.membership.role !== "parent") {
        return (
          <p role="alert" className="text-label text-owed">
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
    };

const PERIOD_STATUS_LABELS: Record<PaymentPeriodStatus, string> = {
  upcoming: "Upcoming",
  due: "Due",
  partially_paid: "Partially Paid",
  satisfied: "Satisfied",
  overdue: "Overdue",
  waived: "Waived",
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
  { label: string; verb: string; descriptionPlaceholder: string }
> = {
  payment: {
    label: "Payment",
    verb: "payment",
    descriptionPlaceholder: "e.g. Cash payment",
  },
  adjustment: {
    label: "Adjustment",
    verb: "adjustment",
    descriptionPlaceholder: "e.g. Correcting a duplicate entry",
  },
};

/**
 * `record_payment`/`record_adjustment` share one signature and differ only in
 * `type` (see the migration's own header comment on that design). This form
 * combines both behind a type toggle rather than two near-identical pages --
 * the fields, validation, and submit flow are otherwise word-for-word
 * identical, and a Parent choosing "Adjustment" over "Payment" is a one-field
 * decision, not a different task.
 *
 * Deliberately visually distinct from `AddExpensePage`, per this task's
 * requirement that balance-decreasing actions never look like ordinary
 * expense entry:
 *   - a green (`settled`) submit button instead of `AddExpensePage`'s
 *     `bg-accent` blue -- "settled" reads correctly for both a payment
 *     (moving a balance toward zero) and an adjustment (a deliberate
 *     correction), and is already this app's established color for a
 *     positive/no-balance state (see `SignInPage`'s "signed in" panel).
 *   - a type toggle up top that `AddExpensePage` has no equivalent of.
 *   - a distinct heading and copy ("Record a payment or adjustment" /
 *     "amount owed will decrease by exactly this much") that never mentions
 *     due dates or payment periods (Phase 2 concern, out of scope here).
 *   - a post-submit confirmation panel (not an immediate navigate-away) that
 *     names the new balance, per this task's acceptance criteria -- fetched
 *     with a second `household_member_balances` call after the write
 *     succeeds, rather than trying to derive it client-side from the
 *     previous balance (which this page never has a reliable read of).
 */
function RecordForm({ membership }: { membership: Membership }) {
  const formData = useAddExpenseFormData(membership.householdId);
  const navigate = useNavigate();

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
      if (options[0]) {
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
      <p role="status" className="text-label text-ink-subtle">
        Loading…
      </p>
    );
  }

  if (formData.status === "error") {
    return (
      <div role="alert" className="flex flex-col items-start gap-2">
        <p className="text-label text-owed">Could not load this form: {formData.message}</p>
        <button
          type="button"
          onClick={formData.retry}
          className="min-h-touch rounded-card border border-surface-border px-3 text-label text-ink-muted"
        >
          Retry
        </button>
      </div>
    );
  }

  const options = buildRecordMemberOptions(formData.activeMembers);
  const copy = TYPE_COPY[type];

  if (submitState.status === "done") {
    return (
      <section className="flex flex-col gap-4 rounded-card border border-settled/40 bg-settled/5 p-4">
        <h2 className="text-title font-semibold text-settled">
          {TYPE_COPY[submitState.type].label} recorded
        </h2>
        <p className="text-body">
          Recorded a {formatCents(Math.abs(submitState.amountCents))}{" "}
          {TYPE_COPY[submitState.type].verb}.
        </p>
        <p className="text-body font-medium">
          New balance:{" "}
          {submitState.balanceCents === null ? "unavailable" : formatCents(submitState.balanceCents)}
        </p>
        {submitState.periodEffect && (
          <div className="flex flex-col gap-1 rounded-card border border-surface-border px-3 py-2">
            <div className="flex items-center justify-between">
              <h3 className="text-label font-medium text-ink-muted">Payment Period</h3>
              <span className="rounded-card bg-surface-sunken px-2 py-0.5 text-label font-medium text-ink-muted">
                {PERIOD_STATUS_LABELS[submitState.periodEffect.status]}
              </span>
            </div>
            <p className="text-body text-ink">{periodEffectCopy(submitState.periodEffect)}</p>
            <p className="text-label text-ink-subtle">
              {formatCents(submitState.periodEffect.paidCents)} of{" "}
              {formatCents(submitState.periodEffect.minimumCents)} paid
            </p>
          </div>
        )}
        <button
          type="button"
          onClick={() => navigate("/parent")}
          className="inline-flex min-h-touch items-center justify-center rounded-card bg-settled px-4 text-body font-medium text-white"
        >
          Done
        </button>
      </section>
    );
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    const result = validateRecordForm({ memberId, amountInput, description, occurredOn });
    if (!result.ok) {
      setFieldErrors(result.errors);
      return;
    }
    setFieldErrors({});
    setSubmitState({ status: "submitting" });

    const rpcName = type === "payment" ? "record_payment" : "record_adjustment";

    try {
      const { error } = await supabase.rpc(rpcName, {
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

      setSubmitState({
        status: "done",
        type,
        amountCents: result.amountCents,
        balanceCents: balanceRow?.balance_cents ?? null,
        periodEffect,
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

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-title font-semibold">Record a Payment or Adjustment</h2>
      <p className="text-label text-ink-subtle">
        This decreases the amount a child owes. It is separate from adding an expense.
      </p>

      <div className="flex gap-2 rounded-card border border-settled/40 bg-settled/5 p-1">
        {(["payment", "adjustment"] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setType(option)}
            aria-pressed={type === option}
            className={`min-h-touch flex-1 rounded-card px-3 text-body font-medium ${
              type === option ? "bg-settled text-white" : "text-ink-muted"
            }`}
          >
            {TYPE_COPY[option].label}
          </button>
        ))}
      </div>

      <form className="flex flex-col gap-4" onSubmit={(event) => void handleSubmit(event)}>
        <div className="flex flex-col gap-1">
          <label htmlFor="record-member" className="text-label text-ink-muted">
            For
          </label>
          <select
            id="record-member"
            value={memberId}
            onChange={(event) => setMemberId(event.target.value)}
            className="min-h-touch rounded-card border border-surface-border px-3 text-body"
          >
            {options.length === 0 && <option value="">No active children yet</option>}
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
          {fieldErrors.memberId && <p className="text-label text-owed">{fieldErrors.memberId}</p>}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="record-amount" className="text-label text-ink-muted">
            {copy.label} amount
          </label>
          <input
            id="record-amount"
            type="text"
            inputMode="decimal"
            placeholder="25.00"
            value={amountInput}
            onChange={(event) => setAmountInput(event.target.value)}
            className="min-h-touch rounded-card border border-surface-border px-3 text-body"
          />
          <p className="text-label text-ink-subtle">
            Enter a positive amount -- this will decrease the balance.
          </p>
          {fieldErrors.amount && <p className="text-label text-owed">{fieldErrors.amount}</p>}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="record-category" className="text-label text-ink-muted">
            Category (optional)
          </label>
          <select
            id="record-category"
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
            className="min-h-touch rounded-card border border-surface-border px-3 text-body"
          >
            <option value="">No category</option>
            {formData.categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="record-description" className="text-label text-ink-muted">
            Description
          </label>
          <input
            id="record-description"
            type="text"
            placeholder={copy.descriptionPlaceholder}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className="min-h-touch rounded-card border border-surface-border px-3 text-body"
          />
          {fieldErrors.description && (
            <p className="text-label text-owed">{fieldErrors.description}</p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="record-note" className="text-label text-ink-muted">
            Note (optional)
          </label>
          <input
            id="record-note"
            type="text"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className="min-h-touch rounded-card border border-surface-border px-3 text-body"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="record-date" className="text-label text-ink-muted">
            Date
          </label>
          <input
            id="record-date"
            type="date"
            value={occurredOn}
            onChange={(event) => setOccurredOn(event.target.value)}
            className="min-h-touch rounded-card border border-surface-border px-3 text-body"
          />
          {fieldErrors.occurredOn && (
            <p className="text-label text-owed">{fieldErrors.occurredOn}</p>
          )}
        </div>

        {submitState.status === "error" && (
          <div role="alert" className="flex flex-col items-start gap-2">
            <p className="text-label text-owed">
              Could not save this {copy.verb}: {submitState.message}
            </p>
          </div>
        )}

        <button
          type="submit"
          disabled={submitState.status === "submitting"}
          className="inline-flex min-h-touch items-center justify-center gap-2 rounded-card bg-settled px-4 text-body font-medium text-white disabled:opacity-60"
        >
          <span aria-hidden="true">✓</span>
          {submitState.status === "submitting" ? "Saving…" : `Save ${copy.label}`}
        </button>
      </form>
    </section>
  );
}
