import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Navigate, useParams } from "react-router-dom";

import { useMembership } from "../features/auth/membership-context";
import type { PlanFormErrors, PlanFormInput } from "../features/payment-plans/payment-plans";
import { validatePlanForm } from "../features/payment-plans/payment-plans";
import type { PaymentPlanRow } from "../features/payment-plans/payment-plans";
import { usePaymentPlan } from "../features/payment-plans/usePaymentPlan";
import { supabase } from "../lib/supabase";
import { formatCents, toDecimalString } from "../lib/currency";

const EMPTY_FORM: PlanFormInput = {
  minimumAmountInput: "",
  dueDayInput: "",
  startsOn: "",
  endsOn: "",
};

/**
 * `/child/:memberId/payment-plan` (S3.1). Parent-only end to end, like
 * `RecordPaymentPage`: `create_payment_plan`/`deactivate_payment_plan` both
 * reject a non-Parent caller server-side, so this page is not wrapped in
 * `RequireRole` either -- it reads `useMembership()` directly and renders the
 * exact loading/signed-out/error/no-membership JSX `RecordPaymentPage` uses,
 * plus the same "Only a parent can..." message for a loaded-but-Child
 * membership. A Child who reaches this route directly never sees any
 * create/edit/deactivate control, only that message.
 */
export function PaymentPlanPage() {
  const membership = useMembership();
  const { memberId } = useParams<{ memberId: string }>();

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
            Only a parent can manage a payment plan.
          </p>
        );
      }
      if (!memberId) {
        // Unreachable via the registered route (which always supplies the
        // param), but keeps this exhaustive without a non-null assertion --
        // mirrors HistoryPage's identical fallback.
        return <p className="text-label text-ink-subtle">No payment plan to show.</p>;
      }
      return <PlanManager memberId={memberId} />;
  }
}

/**
 * Fetches just the child's display name for the heading. A Parent can
 * already read any active member's row in their own household (S2.1's
 * Parent-listing RLS policy), so this is a plain, unauthorized-by-the-UI
 * read -- the same "RLS does the real work" posture as everywhere else in
 * this app.
 */
function useChildName(memberId: string): string | null {
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setName(null);

    supabase
      .from("household_members")
      .select("name")
      .eq("id", memberId)
      .single<{ name: string }>()
      .then(({ data, error }) => {
        if (!active || error || !data) {
          return;
        }
        setName(data.name);
      });

    return () => {
      active = false;
    };
  }, [memberId]);

  return name;
}

function PlanManager({ memberId }: { memberId: string }) {
  const planState = usePaymentPlan(memberId);
  const childName = useChildName(memberId);
  const heading = childName ? `${childName}'s Payment Plan` : "Payment Plan";

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-title font-semibold">{heading}</h2>

      {planState.status === "loading" && (
        <p role="status" className="text-label text-ink-subtle">
          Loading payment plan…
        </p>
      )}

      {planState.status === "error" && (
        <div role="alert" className="flex flex-col items-start gap-2">
          <p className="text-label text-owed">Could not load this plan: {planState.message}</p>
          <button
            type="button"
            onClick={planState.retry}
            className="min-h-touch rounded-card border border-surface-border px-3 text-label text-ink-muted"
          >
            Retry
          </button>
        </div>
      )}

      {planState.status === "loaded" && planState.plan === null && (
        <NoActivePlan memberId={memberId} onCreated={planState.refetch} />
      )}

      {planState.status === "loaded" && planState.plan !== null && (
        <ActivePlan memberId={memberId} plan={planState.plan} onChanged={planState.refetch} />
      )}
    </section>
  );
}

/** "No active plan" is a first-class, clearly-labeled state -- not blank, not an error. */
function NoActivePlan({
  memberId,
  onCreated,
}: {
  memberId: string;
  onCreated: () => void;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-card border border-surface-border bg-surface-sunken p-4">
      <div className="flex flex-col gap-1">
        <h3 className="text-body font-semibold text-ink-muted">No active plan</h3>
        <p className="text-label text-ink-subtle">
          This child does not currently have a payment plan. Create one below to set a recurring
          minimum amount and due day.
        </p>
      </div>
      <PlanForm
        memberId={memberId}
        initialValues={EMPTY_FORM}
        submitLabel="Create plan"
        onSaved={onCreated}
      />
    </div>
  );
}

