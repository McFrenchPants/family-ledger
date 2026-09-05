import { Navigate, useParams } from "react-router-dom";

import { useMembership } from "../features/auth/membership-context";
import type { Membership } from "../features/auth/membership-context";
import type { HistoryTransaction } from "../features/ledger/history";
import { useHistory } from "../features/ledger/useHistory";
import { formatCents } from "../lib/currency";

const TYPE_LABELS: Record<string, string> = {
  expense: "Expense",
  payment: "Payment",
  adjustment: "Adjustment",
};

function typeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type;
}

/**
 * `/child/:memberId/history` (S2.7). Reachable from both a Parent (drilling
 * into a child's row on `ParentDashboardPage`) and a Child (their own
 * history), so like `AddExpensePage` this is not wrapped in `RequireRole` --
 * there is no single role to require -- and instead handles `useMembership()`
 * loading/signed-out/error/no-membership states directly, mirroring
 * `AddExpensePage`'s pattern.
 *
 * None of this is a security control: `ledger_transactions_select_self` /
 * `_select_parent` RLS (P1.2) independently restrict which rows the query in
 * `useHistory` can ever return for the caller's actual role. If `:memberId`
 * does not resolve to a readable row for this caller (wrong household, a
 * Child requesting a sibling with no access, a nonexistent id), Postgres
 * returns zero rows rather than an error -- rendered below as a plain
 * "no history to show" empty state, not a crash or a redirect loop.
 */
export function HistoryPage() {
  const membership = useMembership();
  const { memberId } = useParams<{ memberId: string }>();

  switch (membership.status) {
    case "loading":
      return (
        <p role="status" className="text-label text-ink-subtle">
          Loading your account…
        </p>
      );

    case "signed-out":
      return <Navigate to="/sign-in" replace />;

    case "error":
      return (
        <div role="alert" className="flex flex-col items-start gap-2">
          <p className="text-label text-owed">
            Could not load your account: {membership.message}
          </p>
          <button
            type="button"
            onClick={membership.retry}
            className="min-h-touch rounded-card border border-surface-border px-3 text-label text-ink-muted"
          >
            Retry
          </button>
        </div>
      );

    case "no-membership":
      return (
        <p role="alert" className="text-label text-owed">
          Your account is not linked to a household yet. Ask a parent in your household to invite
          you.
        </p>
      );

    case "loaded":
      if (!memberId) {
        // Unreachable via the registered route (which always supplies the
        // param), but keeps this exhaustive without a non-null assertion.
        return <p className="text-label text-ink-subtle">No history to show.</p>;
      }
      return <History membership={membership.membership} memberId={memberId} />;
  }
}

function History({ membership, memberId }: { membership: Membership; memberId: string }) {
  const history = useHistory(memberId);
  const isOwnHistory = membership.memberId === memberId;

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-title font-semibold">{isOwnHistory ? "Your History" : "History"}</h2>

      {history.status === "loading" && (
        <p role="status" className="text-label text-ink-subtle">
          Loading history…
        </p>
      )}

      {history.status === "error" && (
        <div role="alert" className="flex flex-col items-start gap-2">
          <p className="text-label text-owed">Could not load history: {history.message}</p>
          <button
            type="button"
            onClick={history.retry}
            className="min-h-touch rounded-card border border-surface-border px-3 text-label text-ink-muted"
          >
            Retry
          </button>
        </div>
      )}

      {history.status === "loaded" && (
        <>
          {history.transactions.length === 0 ? (
            <p className="text-label text-ink-subtle">No history to show.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {history.transactions.map((transaction) => (
                <HistoryRow key={transaction.id} transaction={transaction} />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function HistoryRow({ transaction }: { transaction: HistoryTransaction }) {
  const sign = transaction.amountCents > 0 ? "+" : "";

  return (
    <li
      className={`flex flex-col gap-1 rounded-card border border-surface-border px-4 py-3 ${
        transaction.isVoided ? "bg-surface-sunken" : ""
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-label text-ink-subtle">{typeLabel(transaction.type)}</span>
        <span className="text-label text-ink-subtle">{transaction.occurredOn}</span>
      </div>

      <div className="flex items-center justify-between gap-4">
        <span className="text-body font-medium">
          {transaction.description}
          {transaction.categoryName && (
            <span className="ml-2 text-label text-ink-subtle">{transaction.categoryName}</span>
          )}
        </span>
        <span
          className={`text-body ${
            transaction.isVoided ? "text-ink-subtle line-through" : "text-ink-muted"
          }`}
        >
          {sign}
          {formatCents(transaction.amountCents)}
        </span>
      </div>

      <div className="flex items-center justify-between gap-4">
        <span className="text-label text-ink-subtle">Recorded by {transaction.createdByName}</span>

        {transaction.isVoided && (
          <span className="rounded-card bg-owed/10 px-2 py-0.5 text-label font-medium text-owed">
            Voided{transaction.voidedByName ? ` by ${transaction.voidedByName}` : ""}
          </span>
        )}
      </div>

      {transaction.isVoided && transaction.voidReason && (
        <p className="text-label text-ink-subtle">Reason: {transaction.voidReason}</p>
      )}

      {/*
        Per-row action area reserved for S2.6's void button (a Parent voiding
        an active, i.e. non-`isVoided`, entry). S2.6 is a separate,
        not-yet-started task -- intentionally not implemented here.
      */}
    </li>
  );
}
