import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { useMembership } from "../features/auth/membership-context";
import { toHouseholdBackupJson } from "../features/backup/household-backup";
import { useHouseholdBackup } from "../features/backup/useHouseholdBackup";
import { toLedgerCsv } from "../features/ledger/ledger-export";
import { LoadError } from "../features/family/FamilyParts";
import { useLedgerExport } from "../features/ledger/useLedgerExport";
import { SubPageHeader } from "../features/settings/SettingsParts";
import { todayInZone } from "../lib/dates";

/**
 * `/settings/export` (S6.1 + S6.2): lets a signed-in Parent download their household's
 * full `ledger_transactions` history as a CSV file, or a complete JSON
 * snapshot of the whole household (settings, members, transactions, payment
 * plans/periods, categories, and audit history) for backup/re-import.
 *
 * Parent-only like the other Parent settings pages: `router.tsx` wraps this page in
 * `RequireRole role="parent"`, so this component can assume
 * `useMembership()` is already `{status: "loaded", ..., role: "parent"}` by
 * the time it renders (see `ParentDashboardPage`'s identical assumption).
 * That guard is routing convenience, not the security control -- a Child who
 * reached this route anyway would still only be able to read what each
 * table's own Parent-scoped SELECT policy returns for *their own*
 * membership (zero rows in most cases, since these are Parent-only reads),
 * so a Child fetch here returns nothing useful rather than leaking anything.
 * This page adds no new database writes.
 *
 * Kept as its own small route (linked from Settings' "Export & backup") rather
 * than folded into Settings itself -- S6.2's JSON backup button sits next to
 * S6.1's CSV button here without reworking either.
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
  const backupState = useHouseholdBackup(householdId);

  function handleDownloadCsv() {
    if (state.status !== "loaded") {
      return;
    }

    const csv = toLedgerCsv(state.transactions);
    const filename = `family-ledger-export-${todayInZone(state.timezone)}.csv`;
    downloadTextFile(filename, csv, "text/csv;charset=utf-8;");
  }

  function handleDownloadJsonBackup() {
    if (backupState.status !== "loaded") {
      return;
    }

    const json = toHouseholdBackupJson(backupState.snapshot);
    // Full ISO timestamp (colons/dots stripped for filesystem safety), not
    // just `todayInZone` -- a household backup, unlike the once-a-day-ish CSV
    // export, is reasonable to take more than once in a day, and a
    // date-only filename would let a second same-day backup silently
    // overwrite the first in the downloads folder. `exportedAt` inside the
    // JSON itself already carries this same instant for anything that reads
    // the file's contents rather than its name.
    const filenameStamp = backupState.snapshot.exportedAt.replace(/[:.]/g, "-");
    const filename = `family-ledger-backup-${filenameStamp}.json`;
    downloadTextFile(filename, json, "application/json;charset=utf-8;");
  }

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4">
      <SubPageHeader
        title="Export & backup"
        intro="Keep your own copy. Nothing is deleted from the app."
      />

      <Card as="section" aria-labelledby="export-csv-heading" className="flex flex-col gap-3">
        <h2 id="export-csv-heading" className="text-head">
          Ledger spreadsheet (CSV)
        </h2>

        {state.status === "loading" && (
          <p role="status" className="text-label text-subtle">
            Loading transactions…
          </p>
        )}

        {state.status === "error" && (
          <LoadError
            message={`Could not load transactions: ${state.message}`}
            onRetry={state.retry}
          />
        )}

        {state.status === "loaded" && (
          <>
            <p className="text-label text-muted">
              {state.transactions.length === 0
                ? "No transactions to export yet."
                : `${state.transactions.length} transaction${state.transactions.length === 1 ? "" : "s"} ready to export.`}
            </p>
            <Button
              variant="primary"
              icon="file"
              onClick={handleDownloadCsv}
              disabled={state.transactions.length === 0}
              className="self-start"
            >
              Download CSV
            </Button>
          </>
        )}
      </Card>

      <Card as="section" aria-labelledby="export-backup-heading" className="flex flex-col gap-3">
        <h2 id="export-backup-heading" className="text-head">
          Full household backup (JSON)
        </h2>

        {backupState.status === "loading" && (
          <p role="status" className="text-label text-subtle">
            Preparing backup…
          </p>
        )}

        {backupState.status === "error" && (
          <LoadError
            message={`Could not prepare backup: ${backupState.message}`}
            onRetry={backupState.retry}
          />
        )}

        {backupState.status === "loaded" && (
          <>
            <p className="text-label text-muted">
              A complete JSON snapshot of this household&apos;s settings, members, ledger
              transactions, payment plans and periods, categories, and audit history -- suitable
              for backup or re-import, not for reading.
            </p>
            <Button
              variant="primary"
              icon="download"
              onClick={handleDownloadJsonBackup}
              className="self-start"
            >
              Download JSON Backup
            </Button>
          </>
        )}
      </Card>
    </div>
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