function planFormValuesFromPlan(plan: PaymentPlanRow): PlanFormInput {
  return {
    minimumAmountInput: toDecimalString(plan.minimumCents),
    dueDayInput: String(plan.dueDay),
    startsOn: plan.startsOn,
    endsOn: plan.endsOn ?? "",
  };
}

/** Shows the current plan's terms plus the Replace and Deactivate controls. */
function ActivePlan({
  memberId,
  plan,
  onChanged,
}: {
  memberId: string;
  plan: PaymentPlanRow;
  onChanged: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-card border border-surface-border p-4">
        <dt className="text-label text-ink-subtle">Minimum amount</dt>
        <dd className="text-body font-medium">{formatCents(plan.minimumCents)}</dd>
        <dt className="text-label text-ink-subtle">Due day</dt>
        <dd className="text-body font-medium">Day {plan.dueDay} of each month</dd>
        <dt className="text-label text-ink-subtle">Start date</dt>
        <dd className="text-body font-medium">{plan.startsOn}</dd>
        <dt className="text-label text-ink-subtle">End date</dt>
        <dd className="text-body font-medium">{plan.endsOn ?? "No end date"}</dd>
      </dl>

      <ReplacePlanControl memberId={memberId} plan={plan} onChanged={onChanged} />
      <DeactivatePlanControl planId={plan.id} onChanged={onChanged} />
    </div>
  );
}

type ReplaceState =
  | { status: "collapsed" }
  | { status: "editing"; fields: PlanFormInput; errors: PlanFormErrors }
  | {
      status: "confirming";
      fields: PlanFormInput;
      validated: { minimumCents: number; dueDay: number; startsOn: string; endsOn: string | null };
    }
  | {
      status: "submitting";
      fields: PlanFormInput;
      validated: { minimumCents: number; dueDay: number; startsOn: string; endsOn: string | null };
    }
  | { status: "error"; fields: PlanFormInput; message: string };

/**
 * Creating a new plan for a child who already has an active one is a
 * supersession, not an ordinary create: `create_payment_plan` deactivates the
 * existing active plan and creates the new one atomically. This control makes
 * that explicit in the UI (acceptance criterion 2) with a two-step confirm,
 * mirroring `HistoryPage`'s `VoidControl` state-machine shape: collapsed (the
 * plan summary above, plus an "Edit plan" button) -> editing (the form) ->
 * confirming (an explicit "this will replace the current plan" message plus a
 * confirm/cancel pair) -> submitting -> error (the RPC's own message,
 * verbatim, re-submittable).
 */
