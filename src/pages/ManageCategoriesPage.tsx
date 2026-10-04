import { useState } from "react";
import type { FormEvent } from "react";

import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { Field } from "../components/ui/Field";
import { useMembership } from "../features/auth/membership-context";
import { LoadError } from "../features/family/FamilyParts";
import { useManageCategories } from "../features/ledger/useManageCategories";
import type { ManagedBalance, ManagedCategory } from "../features/ledger/useManageCategories";
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
        <>
          <BalancesSection
            householdId={householdId}
            balances={categoriesState.balances}
            refetch={categoriesState.refetch}
          />
          <CategoryList
            categories={categoriesState.categories}
            balances={categoriesState.balances}
            refetch={categoriesState.refetch}
          />
        </>
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

function BalancesSection({
  householdId,
  balances,
  refetch,
}: {
  householdId: string;
  balances: readonly ManagedBalance[];
  refetch: () => void;
}) {
  // Everyday is always first and fixed in place; only the others can be moved.
  const movable = balances.filter((balance) => !balance.isEveryday);

  return (
    <Card as="section" aria-labelledby="balances-heading" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="balances-heading" className="text-head">
          Balances
        </h2>
        <p className="text-label text-muted">
          Balances split what a child owes into named parts, such as Car or College. Everyday
          holds everything that is not counted toward another balance.
        </p>
      </div>

      <ul>
        {balances.map((balance) => (
          <BalanceRow key={balance.id} balance={balance} movable={movable} refetch={refetch} />
        ))}
      </ul>

      <AddBalanceForm householdId={householdId} onAdded={refetch} />
    </Card>
  );
}

type RpcCall = () => PromiseLike<{ error: { message: string } | null }>;

