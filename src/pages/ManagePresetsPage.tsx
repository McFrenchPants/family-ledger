import { useState } from "react";
import type { FormEvent } from "react";

import { useMembership } from "../features/auth/membership-context";
import { useHouseholdCategories } from "../features/ledger/useHouseholdCategories";
import { useManagePresets } from "../features/ledger/useManagePresets";
import type { ManagedPreset } from "../features/ledger/useManagePresets";
import { formatCents, parsePositiveMoney, toDecimalString } from "../lib/currency";
import { supabase } from "../lib/supabase";

/**
 * `/parent/presets` (C3). Parent-only the same way `/parent/categories` is:
 * gated by `RequireRole role="parent"` in `router.tsx`, so this component can
 * assume `useMembership()` is already `{status: "loaded", ..., role:
 * "parent"}` -- see `ManageCategoriesPage`'s identical assumption and header
 * comment for why that guard is routing convenience, not the security
 * control. Every write this page makes goes through the existing Parent-only
 * RLS policies on `expense_presets` (C2,
 * `supabase/migrations/20260906120000_expense_presets.sql`) as-is; this task
 * adds no migration and no new RLS.
 */
export function ManagePresetsPage() {
  const membership = useMembership();

  if (membership.status !== "loaded") {
    // Unreachable under RequireRole; satisfies the type checker without
    // duplicating RequireRole's loading/error UI.
    return null;
  }

  return <ManagePresets householdId={membership.membership.householdId} />;
}

function ManagePresets({ householdId }: { householdId: string }) {
  const presetsState = useManagePresets(householdId);
  const categoriesState = useHouseholdCategories(householdId);

  const categoryOptions = categoriesState.status === "loaded" ? categoriesState.categories : [];

  return (
    <section className="flex flex-col gap-6">
      <h2 className="text-title font-semibold">Manage Presets</h2>

      {presetsState.status === "loading" && (
        <p role="status" className="text-label text-ink-subtle">
          Loading presets…
        </p>
      )}

      {presetsState.status === "error" && (
        <div role="alert" className="flex flex-col items-start gap-2">
          <p className="text-label text-owed">Could not load presets: {presetsState.message}</p>
          <button
            type="button"
            onClick={presetsState.retry}
            className="min-h-touch rounded-card border border-surface-border px-3 text-label text-ink-muted"
          >
            Retry
          </button>
        </div>
      )}

      {presetsState.status === "loaded" && (
        <PresetList
          presets={presetsState.presets}
          categoryOptions={categoryOptions}
          refetch={presetsState.refetch}
        />
      )}

      <AddPresetForm
        householdId={householdId}
        categoryOptions={categoryOptions}
        onAdded={() => {
          if (presetsState.status === "loaded") {
            presetsState.refetch();
          }
        }}
      />
    </section>
  );
}

type CategoryOption = { readonly id: string; readonly name: string };

function PresetList({
  presets,
  categoryOptions,
  refetch,
}: {
  presets: readonly ManagedPreset[];
  categoryOptions: readonly CategoryOption[];
  refetch: () => void;
}) {
  if (presets.length === 0) {
    return <p className="text-label text-ink-subtle">No presets yet.</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {presets.map((preset) => (
        <PresetRow
          key={preset.id}
          preset={preset}
          categoryOptions={categoryOptions}
          refetch={refetch}
        />
      ))}
    </ul>
  );
}

type RowAction =
  | { kind: "none" }
  | {
      kind: "edit";
      draftLabel: string;
      draftAmountInput: string;
      draftCategoryId: string;
      draftDescription: string;
    };

