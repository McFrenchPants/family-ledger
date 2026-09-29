import { useState } from "react";
import type { FormEvent } from "react";

import { useMembership } from "../features/auth/membership-context";
import { useManageCategories } from "../features/ledger/useManageCategories";
import type { ManagedCategory } from "../features/ledger/useManageCategories";
import { supabase } from "../lib/supabase";

/**
 * `/parent/categories` (C1). Parent-only the same way `/members` is: gated
 * by `RequireRole role="parent"` in `router.tsx`, so this component can
 * assume `useMembership()` is already `{status: "loaded", ..., role:
 * "parent"}` -- see `ManageMembersPage`'s identical assumption and header
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
    <section className="flex flex-col gap-6">
      <h2 className="text-title font-semibold">Manage Categories</h2>

      {categoriesState.status === "loading" && (
        <p role="status" className="text-label text-ink-subtle">
          Loading categories…
        </p>
      )}

      {categoriesState.status === "error" && (
        <div role="alert" className="flex flex-col items-start gap-2">
          <p className="text-label text-owed">
            Could not load categories: {categoriesState.message}
          </p>
          <button
            type="button"
            onClick={categoriesState.retry}
            className="min-h-touch rounded-card border border-surface-border px-3 text-label text-ink-muted"
          >
            Retry
          </button>
        </div>
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
    </section>
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
    return <p className="text-label text-ink-subtle">No categories yet.</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {categories.map((category) => (
        <CategoryRow key={category.id} category={category} refetch={refetch} />
      ))}
    </ul>
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
    <li className="flex flex-col gap-2 rounded-card border border-surface-border px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        {action.kind === "rename" ? (
          <form
            className="flex flex-1 items-center gap-2"
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
              className="min-h-touch flex-1 rounded-card border border-surface-border px-3 text-body"
            />
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
          </form>
        ) : (
          <span className="flex flex-col gap-1">
            <span className="text-body font-medium">{category.name}</span>
            {/*
              Status is never color-only, per this project's §17
              accessibility rule (see `ManageMembersPage`'s identical
              Active/Archived chip pattern) -- "Inactive" is always plain
              text here, with the badge as a visual accent alongside it.
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
        )}

        {action.kind !== "rename" && (
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => setAction({ kind: "rename", draftName: category.name })}
              className="min-h-touch rounded-card border border-surface-border px-3 text-label text-ink-muted"
            >
              Rename
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
        )}
      </div>

      {error && (
        <p role="alert" className="text-label text-owed">
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
    <div className="flex flex-col gap-4 rounded-card border border-surface-border p-4">
      <h3 className="text-body font-semibold">Add a category</h3>

      <form className="flex flex-col gap-3" onSubmit={(event) => void handleSubmit(event)}>
        <div className="flex flex-col gap-1">
          <label htmlFor="new-category-name" className="text-label text-ink-muted">
            Name
          </label>
          <input
            id="new-category-name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="min-h-touch rounded-card border border-surface-border px-3 text-body"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="new-category-sort-order" className="text-label text-ink-muted">
            Sort order (optional)
          </label>
          <input
            id="new-category-sort-order"
            type="number"
            inputMode="numeric"
            value={sortOrderInput}
            onChange={(event) => setSortOrderInput(event.target.value)}
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
          {state.status === "submitting" ? "Adding…" : "Add category"}
        </button>
      </form>
    </div>
  );
}
