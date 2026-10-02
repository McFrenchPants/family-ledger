import { Link, useSearchParams } from "react-router-dom";

import { EmptyState } from "../components/ui/EmptyState";
import { MembershipGate } from "../features/auth/MembershipGate";
import { useHouseholdBalances } from "../features/ledger/useHouseholdBalances";
import { HistoryPage } from "./HistoryPage";

/**
 * `/activity`. A Child always sees their own history -- any `?child=` in the
 * URL is ignored, so a Child cannot even ask the UI for a sibling's history
 * (and RLS would return nothing for one anyway). A Parent sees the history of
 * the child named by `?child=<memberId>`, or, without one, a chooser listing
 * the household's children.
 *
 * Routing convenience only: which ledger rows any caller can read is enforced
 * by `ledger_transactions` RLS, not by this component.
 */
export function ActivityPage() {
  const [searchParams] = useSearchParams();
  const requestedChild = searchParams.get("child");

  return (
    <MembershipGate>
      {(membership) => {
        if (membership.role === "child") {
          return <HistoryPage key={membership.memberId} memberId={membership.memberId} />;
        }
        if (requestedChild) {
          return <HistoryPage key={requestedChild} memberId={requestedChild} />;
        }
        return <ChildChooser householdId={membership.householdId} />;
      }}
    </MembershipGate>
  );
}

/**
 * Interim Parent view of `/activity` with no child chosen: a plain list of
 * the household's children, each linking to their history.
 */
function ChildChooser({ householdId }: { householdId: string }) {
  const balances = useHouseholdBalances(householdId);

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-title font-semibold">Activity</h2>

      {balances.status === "loading" && (
        <p role="status" className="text-label text-ink-subtle">
          Loading children…
        </p>
      )}

      {balances.status === "error" && (
        <div role="alert" className="flex flex-col items-start gap-2">
          <p className="text-label text-owed">Could not load children: {balances.message}</p>
          <button
            type="button"
            onClick={balances.retry}
            className="min-h-touch rounded-card border border-surface-border px-3 text-label text-ink-muted"
          >
            Retry
          </button>
        </div>
      )}

      {balances.status === "loaded" &&
        (balances.children.length === 0 ? (
          <EmptyState icon="users" title="No children yet">
            Add a child under Family to start tracking their expenses.
          </EmptyState>
        ) : (
          <>
            <p className="text-body text-ink-muted">Choose whose history to see.</p>
            <ul className="flex flex-col gap-2">
              {balances.children.map((child) => (
                <li key={child.memberId}>
                  <Link
                    to={`/activity?child=${encodeURIComponent(child.memberId)}`}
                    className="flex min-h-touch items-center rounded-card border border-surface-border px-4 py-3 text-body font-medium hover:bg-surface-sunken"
                  >
                    {child.name}
                  </Link>
                </li>
              ))}
            </ul>
          </>
        ))}
    </section>
  );
}
