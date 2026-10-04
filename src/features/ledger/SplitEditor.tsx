import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Icon } from "../../components/ui/Icon";
import { INPUT_CLASS } from "../../components/ui/styles";
import { formatCents, toDecimalString } from "../../lib/currency";
import type { Cents } from "../../lib/currency";
import { remainingToAssign } from "./payment-split";
import type { BalanceAfter, SplitBalance, SplitRow, SplitValidation } from "./payment-split";

/**
 * "Where does this go?": one row per balance the payment is split across.
 * Display and editing only -- the parent page owns the rows and the save gate
 * (`validateSplit`); the database enforces every rule again.
 */
export function SplitEditor({
  rows,
  balances,
  amountCents,
  validation,
  isManual,
  onRowsChange,
  onReset,
  after,
  planLines,
  creditNames,
  creditAcknowledged,
  onCreditAcknowledgedChange,
  showPlanEffects,
}: {
  rows: readonly SplitRow[];
  balances: readonly SplitBalance[];
  amountCents: Cents;
  validation: SplitValidation;
  isManual: boolean;
  onRowsChange: (rows: SplitRow[]) => void;
  onReset: () => void;
  after: readonly BalanceAfter[] | null;
  planLines: readonly string[];
  creditNames: readonly string[];
  creditAcknowledged: boolean;
  onCreditAcknowledgedChange: (value: boolean) => void;
  showPlanEffects: boolean;
}) {
  const nameOf = (id: string) => balances.find((balance) => balance.id === id)?.name ?? "Unknown";
  const remaining = remainingToAssign(amountCents, rows);
  const used = new Set(rows.map((row) => row.balanceId));
  const canAdd = rows.length < balances.length;

  function update(key: string, patch: Partial<SplitRow>) {
    onRowsChange(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function addRow() {
    const free = balances.find((balance) => !used.has(balance.id));
    if (!free) return;
    onRowsChange([
      ...rows,
      {
        key: `n${rows.length}-${free.id}`,
        balanceId: free.id,
        amountInput: remaining > 0 ? toDecimalString(remaining) : "",
      },
    ]);
  }

  return (
    <Card as="section" aria-labelledby="split-heading" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="split-heading" className="text-head">
          Where does this go?
        </h2>
        <p className="text-label text-muted">
          Split the {formatCents(amountCents)} across the child&rsquo;s balances. The parts have to
          add up to the full amount.
        </p>
      </div>

      <ul className="flex flex-col gap-2">
        {rows.map((row, index) => (
          <li key={row.key} className="flex items-center gap-2">
            <select
              aria-label={`Balance for part ${index + 1}`}
              value={row.balanceId}
              onChange={(event) => update(row.key, { balanceId: event.target.value })}
              className={`${INPUT_CLASS} min-w-0 flex-1`}
            >
              {balances.map((balance) => (
                <option
                  key={balance.id}
                  value={balance.id}
                  disabled={used.has(balance.id) && balance.id !== row.balanceId}
                >
                  {balance.name}
                </option>
              ))}
            </select>
            <span aria-hidden="true" className="text-subtle">
              $
            </span>
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              aria-label={`Amount for part ${index + 1}`}
              value={row.amountInput}
              onChange={(event) => update(row.key, { amountInput: event.target.value })}
              className={`${INPUT_CLASS} w-28 tabular-nums`}
            />
            {rows.length > 1 && (
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Remove part ${index + 1}`}
                onClick={() => onRowsChange(rows.filter((candidate) => candidate.key !== row.key))}
              >
                <Icon name="x" size={18} />
              </Button>
            )}
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button size="sm" icon="plus" disabled={!canAdd} onClick={addRow}>
          Add another balance
        </Button>
        {isManual && (
          <Button size="sm" variant="ghost" icon="undo" onClick={onReset}>
            Use suggested split
          </Button>
        )}
      </div>

      <p
        role="status"
        data-testid="split-status"
        className={`text-label font-semibold tabular-nums ${validation.ok ? "text-ok" : "text-danger"}`}
      >
        {validation.ok ? "All of it is assigned." : validation.message}
      </p>

      {creditNames.length > 0 && (
        <label className="flex items-start gap-2 rounded-control bg-sunken p-3 text-label text-ink">
          <input
            type="checkbox"
            checked={creditAcknowledged}
            onChange={(event) => onCreditAcknowledgedChange(event.target.checked)}
            className="mt-0.5 h-4 w-4"
          />
          <span>
            I understand this creates a credit on {creditNames.join(" and ")} (more than is owed
            there).
          </span>
        </label>
      )}

      {validation.ok && after && after.length > 0 && (
        <div data-testid="split-after" className="rounded-panel bg-ok-soft p-3 text-label text-ink">
          <h3 className="font-semibold text-ok">After this</h3>
          <ul className="mt-1 list-disc pl-5 tabular-nums">
            {after.map((line) => (
              <li key={line.balanceId}>
                {nameOf(line.balanceId)} goes from {formatCents(line.before)} to{" "}
                {formatCents(line.after)}
                {line.after < 0 ? " (credit)" : ""}
              </li>
            ))}
            {showPlanEffects && planLines.map((line) => <li key={line}>{line}</li>)}
          </ul>
        </div>
      )}
    </Card>
  );
}
