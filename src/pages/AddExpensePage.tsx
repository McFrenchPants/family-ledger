import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";

import { Avatar } from "../components/ui/Avatar";
import { Button } from "../components/ui/Button";
import { ChoiceChips } from "../components/ui/ChoiceChips";
import { Icon } from "../components/ui/Icon";
import { LoadError } from "../components/ui/LoadError";
import { StickyActionBar } from "../components/ui/StickyActionBar";
import {
  buildExpenseMemberSelector,
  validateExpenseForm,
} from "../features/ledger/add-expense";
import type { ExpenseFormErrors } from "../features/ledger/add-expense";
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
  addExpenseButtonLabel,
  categoryIcon,
  expensePreviewLine,
  typedAmountCents,
} from "../features/ledger/entry-preview";
import type { EntryPerson } from "../features/ledger/entry-preview";
import { NewCategoryInline } from "../features/ledger/NewCategoryInline";
import type { CategoryOption } from "../features/ledger/add-expense";
import { useAddExpenseFormData } from "../features/ledger/useAddExpenseFormData";
import { useExpensePresets } from "../features/ledger/useExpensePresets";
import type { ExpensePreset } from "../features/ledger/useExpensePresets";
import { useMemberBalances } from "../features/ledger/useMemberBalances";
import { useMembership } from "../features/auth/membership-context";
import type { Membership } from "../features/auth/membership-context";
import { supabase } from "../lib/supabase";
import { todayInZone } from "../lib/dates";
import { formatCents, toDecimalString } from "../lib/currency";

/**
 * `/new/expense` is reachable by both Parents and Children, so unlike
 * `/new/payment` it is not wrapped in `RequireRole` -- there is no single
 * role to require. It still needs *some* signed-in membership before
 * rendering the form, so this component handles `useMembership()`'s states
 * directly, mirroring `RequireRole`'s own loading/signed-out/error/
 * no-membership rendering.
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
          Your account is not linked to a household yet. Ask a parent in your household to
          invite you.
        </p>
      );

    case "loaded":
      return <AddExpenseForm membership={membership.membership} />;
  }
}

const FIELD_ORDER: ReadonlyArray<keyof ExpenseFormErrors> = [
  "amount",
  "memberId",
  "description",
  "occurredOn",
];

/**
 * Layout per the design spec (5.3): quick-add presets, a big amount, who it
 * is for, category tiles, "What was it?", date chips, an optional note, and
 * a sticky main button that says what will happen ("Add $42.17 to Alex’s
 * balance") with the resulting balance beneath when this caller can see it.
 */
