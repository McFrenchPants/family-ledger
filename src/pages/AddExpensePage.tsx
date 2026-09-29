import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";

import { buildExpenseMemberSelector, validateExpenseForm } from "../features/ledger/add-expense";
import type { ExpenseFormErrors } from "../features/ledger/add-expense";
import { useAddExpenseFormData } from "../features/ledger/useAddExpenseFormData";
import { useExpensePresets } from "../features/ledger/useExpensePresets";
import type { ExpensePreset } from "../features/ledger/useExpensePresets";
import { useMembership } from "../features/auth/membership-context";
import type { Membership } from "../features/auth/membership-context";
import { supabase } from "../lib/supabase";
import { todayInZone } from "../lib/dates";
import { toDecimalString } from "../lib/currency";

/**
 * `/add-expense` is reachable from both the Parent and Child dashboards
 * (S2.3/S2.4), so unlike `/parent` and `/child` it is not wrapped in
 * `RequireRole` -- there is no single role to require. It still needs *some*
 * signed-in membership before rendering the form, so this component handles
 * `useMembership()`'s states directly, mirroring `RequireRole`'s own
 * loading/signed-out/error/no-membership rendering rather than introducing a
 * second shared guard component for a one-page need.
 *
 * As with every other page in this app, none of this is a security control --
 * `record_expense` independently re-derives and enforces the caller's role
 * and household membership server-side regardless of what this component
 * renders.
 */
export function AddExpensePage() {
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
      return <AddExpenseForm membership={membership.membership} />;
  }
}

