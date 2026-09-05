import { Link } from "react-router-dom";

import { useMembership } from "../features/auth/membership-context";
import { useHouseholdBalances } from "../features/ledger/useHouseholdBalances";
import { formatCents } from "../lib/currency";

/**
 * `RequireRole` guarantees `useMembership()` is `{status: "loaded", ...,
 * role: "parent"}` by the time this page renders (see RequireRole.tsx) --
 * only the household id is needed here.
 */
export function ParentDashboardPage() {
  const membership = useMembership();

  if (membership.status !== "loaded") {
    // Unreachable under RequireRole; satisfies the type checker without
    // duplicating RequireRole's loading/error UI.
    return null;
  }

  return <HouseholdOverview householdId={membership.membership.householdId} />;
}

function HouseholdOverview({ householdId }: { householdId: string }) {
  const balances = useHouseholdBalances(householdId);

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-title font-semibold">Family Ledger</h2>
      </div>

      {balances.status === "loading" && (
        <p role="status" className="text-label text-ink-subtle">
          Loading balances…
        </p>
      )}

      {balances.status === "error" && (
        <div role="alert" className="flex flex-col items-start gap-2">
          <p className="text-label text-owed">Could not load balances: {balances.message}</p>
          <button
            type="button"
            onClick={balances.retry}
            className="min-h-touch rounded-card border border-surface-border px-3 text-label text-ink-muted"
          >
            Retry
          </button>
        </div>
      )}

      {balances.status === "loaded" && (
        <>
          {balances.children.length === 0 ? (
            <p className="text-label text-ink-subtle">No active children in this household yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {balances.children.map((child) => (
                <li key={child.memberId}>
                  <Link
                    to={`/child/${child.memberId}/history`}
                    className="flex items-center justify-between rounded-card border border-surface-border px-4 py-3 hover:bg-surface-sunken"
                  >
                    <span className="text-body font-medium">{child.name}</span>
                    <span className="text-body text-ink-muted">
                      {formatCents(child.balanceCents)} owed
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <div className="flex gap-2">
        <Link
          to="/add-expense"
          className="inline-flex min-h-touch flex-1 items-center justify-center rounded-card bg-accent px-4 text-body font-medium text-white"
        >
          + Expense
        </Link>
        <Link
          to="/record-payment"
          className="inline-flex min-h-touch flex-1 items-center justify-center rounded-card border border-surface-border px-4 text-body font-medium text-ink"
        >
          Record Payment
        </Link>
      </div>
    </section>
  );
}