function AddExpenseForm({ membership }: { membership: Membership }) {
  const formData = useAddExpenseFormData(membership.householdId);
  const presetsState = useExpensePresets(membership.householdId);
  // Display-only preview source. A Parent sees every child's balance; a
  // Child only their own -- picking a sibling simply shows no preview.
  const balances = useMemberBalances(membership.householdId);
  const navigate = useNavigate();
  // `?child=<memberId>` (from Parent Home) picks the initial person, but
  // only if it is one of the choices this caller already has; otherwise it
  // is ignored. A convenience, not a control -- record_expense re-checks.
  const [searchParams] = useSearchParams();
  const requestedChild = searchParams.get("child");

  const [memberId, setMemberId] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [categoryId, setCategoryId] = useState("");
  // Categories a Parent created from this form, shown without refetching.
  const [addedCategories, setAddedCategories] = useState<readonly CategoryOption[]>([]);
  const [description, setDescription] = useState("");
  const [note, setNote] = useState("");
  const [occurredOn, setOccurredOn] = useState("");
  const [fieldErrors, setFieldErrors] = useState<ExpenseFormErrors>({});
  const [submitState, setSubmitState] = useState<
    { status: "idle" } | { status: "submitting" } | { status: "error"; message: string }
  >({ status: "idle" });

  const dashboardPath = "/home";

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
      const requested = selector.options.find((option) => option.id === requestedChild);
      if (requested) {
        setMemberId(requested.id);
      } else if (selector.defaultMemberId) {
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

  // Every role gets the same chooser (owner decision 7). The selector offers
  // every active child to a Parent, and to a Child in an `any_member`
  // household; it narrows to the Child alone only for `self_only`, where the
  // server would reject anyone else.
  const selector = buildExpenseMemberSelector({
    callerRole: membership.role,
    callerMemberId: membership.memberId,
    callerName: membership.name,
    activeMembers: formData.activeMembers,
    childExpenseScope: formData.childExpenseScope,
  });

  const today = todayInZone(formData.timezone);
  const amountCents = typedAmountCents(amountInput);
  const chosen = selector.options.find((option) => option.id === memberId);
  const person: EntryPerson | null = chosen
    ? { name: chosen.name, self: chosen.id === membership.memberId }
    : null;
  const balanceCents = chosen ? (balances?.get(chosen.id) ?? null) : null;
  const previewLine = expensePreviewLine(balanceCents, amountCents, person);
  const categories = [
    ...formData.categories,
    ...addedCategories.filter(
      (added) => !formData.categories.some((c) => c.id === added.id),
    ),
  ];
  const isParent = membership.role === "parent";
  const categoryName = (id: string | null) =>
    categories.find((category) => category.id === id)?.name ?? null;

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
    if (submitState.status === "submitting") return;

    const result = validateExpenseForm({
      memberId,
      amountInput,
      description,
      occurredOn,
    });
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

  const submitting = submitState.status === "submitting";
  const errorMessages = FIELD_ORDER.flatMap((key) =>
    fieldErrors[key] ? [fieldErrors[key]] : [],
  );

  return (
    <section
      aria-labelledby="add-expense-heading"
      className="mx-auto flex w-full max-w-[560px] flex-col gap-4"
    >
      <h1 id="add-expense-heading" className="text-title">
        Add expense
      </h1>

      {presetsState.status === "loaded" && presetsState.presets.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-label font-semibold text-muted">Quick add</span>
          <div className="-mx-gutter flex gap-2 overflow-x-auto px-gutter pb-1.5 pt-0.5 [scrollbar-width:none]">
            {presetsState.presets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => handlePresetClick(preset)}
                className="inline-flex min-h-touch shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-border-strong bg-surface px-3.5 text-[0.9375rem] font-medium text-ink transition-colors hover:bg-sunken motion-reduce:transition-none"
              >
                <Icon
                  name={categoryIcon(categoryName(preset.categoryId) ?? preset.label)}
                  size={18}
                />
                {preset.label}{" "}
                <span className="tabular-nums">{formatCents(preset.amountCents)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => void handleSubmit(event)}
      >
        <ErrorSummary messages={errorMessages} />

        <AmountEntry
          id="expense-amount"
          label="Amount"
          value={amountInput}
          onChange={setAmountInput}
          error={fieldErrors.amount}
        />

        <div className="flex flex-col gap-1.5">
          <GroupLabel id="expense-member-label">For</GroupLabel>
          {selector.options.length === 0 ? (
            <p className="text-body text-muted">No active children yet</p>
          ) : (
            <ChoiceChips
              label="For"
              labelledBy="expense-member-label"
              describedBy={fieldErrors.memberId ? "expense-member-error" : undefined}
              value={memberId}
              onValueChange={setMemberId}
              options={selector.options.map((option) => ({
                value: option.id,
                label: option.name,
                content: (
                  <>
                    <Avatar
                      name={option.name}
                      size="sm"
                      className="h-7 w-7 text-caption group-data-[state=on]:bg-accent group-data-[state=on]:text-on-accent"
                    />
                    {option.name}
                  </>
                ),
              }))}
            />
          )}
          <FieldError id="expense-member-error">{fieldErrors.memberId}</FieldError>
        </div>

        {(categories.length > 0 || isParent) && (
          <div className="flex flex-col gap-1.5">
            <GroupLabel id="expense-category-label">
              Category <span className="font-normal text-subtle">(optional)</span>
            </GroupLabel>
            {categories.length > 0 && (
              <ChoiceChips
                label="Category (optional)"
                labelledBy="expense-category-label"
                variant="tile"
                allowEmpty
                value={categoryId}
                onValueChange={setCategoryId}
                options={categories.map((category) => ({
                  value: category.id,
                  label: category.name,
                  content: (
                    <>
                      <Icon name={categoryIcon(category.name)} size={22} />
                      <span className="max-w-full truncate">{category.name}</span>
                    </>
                  ),
                }))}
              />
            )}
            {isParent && (
              <NewCategoryInline
                householdId={membership.householdId}
                existing={categories}
                onCreated={(category, isNew) => {
                  if (isNew) setAddedCategories((current) => [...current, category]);
                  setCategoryId(category.id);
                }}
              />
            )}
          </div>
        )}

        <TextInput
          id="expense-description"
          label="What was it?"
          placeholder="e.g. Gas on the way to work"
          value={description}
          onChange={setDescription}
          error={fieldErrors.description}
        />

        <DateChips
          idPrefix="expense"
          today={today}
          value={occurredOn}
          onChange={setOccurredOn}
          error={fieldErrors.occurredOn}
        />

        <OptionalDetails label="Add a note (optional)">
          <TextInput
            id="expense-note"
            label="Note (optional)"
            value={note}
            onChange={setNote}
          />
        </OptionalDetails>

        {submitState.status === "error" && (
          <SaveError
            message={`Could not save this expense: ${submitState.message}`}
            disabled={submitting}
          />
        )}

        <StickyActionBar>
          <Button
            type="submit"
            variant="primary"
            size="lg"
            fullWidth
            loading={submitting}
            className="whitespace-normal text-center"
          >
            {submitting ? "Saving…" : addExpenseButtonLabel(amountCents, person)}
          </Button>
          {previewLine && (
            <p
              data-testid="expense-balance-preview"
              className="mt-1.5 text-center text-label text-subtle tabular-nums"
            >
              {previewLine}
            </p>
          )}
        </StickyActionBar>
      </form>
    </section>
  );
}