function AddExpenseForm({ membership }: { membership: Membership }) {
  const formData = useAddExpenseFormData(membership.householdId);
  const presetsState = useExpensePresets(membership.householdId);
  const navigate = useNavigate();

  const [memberId, setMemberId] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [description, setDescription] = useState("");
  const [note, setNote] = useState("");
  const [occurredOn, setOccurredOn] = useState("");
  const [fieldErrors, setFieldErrors] = useState<ExpenseFormErrors>({});
  const [submitState, setSubmitState] = useState<
    { status: "idle" } | { status: "submitting" } | { status: "error"; message: string }
  >({ status: "idle" });

  const dashboardPath = membership.role === "parent" ? "/parent" : "/child";

  // Seed the member selector's default and today's date once the form data
  // has loaded. Effect-based (not lazy initial state) because both depend on
  // an async fetch; guarded so a `retry` refetch does not clobber choices the
  // user has already made.
  useEffect(() => {
    if (formData.status !== "loaded") {
      return;
    }

    if (memberId === "") {
      const selector = buildExpenseMemberSelector({
        callerRole: membership.role,
        callerMemberId: membership.memberId,
        callerName: membership.name,
        activeMembers: formData.activeMembers,
        childExpenseScope: formData.childExpenseScope,
      });
      if (selector.defaultMemberId) {
        setMemberId(selector.defaultMemberId);
      }
    }

    if (occurredOn === "") {
      setOccurredOn(todayInZone(formData.timezone));
    }
    // Deliberately keyed on formData.status flipping to "loaded", plus the
    // membership identity -- not on formData's fields themselves, so a
    // `retry` re-fetch that returns the exact same shape does not re-run
    // this seeding logic every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.status, membership.role, membership.memberId, membership.name]);

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

  const selector = buildExpenseMemberSelector({
    callerRole: membership.role,
    callerMemberId: membership.memberId,
    callerName: membership.name,
    activeMembers: formData.activeMembers,
    childExpenseScope: formData.childExpenseScope,
  });

  // Prefills the form's amount/category/description from a preset (C4). Never
  // submits -- the Parent or Child can still change any field afterward, the
  // same as manual entry. `amount_cents` -> the decimal-string amount field
  // via `toDecimalString`, the same conversion `ManagePresetsPage.tsx` uses
  // when populating its own edit form from a stored preset.
  function handlePresetClick(preset: ExpensePreset) {
    setAmountInput(toDecimalString(preset.amountCents));
    setCategoryId(preset.categoryId ?? "");
    setDescription(preset.description ?? "");
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    const result = validateExpenseForm({ memberId, amountInput, description, occurredOn });
    if (!result.ok) {
      setFieldErrors(result.errors);
      return;
    }
    setFieldErrors({});
    setSubmitState({ status: "submitting" });

    try {
      const { error } = await supabase.rpc("record_expense", {
        p_member_id: memberId,
        p_amount_cents: result.amountCents,
        p_description: description.trim(),
        p_occurred_on: occurredOn,
        p_category_id: categoryId === "" ? null : categoryId,
        p_note: note.trim() === "" ? null : note.trim(),
      });

      if (error) {
        // A rejected write (e.g. a Child hitting the self_only restriction,
        // or any other server-side check) surfaces here as a retry-able
        // error state. Never queued for later replay -- ADR-007.
        setSubmitState({ status: "error", message: error.message });
        return;
      }

      navigate(dashboardPath);
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
      <h2 className="text-title font-semibold">Add Expense</h2>

      {presetsState.status === "loaded" && presetsState.presets.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-label text-ink-muted">Quick add</span>
          <div className="flex flex-wrap gap-2">
            {presetsState.presets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => handlePresetClick(preset)}
                className="min-h-touch rounded-card border border-surface-border px-3 text-label font-medium text-ink-muted"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <form className="flex flex-col gap-4" onSubmit={(event) => void handleSubmit(event)}>
        <div className="flex flex-col gap-1">
          <label htmlFor="expense-member" className="text-label text-ink-muted">
            For
          </label>
          {selector.locked ? (
            <p id="expense-member" className="text-body font-medium">
              {selector.options[0]?.name ?? membership.name}
            </p>
          ) : (
            <select
              id="expense-member"
              value={memberId}
              onChange={(event) => setMemberId(event.target.value)}
              className="min-h-touch rounded-card border border-surface-border px-3 text-body"
            >
              {selector.options.length === 0 && <option value="">No active children yet</option>}
              {selector.options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          )}
          {fieldErrors.memberId && (
            <p className="text-label text-owed">{fieldErrors.memberId}</p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="expense-amount" className="text-label text-ink-muted">
            Amount
          </label>
          <input
            id="expense-amount"
            type="text"
            inputMode="decimal"
            placeholder="12.34"
            value={amountInput}
            onChange={(event) => setAmountInput(event.target.value)}
            className="min-h-touch rounded-card border border-surface-border px-3 text-body"
          />
          {fieldErrors.amount && <p className="text-label text-owed">{fieldErrors.amount}</p>}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="expense-category" className="text-label text-ink-muted">
            Category (optional)
          </label>
          <select
            id="expense-category"
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
          <label htmlFor="expense-description" className="text-label text-ink-muted">
            Description
          </label>
          <input
            id="expense-description"
            type="text"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className="min-h-touch rounded-card border border-surface-border px-3 text-body"
          />
          {fieldErrors.description && (
            <p className="text-label text-owed">{fieldErrors.description}</p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="expense-note" className="text-label text-ink-muted">
            Note (optional)
          </label>
          <input
            id="expense-note"
            type="text"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className="min-h-touch rounded-card border border-surface-border px-3 text-body"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="expense-date" className="text-label text-ink-muted">
            Date
          </label>
          <input
            id="expense-date"
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
            <p className="text-label text-owed">Could not save this expense: {submitState.message}</p>
          </div>
        )}

        <button
          type="submit"
          disabled={submitState.status === "submitting"}
          className="inline-flex min-h-touch items-center justify-center rounded-card bg-accent px-4 text-body font-medium text-white disabled:opacity-60"
        >
          {submitState.status === "submitting" ? "Saving…" : "Save Expense"}
        </button>
      </form>
    </section>
  );
}
