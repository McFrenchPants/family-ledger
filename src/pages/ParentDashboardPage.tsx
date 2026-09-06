import { Link } from "react-router-dom";

import { useMembership } from "../features/auth/membership-context";
import { useHouseholdBalances } from "../features/ledger/useHouseholdBalances";
import type {
  ChildPaymentProgress,
  PaymentPeriodStatus,
} from "../features/payment-plans/useChildPaymentProgress";
import { useHouseholdPaymentProgress } from "../features/payment-plans/useHouseholdPaymentProgress";
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

  // `useHouseholdPaymentProgress` needs the roster's member ids, which only
  // exist once `balances` has loaded -- but hooks must run unconditionally,
  // so an empty list is passed until then (the hook itself treats an empty
  // list as an immediate, harmless "loaded, nothing to show" state).
  const memberIds =
    balances.status === "loaded" ? balances.children.map((child) => child.memberId) : [];
  const progress = useHouseholdPaymentProgress(householdId, memberIds);

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
            <>
              {progress.status === "error" && (
                <div role="alert" className="flex flex-col items-start gap-2">
                  <p className="text-label text-owed">
                    Could not load payment plan status: {progress.message}
                  </p>
                  <button
                    type="button"
                    onClick={progress.retry}
                    className="min-h-touch rounded-card border border-surface-border px-3 text-label text-ink-muted"
                  >
                    Retry
                  </button>
                </div>
              )}

              <ul className="flex flex-col gap-2">
                {balances.children.map((child) => {
                  const childProgress =
                    progress.status === "loaded"
                      ? (progress.progressByMemberId.get(child.memberId) ?? null)
                      : undefined;

                  return (
                    <li key={child.memberId}>
                      <Link
                        to={`/child/${child.memberId}/history`}
                        className="flex items-center justify-between rounded-card border border-surface-border px-4 py-3 hover:bg-surface-sunken"
                      >
                        <span className="flex flex-col gap-1">
                          <span className="text-body font-medium">{child.name}</span>
                          <PlanStatusChip progress={childProgress} />
                        </span>
                        <span className="text-body text-ink-muted">
                          {formatCents(child.balanceCents)} owed
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </>
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

      {/*
        S6.1: a Parent-only CSV export of the whole household's ledger.
        Placed here (not the top nav, which only carries role-dashboard/
        sign-in links) so it sits alongside this dashboard's other
        Parent-only actions -- discoverable the same way "Manage payment
        plan" is on HistoryPage, and gated the same way: `/export` itself is
        wrapped in `RequireRole role="parent"` in router.tsx, this link is
        just where a Parent finds it.
      */}
      <div className="flex flex-wrap gap-2">
        <Link
          to="/export"
          className="min-h-touch inline-flex w-fit items-center rounded-card border border-surface-border px-3 text-label font-medium text-ink-muted"
        >
          Export ledger (CSV)
        </Link>
        {/*
          M6.4: a Parent-only "Manage members" page (add/archive/restore/
          rename household_members rows). Linked here for the same reason as
          "Export ledger" just above -- `/members` itself is wrapped in
          `RequireRole role="parent"` in router.tsx, this link is just where
          a Parent finds it.
        */}
        <Link
          to="/members"
          className="min-h-touch inline-flex w-fit items-center rounded-card border border-surface-border px-3 text-label font-medium text-ink-muted"
        >
          Manage members
        </Link>
      </div>
    </section>
  );
}

/**
 * Per-status chip styling/labels, matching `ChildDashboardPage.tsx`'s
 * `STATUS_CHIP_CLASSES`/`STATUS_LABELS` exactly (same label text, same
 * status->color mapping) so a Parent and a Child use the same status
 * vocabulary. Kept as a sibling copy here rather than an import -- page
 * files aren't meant to export UI-internals to one another.
 */
const STATUS_CHIP_CLASSES: Record<PaymentPeriodStatus, string> = {
  upcoming: "bg-surface-sunken text-ink-muted",
  due: "bg-accent/10 text-accent",
  partially_paid: "bg-accent/10 text-accent",
  satisfied: "bg-settled/10 text-settled",
  overdue: "bg-owed/10 text-owed",
  waived: "bg-surface-sunken text-ink-muted",
};

const STATUS_LABELS: Record<PaymentPeriodStatus, string> = {
  upcoming: "Upcoming",
  due: "Due",
  partially_paid: "Partially Paid",
  satisfied: "Satisfied",
  overdue: "Overdue",
  waived: "Waived",
};

/** Neutral chip for a child with no active payment plan at all. Distinct
 * both visually and textually from `satisfied` -- "No active plan" never
 * reads as "all caught up", per S3.3's acceptance criteria. */
const NO_PLAN_CHIP_CLASSES = "bg-surface-sunken text-ink-subtle";

/**
 * Renders a child's plan-status chip + due date within their dashboard row.
 *
 * `progress === undefined` means `useHouseholdPaymentProgress` hasn't
 * resolved yet (independent of whether balances have loaded) -- a
 * lightweight per-row loading label, so the balance list is never blocked
 * on plan status. `progress === null` means "loaded, no active plan" -- a
 * distinct neutral state from any real status, including `satisfied`.
 */
function PlanStatusChip({
  progress,
}: {
  progress: ChildPaymentProgress | null | undefined;
}) {
  if (progress === undefined) {
    return <span className="text-label text-ink-subtle">Loading plan status…</span>;
  }

  if (progress === null) {
    return (
      <span className={`inline-flex w-fit rounded-card px-2 py-0.5 text-label font-medium ${NO_PLAN_CHIP_CLASSES}`}>
        No active plan
      </span>
    );
  }

  return (
    <span className="flex items-center gap-2">
      <span
        className={`inline-flex w-fit rounded-card px-2 py-0.5 text-label font-medium ${STATUS_CHIP_CLASSES[progress.periodStatus]}`}
      >
        {STATUS_LABELS[progress.periodStatus]}
      </span>
      <span className="text-label text-ink-subtle">Due {progress.dueDate}</span>
    </span>
  );
}
