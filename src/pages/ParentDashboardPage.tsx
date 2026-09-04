import { useState } from "react";

import { ToggleField } from "../components/ToggleField";

export function ParentDashboardPage() {
  const [showSettled, setShowSettled] = useState(false);

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-title font-semibold">Parent dashboard</h2>
        <p className="mt-1 text-body text-ink-muted">
          Placeholder. Balances, expenses, payments and voids will live here once the
          ledger schema exists.
        </p>
      </div>

      <ToggleField
        label="Show settled items"
        description="Local display preference only — no data is written."
        checked={showSettled}
        onCheckedChange={setShowSettled}
      />

      <p className="text-label text-ink-subtle">
        Settled items are {showSettled ? "visible" : "hidden"}.
      </p>
    </section>
  );
}
