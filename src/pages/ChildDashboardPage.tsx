import { Link } from "react-router-dom";

import { useMembership } from "../features/auth/membership-context";
import type { RecentTransaction } from "../features/ledger/recent-activity";
import { useOwnBalance } from "../features/ledger/useOwnBalance";
import { useRecentActivity } from "../features/ledger/useRecentActivity";
import { formatCents } from "../lib/currency";

/**
 * `RequireRole` guarantees `useMembership()` is `{status: "loaded", ...,
 * role: "child"}` by the time this page renders (see RequireRole.tsx) --
 * only the membership id/household id are needed here.
 *
 * Per PROJECT_REQUIREMENTS.md §11.2, this screen never shows a control that
 * implies the Child can record a payment/adjustment/void, and never shows a
 * sibling's name, balance, or activity -- both `useOwnBalance` and
 * `useRecentActivity` are scoped to this Child's own `memberId` only (and
 * doubly enforced server-side by RLS regardless of what this component does).
 */
export function ChildDashboardPage() {
  const membership = useMembership();

  if (membership.status !== "loaded") {
    // Unreachable under RequireRole; satisfies the type checker without
    // duplicating RequireRole's loading/error UI.
    return null;
  }

  return (
    <ChildHome
      householdId={membership.membership.householdId}
      memberId={membership.membership.memberId}
    />
  );
}

function ChildHome({ householdId, memberId }: { householdId: string; memberId: string }) {
  const balance = useOwnBalance(householdId, memberId);
  const activity = useRecentActivity(memberId);

  return (
    <section className="flex flex-col gap-6">
      <div>
        <p className="text-label text-ink-subtle">You Owe</p>

        {balance.status === "loading" && (
          <p role="status" className="text-label text-ink-subtle">
            Loading your balance…
          </p>
        )}

        {balance.status === "error" && (
          <div role="alert" className="flex flex-col items-start gap-2">
            <p className="text-label text-owed">Could not load your balance: {balance.message}</p>
            <button
              type="button"
              onClick={balance.retry}
              className="min-h-touch rounded-card border border-surface-border px-3 text-label text-ink-muted"
            >
              Retry
            </button>
          </div>
        )}

        {balance.status === "loaded" && (
          <p className="text-title font-semibold">{formatCents(balance.balanceCents)}</p>
        )}
      </div>

      <Link
        to="/add-expense"
        className="inline-flex min-h-touch items-center justify-center rounded-card bg-accent px-4 text-body font-medium text-white"
      >
        + Add Expense
      </Link>

      <div>
        <h2 className="text-title font-semibold">Recent Activity</h2>

        {activity.status === "loading" && (
          <p role="status" className="mt-2 text-label text-ink-subtle">
            Loading recent activity…
          </p>
        )}

        {activity.status === "error" && (
          <div role="alert" className="mt-2 flex flex-col items-start gap-2">
            <p className="text-label text-owed">
              Could not load recent activity: {activity.message}
            </p>
            <button
              type="button"
              onClick={activity.retry}
              className="min-h-touch rounded-card border border-surface-border px-3 text-label text-ink-muted"
            >
              Retry
            </button>
          </div>
        )}

        {activity.status === "loaded" && (
          <>
            {activity.transactions.length === 0 ? (
              <p className="mt-2 text-label text-ink-subtle">
                No activity yet. Expenses and payments will show up here.
              </p>
            ) : (
              <ul className="mt-2 flex flex-col gap-2">
                {activity.transactions.map((transaction) => (
                  <RecentActivityRow key={transaction.id} transaction={transaction} />
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function RecentActivityRow({ transaction }: { transaction: RecentTransaction }) {
  const sign = transaction.amountCents > 0 ? "+" : "";

  return (
    <li className="flex items-center justify-between rounded-card border border-surface-border px-4 py-3">
      <span className="text-body font-medium">
        {transaction.description}
        {transaction.categoryName && (
          <span className="ml-2 text-label text-ink-subtle">{transaction.categoryName}</span>
        )}
      </span>
      <span className="text-body text-ink-muted">
        {sign}
        {formatCents(transaction.amountCents)}
      </span>
    </li>
  );
}