function BalanceRow({
  balance,
  movable,
  refetch,
}: {
  balance: ManagedBalance;
  movable: readonly ManagedBalance[];
  refetch: () => void;
}) {
  const [action, setAction] = useState<RowAction>({ kind: "none" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const position = movable.findIndex((candidate) => candidate.id === balance.id);

  /** Runs the calls in order, stopping at the first error. True if all succeeded. */
  async function run(calls: readonly RpcCall[]): Promise<boolean> {
    setBusy(true);
    setError(null);

    for (const call of calls) {
      const { error: rpcError } = await call();
      if (rpcError) {
        setBusy(false);
        setError(rpcError.message);
        return false;
      }
    }

    setBusy(false);
    return true;
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

    const ok = await run([
      () => supabase.rpc("update_tracked_balance", { p_id: balance.id, p_name: trimmed }),
    ]);
    if (ok) {
      setAction({ kind: "none" });
      refetch();
    }
  }

  async function handleToggleActive() {
    const ok = await run([
      () => supabase.rpc("update_tracked_balance", { p_id: balance.id, p_active: !balance.active }),
    ]);
    if (ok) {
      refetch();
    }
  }

  async function handleMove(direction: -1 | 1) {
    const target = position + direction;
    if (position < 0 || target < 0 || target >= movable.length) {
      return;
    }

    // Swap the two in the displayed order, then number the whole list 1..n so
    // it works even when sort orders are blank or equal. Only rows whose
    // number actually changes are written.
    const reordered = [...movable];
    [reordered[position], reordered[target]] = [reordered[target], reordered[position]];

    const calls: RpcCall[] = [];
    reordered.forEach((item, index) => {
      if (item.sortOrder !== index + 1) {
        calls.push(() =>
          supabase.rpc("update_tracked_balance", { p_id: item.id, p_sort_order: index + 1 }),
        );
      }
    });

    if (await run(calls)) {
      refetch();
    }
  }

  return (
    <li className="flex flex-col gap-2 border-t border-border py-3 first:border-t-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {action.kind === "rename" ? (
          <form
            className="flex flex-1 flex-wrap items-center gap-2"
            onSubmit={(event) => void handleRenameSubmit(event)}
          >
            <label htmlFor={`rename-balance-${balance.id}`} className="sr-only">
              Name
            </label>
            <input
              id={`rename-balance-${balance.id}`}
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
            <span className="break-words font-semibold">{balance.name}</span>
            {balance.isEveryday ? (
              <span className="text-label text-muted">Default balance</span>
            ) : (
              <ActiveTag active={balance.active} />
            )}
          </span>
        )}

        {action.kind !== "rename" && (
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => setAction({ kind: "rename", draftName: balance.name })}
            >
              Rename
            </Button>

            {!balance.isEveryday && (
              <>
                <Button
                  size="sm"
                  disabled={busy || position <= 0}
                  onClick={() => void handleMove(-1)}
                >
                  Move up
                </Button>
                <Button
                  size="sm"
                  disabled={busy || position < 0 || position >= movable.length - 1}
                  onClick={() => void handleMove(1)}
                >
                  Move down
                </Button>
                <Button size="sm" disabled={busy} onClick={() => void handleToggleActive()}>
                  {balance.active ? "Archive" : "Restore"}
                </Button>
              </>
            )}
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

function AddBalanceForm({
  householdId,
  onAdded,
}: {
  householdId: string;
  onAdded: () => void;
}) {
  const [name, setName] = useState("");
  const [state, setState] = useState<AddCategoryState>({ status: "idle" });

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    const trimmedName = name.trim();
    if (trimmedName.length === 0) {
      setState({ status: "error", message: "Name is required." });
      return;
    }

    setState({ status: "submitting" });

    // No sort order given: the database places the new balance after the others.
    const { error } = await supabase.rpc("create_tracked_balance", {
      p_household_id: householdId,
      p_name: trimmedName,
    });

    if (error) {
      setState({ status: "error", message: error.message });
      return;
    }

    setState({ status: "idle" });
    setName("");
    onAdded();
  }

  return (
    <form
      className="flex flex-col gap-3 border-t border-border pt-4"
      onSubmit={(event) => void handleSubmit(event)}
    >
      <h3 className="text-label font-semibold">Add a balance</h3>

      <Field
        id="new-balance-name"
        label="Balance name"
        type="text"
        value={name}
        onChange={(event) => setName(event.target.value)}
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
        {state.status === "submitting" ? "Adding…" : "Add balance"}
      </Button>
    </form>
  );
}

function CategoryList({
  categories,
  balances,
  refetch,
}: {
  categories: readonly ManagedCategory[];
  balances: readonly ManagedBalance[];
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
    <Card as="section" aria-labelledby="category-list-heading" className="flex flex-col gap-2">
      <h2 id="category-list-heading" className="text-head">
        Categories
      </h2>
      <p className="text-label text-muted">
        Changing where a category counts also moves its past expenses to that balance. Each
        child&rsquo;s total never changes. Payments already recorded stay where they were; a
        Parent can fix that later with &ldquo;move money&rdquo;.
      </p>
      <ul>
        {categories.map((category) => (
          <CategoryRow
            key={category.id}
            category={category}
            balances={balances}
            refetch={refetch}
          />
        ))}
      </ul>
    </Card>
  );
}

type RowAction = { kind: "none" } | { kind: "rename"; draftName: string };

function CategoryRow({
  category,
  balances,
  refetch,
}: {
  category: ManagedCategory;
  balances: readonly ManagedBalance[];
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

  const everyday = balances.find((balance) => balance.isEveryday);
  const currentBalanceId = category.trackedBalanceId ?? everyday?.id ?? "";
  // Active balances, plus the current one even if it has since been archived.
  const pickable = balances.filter(
    (balance) => !balance.isEveryday && (balance.active || balance.id === currentBalanceId),
  );

  async function handleBalanceChange(newId: string) {
    setBusy(true);
    setError(null);

    const { error: rpcError } = await supabase.rpc("set_category_balance", {
      p_category_id: category.id,
      p_tracked_balance_id: newId === everyday?.id ? null : newId,
    });

    setBusy(false);

    if (rpcError) {
      setError(rpcError.message);
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

      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={`balance-${category.id}`} className="text-label text-muted">
          Counts toward
        </label>
        <select
          id={`balance-${category.id}`}
          value={currentBalanceId}
          disabled={busy}
          onChange={(event) => void handleBalanceChange(event.target.value)}
          className={`${INPUT_CLASS} min-w-0 basis-40`}
        >
          {everyday && <option value={everyday.id}>{everyday.name}</option>}
          {pickable.map((balance) => (
            <option key={balance.id} value={balance.id}>
              {balance.active ? balance.name : `${balance.name} (archived)`}
            </option>
          ))}
        </select>
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