function ReplacePlanControl({
  memberId,
  plan,
  onChanged,
}: {
  memberId: string;
  plan: PaymentPlanRow;
  onChanged: () => void;
}) {
  const [state, setState] = useState<ReplaceState>({ status: "collapsed" });

  if (state.status === "collapsed") {
    return (
      <button
        type="button"
        onClick={() =>
          setState({ status: "editing", fields: planFormValuesFromPlan(plan), errors: {} })
        }
        className="min-h-touch self-start rounded-card border border-surface-border px-3 text-label font-medium text-ink-muted"
      >
        Edit plan
      </button>
    );
  }

  const fields = state.fields;

  function updateField(patch: Partial<PlanFormInput>) {
    if (state.status !== "editing" && state.status !== "error") {
      return;
    }
    setState({ status: "editing", fields: { ...fields, ...patch }, errors: {} });
  }

  function handleValidate(event: FormEvent) {
    event.preventDefault();

    const result = validatePlanForm(fields);
    if (!result.ok) {
      setState({ status: "editing", fields, errors: result.errors });
      return;
    }

    setState({
      status: "confirming",
      fields,
      validated: {
        minimumCents: result.minimumCents,
        dueDay: result.dueDay,
        startsOn: result.startsOn,
        endsOn: result.endsOn,
      },
    });
  }

  async function handleConfirm() {
    if (state.status !== "confirming") {
      return;
    }
    const { validated } = state;
    setState({ status: "submitting", fields, validated });

    try {
      const { error } = await supabase.rpc("create_payment_plan", {
        p_member_id: memberId,
        p_minimum_cents: validated.minimumCents,
        p_due_day: validated.dueDay,
        p_starts_on: validated.startsOn,
        p_ends_on: validated.endsOn,
      });

      if (error) {
        setState({ status: "error", fields, message: error.message });
        return;
      }

      setState({ status: "collapsed" });
      onChanged();
    } catch (caught) {
      setState({
        status: "error",
        fields,
        message:
          caught instanceof Error
            ? `Could not reach the ledger service: ${caught.message}`
            : "Could not reach the ledger service.",
      });
    }
  }

  const errors: PlanFormErrors = state.status === "editing" ? state.errors : {};
  const submitting = state.status === "submitting";

  return (
    <div className="flex flex-col gap-3 rounded-card border border-accent/40 bg-accent/5 p-4">
      <h4 className="text-body font-semibold">Replace plan</h4>
      <form className="flex flex-col gap-3" onSubmit={handleValidate}>
        <PlanFieldset
          idPrefix="replace"
          fields={fields}
          errors={errors}
          disabled={submitting}
          onChange={updateField}
        />

        {state.status === "error" && (
          <p role="alert" className="text-label text-owed">
            Could not save this plan: {state.message}
          </p>
        )}

        {state.status === "confirming" && (
          <div className="flex flex-col gap-2 rounded-card border border-owed/60 bg-owed/5 p-3">
            <p role="alert" className="text-label font-medium text-owed">
              This will replace the current plan of {formatCents(plan.minimumCents)}/month due on
              day {plan.dueDay} -- the old plan will be deactivated.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void handleConfirm()}
                className="inline-flex min-h-touch flex-1 items-center justify-center rounded-card bg-owed px-3 text-label font-medium text-white"
              >
                Confirm replace
              </button>
              <button
                type="button"
                onClick={() => setState({ status: "collapsed" })}
                className="min-h-touch flex-1 rounded-card border border-surface-border px-3 text-label text-ink-muted"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {state.status !== "confirming" && (
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex min-h-touch flex-1 items-center justify-center rounded-card bg-accent px-3 text-label font-medium text-white disabled:opacity-60"
            >
              {submitting ? "Saving…" : "Review changes"}
            </button>
            <button
              type="button"
              onClick={() => setState({ status: "collapsed" })}
              disabled={submitting}
              className="min-h-touch flex-1 rounded-card border border-surface-border px-3 text-label text-ink-muted disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        )}
      </form>
    </div>
  );
}

type CreateState =
  | { status: "idle"; errors: PlanFormErrors }
  | { status: "submitting" }
  | { status: "error"; message: string };

/**
 * The create form for a child with no existing plan (acceptance criterion
 * 1). Nothing is being replaced, so this submits directly on one click --
 * no confirmation step, unlike `ReplacePlanControl`.
 */
function PlanForm({
  memberId,
  initialValues,
  submitLabel,
  onSaved,
}: {
  memberId: string;
  initialValues: PlanFormInput;
  submitLabel: string;
  onSaved: () => void;
}) {
  const [fields, setFields] = useState<PlanFormInput>(initialValues);
  const [state, setState] = useState<CreateState>({ status: "idle", errors: {} });

  function updateField(patch: Partial<PlanFormInput>) {
    setFields((current) => ({ ...current, ...patch }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    const result = validatePlanForm(fields);
    if (!result.ok) {
      setState({ status: "idle", errors: result.errors });
      return;
    }

    setState({ status: "submitting" });

    try {
      const { error } = await supabase.rpc("create_payment_plan", {
        p_member_id: memberId,
        p_minimum_cents: result.minimumCents,
        p_due_day: result.dueDay,
        p_starts_on: result.startsOn,
        p_ends_on: result.endsOn,
      });

      if (error) {
        setState({ status: "error", message: error.message });
        return;
      }

      onSaved();
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

  const errors = state.status === "idle" ? state.errors : {};
  const submitting = state.status === "submitting";

  return (
    <form className="flex flex-col gap-3" onSubmit={(event) => void handleSubmit(event)}>
      <PlanFieldset
        idPrefix="create"
        fields={fields}
        errors={errors}
        disabled={submitting}
        onChange={updateField}
      />

      {state.status === "error" && (
        <p role="alert" className="text-label text-owed">
          Could not save this plan: {state.message}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="inline-flex min-h-touch items-center justify-center rounded-card bg-accent px-4 text-body font-medium text-white disabled:opacity-60"
      >
        {submitting ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}

/** The four plan fields, shared between the create form and the replace form. */
function PlanFieldset({
  idPrefix,
  fields,
  errors,
  disabled,
  onChange,
}: {
  idPrefix: string;
  fields: PlanFormInput;
  errors: PlanFormErrors;
  disabled: boolean;
  onChange: (patch: Partial<PlanFormInput>) => void;
}) {
  return (
    <>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${idPrefix}-amount`} className="text-label text-ink-muted">
          Minimum amount
        </label>
        <input
          id={`${idPrefix}-amount`}
          type="text"
          inputMode="decimal"
          placeholder="25.00"
          value={fields.minimumAmountInput}
          disabled={disabled}
          onChange={(event) => onChange({ minimumAmountInput: event.target.value })}
          className="min-h-touch rounded-card border border-surface-border px-3 text-body"
        />
        {errors.minimumAmount && <p className="text-label text-owed">{errors.minimumAmount}</p>}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={`${idPrefix}-due-day`} className="text-label text-ink-muted">
          Due day (1-28)
        </label>
        <input
          id={`${idPrefix}-due-day`}
          type="number"
          min={1}
          max={28}
          value={fields.dueDayInput}
          disabled={disabled}
          onChange={(event) => onChange({ dueDayInput: event.target.value })}
          className="min-h-touch rounded-card border border-surface-border px-3 text-body"
        />
        {errors.dueDay && <p className="text-label text-owed">{errors.dueDay}</p>}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={`${idPrefix}-starts-on`} className="text-label text-ink-muted">
          Start date
        </label>
        <input
          id={`${idPrefix}-starts-on`}
          type="date"
          value={fields.startsOn}
          disabled={disabled}
          onChange={(event) => onChange({ startsOn: event.target.value })}
          className="min-h-touch rounded-card border border-surface-border px-3 text-body"
        />
        {errors.startsOn && <p className="text-label text-owed">{errors.startsOn}</p>}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={`${idPrefix}-ends-on`} className="text-label text-ink-muted">
          End date (optional)
        </label>
        <input
          id={`${idPrefix}-ends-on`}
          type="date"
          value={fields.endsOn}
          disabled={disabled}
          onChange={(event) => onChange({ endsOn: event.target.value })}
          className="min-h-touch rounded-card border border-surface-border px-3 text-body"
        />
        {errors.endsOn && <p className="text-label text-owed">{errors.endsOn}</p>}
      </div>
    </>
  );
}

type DeactivateState =
  | { status: "collapsed" }
  | { status: "confirming" }
  | { status: "submitting" }
  | { status: "error"; message: string };

/**
 * Deactivating a plan (acceptance criterion 3) needs no reason (unlike
 * `VoidControl`'s void reason -- `deactivate_payment_plan` takes only
 * `p_plan_id`), but keeps the same collapsed -> confirming -> submitting ->
 * error two-step shape so a Parent cannot deactivate with a single
 * accidental click.
 */
function DeactivatePlanControl({
  planId,
  onChanged,
}: {
  planId: string;
  onChanged: () => void;
}) {
  const [state, setState] = useState<DeactivateState>({ status: "collapsed" });

  if (state.status === "collapsed") {
    return (
      <button
        type="button"
        onClick={() => setState({ status: "confirming" })}
        className="min-h-touch self-start rounded-card border border-owed px-3 text-label font-medium text-owed"
      >
        Deactivate plan
      </button>
    );
  }

  async function handleConfirm() {
    setState({ status: "submitting" });

    try {
      const { error } = await supabase.rpc("deactivate_payment_plan", {
        p_plan_id: planId,
      });

      if (error) {
        setState({ status: "error", message: error.message });
        return;
      }

      setState({ status: "collapsed" });
      onChanged();
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

  return (
    <div className="flex flex-col gap-2 rounded-card border border-owed/60 bg-owed/5 p-3">
      <p className="text-label font-medium text-owed">
        Deactivate this plan? The child will have no active plan afterward.
      </p>
      {state.status === "error" && (
        <p role="alert" className="text-label text-owed">
          Could not deactivate this plan: {state.message}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void handleConfirm()}
          disabled={state.status === "submitting"}
          className="inline-flex min-h-touch flex-1 items-center justify-center rounded-card bg-owed px-3 text-label font-medium text-white disabled:opacity-60"
        >
          {state.status === "submitting" ? "Deactivating…" : "Confirm deactivate"}
        </button>
        <button
          type="button"
          onClick={() => setState({ status: "collapsed" })}
          disabled={state.status === "submitting"}
          className="min-h-touch flex-1 rounded-card border border-surface-border px-3 text-label text-ink-muted disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
