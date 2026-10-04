import { useState } from "react";

import { Button } from "../../components/ui/Button";
import { supabase } from "../../lib/supabase";
import { TextInput } from "./EntryFormParts";
import type { CategoryOption } from "./add-expense";

/**
 * Parent-only "New category" control under the Add expense category tiles.
 * Creates the category with the same direct insert the Categories settings
 * page uses (Parent-only RLS on `categories` is the real control -- a Child
 * never sees this, and a forged insert is refused by the database), then
 * hands it back so the form can select it. A name that already exists
 * (ignoring case) just selects the existing category instead of duplicating.
 */
export function NewCategoryInline({
  householdId,
  existing,
  onCreated,
}: {
  householdId: string;
  existing: readonly CategoryOption[];
  /** Called with the new (or already-existing) category to select. */
  onCreated: (category: CategoryOption, isNew: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  function close() {
    setOpen(false);
    setName("");
    setError(undefined);
  }

  async function handleAdd() {
    if (saving) return;
    const trimmed = name.trim();
    if (trimmed === "") {
      setError("Enter a name for the category.");
      return;
    }
    const match = existing.find(
      (category) => category.name.toLowerCase() === trimmed.toLowerCase(),
    );
    if (match) {
      onCreated(match, false);
      close();
      return;
    }

    setSaving(true);
    setError(undefined);
    try {
      const { data, error: insertError } = await supabase
        .from("categories")
        .insert({ household_id: householdId, name: trimmed })
        .select("id, name")
        .single<CategoryOption>();
      if (insertError || !data) {
        setError(insertError?.message ?? "Could not add the category.");
        return;
      }
      onCreated({ id: data.id, name: data.name }, true);
      close();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? `Could not reach the ledger service: ${caught.message}`
          : "Could not reach the ledger service.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <div>
        <Button variant="secondary" size="sm" icon="plus" onClick={() => setOpen(true)}>
          New category
        </Button>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col gap-2 rounded-control border border-border bg-surface p-3"
      onKeyDown={(event) => {
        // Enter here adds the category, not the whole expense form it sits in.
        if (event.key === "Enter") {
          event.preventDefault();
          void handleAdd();
        }
      }}
    >
      <TextInput
        id="new-category-inline-name"
        label="New category name"
        value={name}
        onChange={setName}
        error={error}
      />
      <div className="flex gap-2">
        <Button
          variant="primary"
          size="sm"
          loading={saving}
          onClick={() => void handleAdd()}
        >
          Add category
        </Button>
        <Button variant="secondary" size="sm" disabled={saving} onClick={close}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
