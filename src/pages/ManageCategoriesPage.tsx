import { useState } from "react";
import type { FormEvent } from "react";

import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { Field } from "../components/ui/Field";
import { useMembership } from "../features/auth/membership-context";
import { LoadError } from "../features/family/FamilyParts";
import { useManageCategories } from "../features/ledger/useManageCategories";
import type { ManagedCategory } from "../features/ledger/useManageCategories";
import { ActiveTag, INPUT_CLASS, SubPageHeader } from "../features/settings/SettingsParts";
import { supabase } from "../lib/supabase";

/**
 * `/settings/categories` (C1). Parent-only the same way `/family` is: gated
 * by `RequireRole role="parent"` in `router.tsx`, so this component can
 * assume `useMembership()` is already `{status: "loaded", ..., role:
 * "parent"}` -- see `FamilyPage`'s identical assumption and header
 * comment for why that guard is routing convenience, not the security
 * control. Every write this page makes goes through the existing Parent-only
 * RLS policies on `categories` (see
 * `supabase/migrations/20260904230000_ledger_rls_policies.sql` lines
 * 138-164) as-is; this task adds no migration and no new RLS.
 */
export function ManageCategoriesPage() {
  const membership = useMembership();

  if (membership.status !== "loaded") {
    // Unreachable under RequireRole; satisfies the type checker without
    // duplicating RequireRole's loading/error UI.
    return null;
  }

  return <ManageCategories householdId={membership.membership.householdId} />;
}

function ManageCategories({ householdId }: { householdId: string }) {
  const categoriesState = useManageCategories(householdId);

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4">
      <SubPageHeader title="Categories" />

      {categoriesState.status === "loading" && (
        <p role="status" className="text-label text-subtle">
          Loading categories…
        </p>
      )}

      {categoriesState.status === "error" && (
        <LoadError
          message={`Could not load categories: ${categoriesState.message}`}
          onRetry={categoriesState.retry}
        />
      )}

      {categoriesState.status === "loaded" && (
        <CategoryList categories={categoriesState.categories} refetch={categoriesState.refetch} />
      )}

      <AddCategoryForm
        householdId={householdId}
        onAdded={() => {
          if (categoriesState.status === "loaded") {
            categoriesState.refetch();
          }
        }}
      />
    </div>
  );
}

function CategoryList({
  categories,
  refetch,
}: {
  categories: readonly ManagedCategory[];
  refetch: () => void;
}) {
  if (categories.length === 0) {
    return (
      <Card>
        <EmptyState icon="tag" title="No categories yet">
          Add one below to sort expenses.
        </EmptyState>
      </Card>
    );
  }

  return (
    <Card as="section" aria-label="Categories" className="px-4 py-1">
      <ul>
        {categories.map((category) => (
          <CategoryRow key={category.id} category={category} refetch={refetch} />
        ))}
      </ul>
    </Card>
  );
}

type RowAction = { kind: "none" } | { kind: "rename"; draftName: string };

function CategoryRow({
  category,
  refetch,
}: {
  category: ManagedCategory;
  refetch: () => void;
}) {
  const [action, setAction] = useState<RowAction>({ kind: "none" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isActive = category.active;

  async function handleToggleActive() {
    setBusy(true);
    setError(null);

    const { error: updateError } = await supabase
      .from("categories")
      .update({ active: !isActive })
      .eq("id", category.id);

    setBusy(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    refetch();
  }

  async function handleRenameSubmit(event: FormEvent) {
    event.preventDefault();
    if (action.kind !== "rename") {
      return;
    }

    const trimmed = action.draftName.trim();
    if (trimmed.length === 0) {
      setError("Name can't be empty.");
      return;
    }

    setBusy(true);
    setError(null);

    const { error: updateError } = await supabase
      .from("categories")
      .update({ name: trimmed })
      .eq("id", category.id);

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
      <div className="flex flex-wrap items-center justify-between gap-2">
        {action.kind === "rename" ? (
          <form
            className="flex flex-1 flex-wrap items-center gap-2"
            onSubmit={(event) => void handleRenameSubmit(event)}
          >
            <label htmlFor={`rename-${category.id}`} className="sr-only">
              Name
            </label>
            <input
              id={`rename-${category.id}`}
              type="text"
              value={action.draftName}
              onChange={(event) => setAction({ kind: "rename", draftName: event.target.value })}
              className={`${INPUT_CLASS} min-w-0 flex-1 basis-40`}
            />
            <Button type="submit" size="sm" variant="primary" disabled={busy}>
              Save
            </Button>
            <Button size="sm" onClick={() => setAction({ kind: "none" })}>
              Cancel
            </Button>
          </form>
        ) : (
          <span className="flex min-w-0 flex-col gap-1">
            <span className="break-words font-semibold">{category.name}</span>
            {/* Status is never colour-only: the tag always carries a word and an icon. */}
            <ActiveTag active={isActive} />
          </span>
        )}

        {action.kind !== "rename" && (
          <div className="flex shrink-0 gap-2">
            <Button
              size="sm"
              onClick={() => setAction({ kind: "rename", draftName: category.name })}
            >
              Rename
            </Button>

            <Button size="sm" disabled={busy} onClick={() => void handleToggleActive()}>
              {isActive ? "Deactivate" : "Reactivate"}
            </Button>
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="text-label font-semibold text-danger">
          {error}
        </p>
      )}
    </li>
  );
}

type AddCategoryState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "error"; message: string };

function AddCategoryForm({
  householdId,
  onAdded,
}: {
  householdId: string;
  onAdded: () => void;
}) {
  const [name, setName] = useState("");
  const [sortOrderInput, setSortOrderInput] = useState("");
  const [state, setState] = useState<AddCategoryState>({ status: "idle" });

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    const trimmedName = name.trim();
    if (trimmedName.length === 0) {
      setState({ status: "error", message: "Name is required." });
      return;
    }

    let sortOrder: number | undefined;
    if (sortOrderInput.trim() !== "") {
      const parsed = Number(sortOrderInput);
      if (!Number.isInteger(parsed)) {
        setState({ status: "error", message: "Sort order must be a whole number." });
        return;
      }
      sortOrder = parsed;
    }

    setState({ status: "submitting" });

    const { error } = await supabase.from("categories").insert({
      household_id: householdId,
      name: trimmedName,
      ...(sortOrder === undefined ? {} : { sort_order: sortOrder }),
    });

    if (error) {
      setState({ status: "error", message: error.message });
      return;
    }

    setState({ status: "idle" });
    setName("");
    setSortOrderInput("");
    onAdded();
  }

  return (
    <Card as="section" aria-labelledby="add-category-heading" className="flex flex-col gap-4">
      <h2 id="add-category-heading" className="text-head">
        Add a category
      </h2>

      <form className="flex flex-col gap-4" onSubmit={(event) => void handleSubmit(event)}>
        <Field
          id="new-category-name"
          label="Name"
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />

        <Field
          id="new-category-sort-order"
          label="Sort order (optional)"
          type="number"
          inputMode="numeric"
          value={sortOrderInput}
          onChange={(event) => setSortOrderInput(event.target.value)}
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
          {state.status === "submitting" ? "Adding…" : "Add category"}
        </Button>
      </form>
    </Card>
  );
}
