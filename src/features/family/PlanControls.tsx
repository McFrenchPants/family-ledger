import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import { Button } from "../../components/ui/Button";
import { Field } from "../../components/ui/Field";
import { formatCents, toDecimalString } from "../../lib/currency";
import { supabase } from "../../lib/supabase";
import type {
  PaymentPlanRow,
  PlanFormErrors,
  PlanFormInput,
} from "../payment-plans/payment-plans";
import { validatePlanForm } from "../payment-plans/payment-plans";

/**
 * Payment-plan editing for a child's page (moved unchanged in behaviour from
 * the old `/child/:id/payment-plan` screen). Every write goes through the
 * `create_payment_plan` / `deactivate_payment_plan` security-definer
 * functions, which reject a non-Parent caller server-side; showing or hiding
 * these controls is presentation only.
 */

const EMPTY_FORM: PlanFormInput = {
  minimumAmountInput: "",
  dueDayInput: "",
  startsOn: "",
  endsOn: "",
};

type ValidatedPlan = { minimumCents: number; dueDay: number; startsOn: string; endsOn: string | null };

function networkMessage(caught: unknown): string {
  return caught instanceof Error
    ? `Could not reach the ledger service: ${caught.message}`
    : "Could not reach the ledger service.";
}

async function createPlan(memberId: string, plan: ValidatedPlan): Promise<string | null> {
  try {
    const { error } = await supabase.rpc("create_payment_plan", {
      p_member_id: memberId,
      p_minimum_cents: plan.minimumCents,
      p_due_day: plan.dueDay,
      p_starts_on: plan.startsOn,
      p_ends_on: plan.endsOn,
    });
    return error ? error.message : null;
  } catch (caught) {
    return networkMessage(caught);
  }
}

function planFormValuesFromPlan(plan: PaymentPlanRow): PlanFormInput {
  return {
    minimumAmountInput: toDecimalString(plan.minimumCents),
    dueDayInput: String(plan.dueDay),
    startsOn: plan.startsOn,
    endsOn: plan.endsOn ?? "",
  };
}

/* ------------------------------------------------------------------ */
/* Create (no active plan)                                              */
/* ------------------------------------------------------------------ */

type CreateState =
  | { status: "idle"; errors: PlanFormErrors }
  | { status: "submitting" }
  | { status: "error"; message: string };

/**
 * The create form for a child with no active plan. Nothing is being
 * replaced, so it submits directly -- no confirmation step.
 */
