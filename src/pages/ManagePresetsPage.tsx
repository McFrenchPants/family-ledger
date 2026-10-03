import { useState } from "react";
import type { FormEvent } from "react";

import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { Field } from "../components/ui/Field";
import { useMembership } from "../features/auth/membership-context";
import { LoadError } from "../features/family/FamilyParts";
import { useHouseholdCategories } from "../features/ledger/useHouseholdCategories";
import { useManagePresets } from "../features/ledger/useManagePresets";
import type { ManagedPreset } from "../features/ledger/useManagePresets";
import {
  ActiveTag,
  INPUT_CLASS,
  LABEL_CLASS,
  SubPageHeader,
} from "../features/settings/SettingsParts";
import { formatCents, parsePositiveMoney, toDecimalString } from "../lib/currency";
import { supabase } from "../lib/supabase";

/**
 * `/settings/presets` (C3). Parent-only the same way `/settings/categories`
 * is: gated by `RequireRole role="parent"` in `router.tsx`, so this component
 * can assume `useMembership()` is already `{status: "loaded", ..., role:
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
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4">
      <SubPageHeader title="Quick-add presets" />

      {presetsState.status === "loading" && (
        <p role="status" className="text-label text-subtle">
          Loading presets…
        </p>
      )}

      {presetsState.status === "error" && (
        <LoadError
          message={`Could not load presets: ${presetsState.message}`}
          onRetry={presetsState.retry}
        />
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
    </div>
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
    return (
      <Card>
        <EmptyState icon="plus" title="No presets yet">
          Presets are one-tap expenses, like a school lunch. Add one below.
        </EmptyState>
      </Card>
    );
  }

  return (
    <Card as="section" aria-label="Presets" className="px-4 py-1">
      <ul>
        {presets.map((preset) => (
          <PresetRow
            key={preset.id}
            preset={preset}
            categoryOptions={categoryOptions}
            refetch={refetch}
          />
        ))}
      </ul>
    </Card>
  );
}

/** A labelled <select> of the household's categories, with "No category" first. */
function CategorySelect({
  id,
  value,
  onChange,
  categoryOptions,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  categoryOptions: readonly CategoryOption[];
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className={LABEL_CLASS}>
        Category (optional)
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={INPUT_CLASS}
      >
        <option value="">No category</option>
        {categoryOptions.map((category) => (
          <option key={category.id} value={category.id}>
            {category.name}
          </option>
        ))}
      </select>
    </div>
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
    <li className="flex flex-col gap-2 border-t border-border py-3 first:border-t-0">
      {action.kind === "edit" ? (
        <form className="flex flex-col gap-3" onSubmit={(event) => void handleEditSubmit(event)}>
          <Field
            id={`edit-label-${preset.id}`}
            label="Label"
            type="text"
            value={action.draftLabel}
            onChange={(event) =>
              setAction({ ...action, kind: "edit", draftLabel: event.target.value })
            }
          />

          <Field
            id={`edit-amount-${preset.id}`}
            label="Amount"
            type="text"
            inputMode="decimal"
            value={action.draftAmountInput}
            onChange={(event) =>
              setAction({ ...action, kind: "edit", draftAmountInput: event.target.value })
            }
          />

          <CategorySelect
            id={`edit-category-${preset.id}`}
            value={action.draftCategoryId}
            onChange={(value) => setAction({ ...action, kind: "edit", draftCategoryId: value })}
            categoryOptions={categoryOptions}
          />

          <Field
            id={`edit-description-${preset.id}`}
            label="Description (optional)"
            type="text"
            value={action.draftDescription}
            onChange={(event) =>
              setAction({ ...action, kind: "edit", draftDescription: event.target.value })
            }
          />

          <div className="flex gap-2">
            <Button type="submit" size="sm" variant="primary" disabled={busy}>
              Save
            </Button>
            <Button size="sm" onClick={() => setAction({ kind: "none" })}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex min-w-0 flex-col gap-1">
            <span className="break-words font-semibold">{preset.label}</span>
            <span className="text-label text-muted">
              {formatCents(preset.amountCents)} · {preset.categoryName ?? "No category"}
            </span>
            {preset.description && (
              <span className="text-label text-subtle">{preset.description}</span>
            )}
            {/* Status is never colour-only: the tag always carries a word and an icon. */}
            <ActiveTag active={isActive} />
          </span>

          <div className="flex shrink-0 gap-2">
            <Button
              size="sm"
              onClick={() =>
                setAction({
                  kind: "edit",
                  draftLabel: preset.label,
                  draftAmountInput: toDecimalString(preset.amountCents),
                  draftCategoryId: preset.categoryId ?? "",
                  draftDescription: preset.description ?? "",
                })
              }
            >
              Edit
            </Button>

            <Button size="sm" disabled={busy} onClick={() => void handleToggleActive()}>
              {isActive ? "Deactivate" : "Reactivate"}
            </Button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="text-label font-semibold text-danger">
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
    <Card as="section" aria-labelledby="add-preset-heading" className="flex flex-col gap-4">
      <h2 id="add-preset-heading" className="text-head">
        Add a preset
      </h2>

      <form className="flex flex-col gap-4" onSubmit={(event) => void handleSubmit(event)}>
        <Field
          id="new-preset-label"
          label="Label"
          type="text"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
        />

        <Field
          id="new-preset-amount"
          label="Amount"
          type="text"
          inputMode="decimal"
          placeholder="5.00"
          value={amountInput}
          onChange={(event) => setAmountInput(event.target.value)}
        />

        <CategorySelect
          id="new-preset-category"
          value={categoryId}
          onChange={setCategoryId}
          categoryOptions={categoryOptions}
        />

        <Field
          id="new-preset-description"
          label="Description (optional)"
          type="text"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />

        {state.status === "error" && (
          <p role="alert" className="text-label font-semibold text-danger">
            {state.message}
          </p>
        )}

        <Button
          type="submit"
          variant="primary"
          icon="plus"
          disabled={state.status === "submitting"}
          className="self-start"
        >
          {state.status === "submitting" ? "Adding…" : "Add preset"}
        </Button>
      </form>
    </Card>
  );
}
