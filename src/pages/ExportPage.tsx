import { useMembership } from "../features/auth/membership-context";
import { toLedgerCsv } from "../features/ledger/ledger-export";
import { useLedgerExport } from "../features/ledger/useLedgerExport";
import { todayInZone } from "../lib/dates";

/**
 * `/export` (S6.1): lets a signed-in Parent download their household's full
 * `ledger_transactions` history as a CSV file.
 *
 * Parent-only the same way `/parent` is: `router.tsx` wraps this page in
 * `RequireRole role="parent"`, so this component can assume
 * `useMembership()` is already `{status: "loaded", ..., role: "parent"}` by
 * the time it renders (see `ParentDashboardPage`'s identical assumption).
 * That guard is routing convenience, not the security control -- a Child who
 * reached this route anyway would still only be able to read what
 * `ledger_transactions_select_parent` (P1.2) returns for *their own*
 * membership, and that policy requires an active Parent row, so a Child
 * fetch here returns zero rows rather than leaking anything. This page adds
 * no new database writes.
 *
 * Kept as its own small route (linked from `ParentDashboardPage`) rather than
 * folded into the dashboard itself, so a future JSON export (S6.2) can sit
 * next to this CSV button without reworking either.
 */
export function ExportPage() {
  const membership = useMembership();

  if (membership.status !== "loaded") {
    // Unreachable under RequireRole; satisfies the type checker without
    // duplicating RequireRole's loading/error UI.
    return null;
  }

  return <Export householdId={membership.membership.householdId} />;
}

function Export({ householdId }: { householdId: string }) {
  const state = useLedgerExport(householdId);

  function handleDownloadCsv() {
    if (state.status !== "loaded") {
      return;
    }

    const csv = toLedgerCsv(state.transactions);
    const filename = `family-ledger-export-${todayInZone(state.timezone)}.csv`;
    downloadTextFile(filename, csv, "text/csv;charset=utf-8;");
  }

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-title font-semibold">Export Ledger</h2>

      {state.status === "loading" && (
        <p role="status" className="text-label text-ink-subtle">
          Loading transactions…
        </p>
      )}

      {state.status === "error" && (
        <div role="alert" className="flex flex-col items-start gap-2">
          <p className="text-label text-owed">Could not load transactions: {state.message}</p>
          <button
            type="button"
            onClick={state.retry}
            className="min-h-touch rounded-card border border-surface-border px-3 text-label text-ink-muted"
          >
            Retry
          </button>
        </div>
      )}

      {state.status === "loaded" && (
        <>
          <p className="text-label text-ink-subtle">
            {state.transactions.length === 0
              ? "No transactions to export yet."
              : `${state.transactions.length} transaction${state.transactions.length === 1 ? "" : "s"} ready to export.`}
          </p>
          <button
            type="button"
            onClick={handleDownloadCsv}
            disabled={state.transactions.length === 0}
            className="inline-flex min-h-touch w-fit items-center justify-center rounded-card bg-accent px-4 text-body font-medium text-white disabled:opacity-60"
          >
            Download CSV
          </button>
        </>
      )}
    </section>
  );
}

/**
 * Client-side file download: build a `Blob`, point a temporary anchor's
 * `download` attribute at an object URL for it, click it programmatically,
 * then clean up. No server round-trip and no new npm dependency -- this is
 * the standard browser mechanism for "save this string as a file".
 */
function downloadTextFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