export function CreatePlanForm({ memberId, onSaved }: { memberId: string; onSaved: () => void }) {
  const [fields, setFields] = useState<PlanFormInput>(EMPTY_FORM);
  const [state, setState] = useState<CreateState>({ status: "idle", errors: {} });

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    const result = validatePlanForm(fields);
    if (!result.ok) {
      setState({ status: "idle", errors: result.errors });
      return;
    }

    setState({ status: "submitting" });
    const failure = await createPlan(memberId, result);
    if (failure !== null) {
      setState({ status: "error", message: failure });
      return;
    }
    onSaved();
  }

  const submitting = state.status === "submitting";

  return (
    <form className="flex flex-col gap-3" onSubmit={(event) => void handleSubmit(event)}>
      <PlanFieldset
        idPrefix="create"
        fields={fields}
        errors={state.status === "idle" ? state.errors : {}}
        disabled={submitting}
        onChange={(patch) => setFields((current) => ({ ...current, ...patch }))}
      />

      {state.status === "error" && (
        <p role="alert" className="text-label text-danger">
          Could not save this plan: {state.message}
        </p>
      )}

      <Button type="submit" variant="primary" loading={submitting} className="self-start">
        {submitting ? "Saving…" : "Create plan"}
      </Button>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Replace (edit an active plan)                                        */
/* ------------------------------------------------------------------ */

type ReplaceState =
  | { status: "editing"; fields: PlanFormInput; errors: PlanFormErrors }
  | { status: "confirming"; fields: PlanFormInput; validated: ValidatedPlan }
  | { status: "submitting"; fields: PlanFormInput; validated: ValidatedPlan }
  | { status: "error"; fields: PlanFormInput; message: string };

/**
 * Editing an active plan is a replacement: `create_payment_plan`
 * deactivates the current plan and creates the new one atomically. So the
 * form never saves on its own -- "Review changes" leads to an explicit
 * "this will replace the current plan" confirmation first.
 */
export function ReplacePlanForm({
  memberId,
  plan,
  onDone,
  onCancel,
}: {
  memberId: string;
  plan: PaymentPlanRow;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [state, setState] = useState<ReplaceState>({
    status: "editing",
    fields: planFormValuesFromPlan(plan),
    errors: {},
  });
  const confirmRef = useRef<HTMLButtonElement>(null);
  const fields = state.fields;

  useEffect(() => {
    if (state.status === "confirming") confirmRef.current?.focus();
  }, [state.status]);

  function updateField(patch: Partial<PlanFormInput>) {
    if (state.status !== "editing" && state.status !== "error") return;
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
    if (state.status !== "confirming") return;
    const { validated } = state;
    setState({ status: "submitting", fields, validated });

    const failure = await createPlan(memberId, validated);
    if (failure !== null) {
      setState({ status: "error", fields, message: failure });
      return;
    }
    onDone();
  }

  const submitting = state.status === "submitting";
  const locked = state.status === "confirming" || submitting;

  return (
    <div className="flex flex-col gap-3 rounded-control border border-accent/40 bg-accent-soft/40 p-3">
      <h3 className="text-head">Replace plan</h3>
      <form className="flex flex-col gap-3" onSubmit={handleValidate}>
        <PlanFieldset
          idPrefix="replace"
          fields={fields}
          errors={state.status === "editing" ? state.errors : {}}
          disabled={locked}
          onChange={updateField}
        />

        {state.status === "error" && (
          <p role="alert" className="text-label text-danger">
            Could not save this plan: {state.message}
          </p>
        )}

        {state.status === "confirming" || submitting ? (
          <div className="flex flex-col gap-2 rounded-control border border-danger/60 bg-danger-soft p-3">
            <p role="alert" className="text-label font-semibold text-danger">
              This will replace the current plan of {formatCents(plan.minimumCents)}/month due on
              day {plan.dueDay} -- the old plan will be deactivated.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                ref={confirmRef}
                size="sm"
                variant="danger"
                loading={submitting}
                onClick={() => void handleConfirm()}
              >
                Confirm replace
              </Button>
              <Button size="sm" disabled={submitting} onClick={onCancel}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" variant="primary">
              Review changes
            </Button>
            <Button size="sm" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        )}
      </form>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Deactivate                                                           */
/* ------------------------------------------------------------------ */

type DeactivateState =
  | { status: "confirming" }
  | { status: "submitting" }
  | { status: "error"; message: string };

/**
 * Deactivating takes two steps so one accidental tap cannot do it. The
 * caller shows the "Deactivate plan" button and mounts this to confirm.
 */
export function DeactivatePlanConfirm({
  planId,
  onDone,
  onCancel,
}: {
  planId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [state, setState] = useState<DeactivateState>({ status: "confirming" });
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  async function handleConfirm() {
    setState({ status: "submitting" });
    try {
      const { error } = await supabase.rpc("deactivate_payment_plan", { p_plan_id: planId });
      if (error) {
        setState({ status: "error", message: error.message });
        return;
      }
      onDone();
    } catch (caught) {
      setState({ status: "error", message: networkMessage(caught) });
    }
  }

  const submitting = state.status === "submitting";

  return (
    <div className="flex flex-col gap-2 rounded-control border border-danger/60 bg-danger-soft p-3">
      <p className="text-label font-semibold text-danger">
        Deactivate this plan? The child will have no active plan afterward.
      </p>
      {state.status === "error" && (
        <p role="alert" className="text-label text-danger">
          Could not deactivate this plan: {state.message}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          ref={confirmRef}
          size="sm"
          variant="danger"
          loading={submitting}
          onClick={() => void handleConfirm()}
        >
          {submitting ? "Deactivating…" : "Confirm deactivate"}
        </Button>
        <Button size="sm" disabled={submitting} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Fields                                                               */
/* ------------------------------------------------------------------ */

/** The four plan fields, shared by the create and replace forms. */
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
    <div className="grid gap-3 min-[600px]:grid-cols-2">
      <Field
        id={`${idPrefix}-amount`}
        label="Minimum amount"
        type="text"
        inputMode="decimal"
        placeholder="25.00"
        value={fields.minimumAmountInput}
        disabled={disabled}
        error={errors.minimumAmount}
        onChange={(event) => onChange({ minimumAmountInput: event.target.value })}
      />
      <Field
        id={`${idPrefix}-due-day`}
        label="Due day (1-28)"
        type="number"
        min={1}
        max={28}
        value={fields.dueDayInput}
        disabled={disabled}
        error={errors.dueDay}
        onChange={(event) => onChange({ dueDayInput: event.target.value })}
      />
      <Field
        id={`${idPrefix}-starts-on`}
        label="Start date"
        type="date"
        value={fields.startsOn}
        disabled={disabled}
        error={errors.startsOn}
        onChange={(event) => onChange({ startsOn: event.target.value })}
      />
      <Field
        id={`${idPrefix}-ends-on`}
        label="End date (optional)"
        type="date"
        value={fields.endsOn}
        disabled={disabled}
        error={errors.endsOn}
        onChange={(event) => onChange({ endsOn: event.target.value })}
      />
    </div>
  );
}