function PresetRow({
  preset,
  categoryOptions,
  refetch,
}: {
  preset: ManagedPreset;
  categoryOptions: readonly CategoryOption[];
  refetch: () => void;
}) {
  const [action, setAction] = useState<RowAction>({ kind: "none" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isActive = preset.active;

  async function handleToggleActive() {
    setBusy(true);
    setError(null);

    const { error: updateError } = await supabase
      .from("expense_presets")
      .update({ active: !isActive })
      .eq("id", preset.id);

    setBusy(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    refetch();
  }

  async function handleEditSubmit(event: FormEvent) {
    event.preventDefault();
    if (action.kind !== "edit") {
      return;
    }

    const trimmedLabel = action.draftLabel.trim();
    if (trimmedLabel.length === 0) {
      setError("Label can't be empty.");
      return;
    }

    const amountResult = parsePositiveMoney(action.draftAmountInput);
    if (!amountResult.ok) {
      setError(amountResult.message);
      return;
    }
    if (amountResult.cents === 0) {
      setError("Amount must be greater than zero.");
      return;
    }

    setBusy(true);
    setError(null);

    const { error: updateError } = await supabase
      .from("expense_presets")
      .update({
        label: trimmedLabel,
        amount_cents: amountResult.cents,
        category_id: action.draftCategoryId === "" ? null : action.draftCategoryId,
        description: action.draftDescription.trim() === "" ? null : action.draftDescription.trim(),
      })
      .eq("id", preset.id);

    setBusy(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setAction({ kind: "none" });
    refetch();
  }

  return (
    <li className="flex flex-col gap-2 rounded-card border border-surface-border px-4 py-3">
      {action.kind === "edit" ? (
        <form className="flex flex-col gap-3" onSubmit={(event) => void handleEditSubmit(event)}>
          <div className="flex flex-col gap-1">
            <label htmlFor={`edit-label-${preset.id}`} className="text-label text-ink-muted">
              Label
            </label>
            <input
              id={`edit-label-${preset.id}`}
              type="text"
              value={action.draftLabel}
              onChange={(event) =>
                setAction({ ...action, kind: "edit", draftLabel: event.target.value })
              }
              className="min-h-touch rounded-card border border-surface-border px-3 text-body"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor={`edit-amount-${preset.id}`} className="text-label text-ink-muted">
              Amount
            </label>
            <input
              id={`edit-amount-${preset.id}`}
              type="text"
              inputMode="decimal"
              value={action.draftAmountInput}
              onChange={(event) =>
                setAction({ ...action, kind: "edit", draftAmountInput: event.target.value })
              }
              className="min-h-touch rounded-card border border-surface-border px-3 text-body"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor={`edit-category-${preset.id}`} className="text-label text-ink-muted">
              Category (optional)
            </label>
            <select
              id={`edit-category-${preset.id}`}
              value={action.draftCategoryId}
              onChange={(event) =>
                setAction({ ...action, kind: "edit", draftCategoryId: event.target.value })
              }
              className="min-h-touch rounded-card border border-surface-border px-3 text-body"
            >
              <option value="">No category</option>
              {categoryOptions.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor={`edit-description-${preset.id}`} className="text-label text-ink-muted">
              Description (optional)
            </label>
            <input
              id={`edit-description-${preset.id}`}
              type="text"
              value={action.draftDescription}
              onChange={(event) =>
                setAction({ ...action, kind: "edit", draftDescription: event.target.value })
              }
              className="min-h-touch rounded-card border border-surface-border px-3 text-body"
            />
          </div>

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy}
              className="min-h-touch rounded-card bg-accent px-3 text-label font-medium text-white disabled:opacity-60"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setAction({ kind: "none" })}
              className="min-h-touch rounded-card border border-surface-border px-3 text-label text-ink-muted"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <span className="flex flex-col gap-1">
            <span className="text-body font-medium">{preset.label}</span>
            <span className="text-label text-ink-muted">
              {formatCents(preset.amountCents)} · {preset.categoryName ?? "No category"}
            </span>
            {preset.description && (
              <span className="text-label text-ink-subtle">{preset.description}</span>
            )}
            {/*
              Status is never color-only, per this project's §17
              accessibility rule -- see `ManageCategoriesPage`'s identical
              Active/Inactive chip pattern.
            */}
            {isActive ? (
              <span className="inline-flex w-fit rounded-card bg-settled/10 px-2 py-0.5 text-label font-medium text-settled">
                Active
              </span>
            ) : (
              <span className="inline-flex w-fit rounded-card bg-surface-sunken px-2 py-0.5 text-label font-medium text-ink-muted">
                Inactive
              </span>
            )}
          </span>

          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() =>
                setAction({
                  kind: "edit",
                  draftLabel: preset.label,
                  draftAmountInput: toDecimalString(preset.amountCents),
                  draftCategoryId: preset.categoryId ?? "",
                  draftDescription: preset.description ?? "",
                })
              }
              className="min-h-touch rounded-card border border-surface-border px-3 text-label text-ink-muted"
            >
              Edit
            </button>

            <button
              type="button"
              disabled={busy}
              onClick={() => void handleToggleActive()}
              className="min-h-touch rounded-card border border-surface-border px-3 text-label text-ink-muted disabled:opacity-60"
            >
              {isActive ? "Deactivate" : "Reactivate"}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="text-label text-owed">
          {error}
        </p>
      )}
    </li>
  );
}

type AddPresetState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "error"; message: string };

function AddPresetForm({
  householdId,
  categoryOptions,
  onAdded,
}: {
  householdId: string;
  categoryOptions: readonly CategoryOption[];
  onAdded: () => void;
}) {
  const [label, setLabel] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [description, setDescription] = useState("");
  const [state, setState] = useState<AddPresetState>({ status: "idle" });

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    const trimmedLabel = label.trim();
    if (trimmedLabel.length === 0) {
      setState({ status: "error", message: "Label is required." });
      return;
    }

    const amountResult = parsePositiveMoney(amountInput);
    if (!amountResult.ok) {
      setState({ status: "error", message: amountResult.message });
      return;
    }
    if (amountResult.cents === 0) {
      setState({ status: "error", message: "Amount must be greater than zero." });
      return;
    }

    setState({ status: "submitting" });

    const trimmedDescription = description.trim();

    const { error } = await supabase.from("expense_presets").insert({
      household_id: householdId,
      label: trimmedLabel,
      amount_cents: amountResult.cents,
      category_id: categoryId === "" ? null : categoryId,
      description: trimmedDescription === "" ? null : trimmedDescription,
    });

    if (error) {
      setState({ status: "error", message: error.message });
      return;
    }

    setState({ status: "idle" });
    setLabel("");
    setAmountInput("");
    setCategoryId("");
    setDescription("");
    onAdded();
  }

  return (
    <div className="flex flex-col gap-4 rounded-card border border-surface-border p-4">
      <h3 className="text-body font-semibold">Add a preset</h3>

      <form className="flex flex-col gap-3" onSubmit={(event) => void handleSubmit(event)}>
        <div className="flex flex-col gap-1">
          <label htmlFor="new-preset-label" className="text-label text-ink-muted">
            Label
          </label>
          <input
            id="new-preset-label"
            type="text"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            className="min-h-touch rounded-card border border-surface-border px-3 text-body"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="new-preset-amount" className="text-label text-ink-muted">
            Amount
          </label>
          <input
            id="new-preset-amount"
            type="text"
            inputMode="decimal"
            placeholder="5.00"
            value={amountInput}
            onChange={(event) => setAmountInput(event.target.value)}
            className="min-h-touch rounded-card border border-surface-border px-3 text-body"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="new-preset-category" className="text-label text-ink-muted">
            Category (optional)
          </label>
          <select
            id="new-preset-category"
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
            className="min-h-touch rounded-card border border-surface-border px-3 text-body"
          >
            <option value="">No category</option>
            {categoryOptions.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="new-preset-description" className="text-label text-ink-muted">
            Description (optional)
          </label>
          <input
            id="new-preset-description"
            type="text"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className="min-h-touch rounded-card border border-surface-border px-3 text-body"
          />
        </div>

        {state.status === "error" && (
          <p role="alert" className="text-label text-owed">
            {state.message}
          </p>
        )}

        <button
          type="submit"
          disabled={state.status === "submitting"}
          className="inline-flex min-h-touch w-fit items-center justify-center rounded-card bg-accent px-4 text-body font-medium text-white disabled:opacity-60"
        >
          {state.status === "submitting" ? "Adding…" : "Add preset"}
        </button>
      </form>
    </div>
  );
}
