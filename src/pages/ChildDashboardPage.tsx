import { Link } from "react-router-dom";

import { useMembership } from "../features/auth/membership-context";
import type { RecentTransaction } from "../features/ledger/recent-activity";
import { useOwnBalance } from "../features/ledger/useOwnBalance";
import { useRecentActivity } from "../features/ledger/useRecentActivity";
import type {
  ChildPaymentProgress,
  PaymentPeriodStatus,
} from "../features/payment-plans/useChildPaymentProgress";
import { useChildPaymentProgress } from "../features/payment-plans/useChildPaymentProgress";
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
  const progress = useChildPaymentProgress(memberId);
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

      {progress.status === "loading" && (
        <p role="status" className="text-label text-ink-subtle">
          Loading your payment plan…
        </p>
      )}

      {progress.status === "error" && (
        <div role="alert" className="flex flex-col items-start gap-2">
          <p className="text-label text-owed">
            Could not load your payment plan: {progress.message}
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

      {/*
        No active plan: per S3.2's acceptance criteria this section renders
        nothing at all -- no heading, no "$0 due", no placeholder -- rather
        than a blank card that would still visually claim a slot on the page.
      */}
      {progress.status === "loaded" && progress.progress && (
        <PaymentProgressCard progress={progress.progress} />
      )}

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

/**
 * Per-status copy and chip styling for the six `payment_period_status`
 * values. Color is never the only signal -- every status renders a text
 * label inside its chip (matching `HistoryPage.tsx`'s "Voided" badge shape),
 * and the remaining-due/progress copy below is phrased per status rather
 * than one generic template, so `satisfied`/`waived` never read as a
 * confusing "$0.00 remaining" that looks like nothing happened.
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

function remainingDueCopy(progress: ChildPaymentProgress): string {
  switch (progress.periodStatus) {
    case "satisfied":
      return "Fully paid for this period.";
    case "waived":
      return "Waived for this period -- nothing due.";
    case "upcoming":
      return `${formatCents(progress.remainingCents)} will be due.`;
    case "overdue":
      return `${formatCents(progress.remainingCents)} overdue.`;
    case "due":
    case "partially_paid":
    default:
      return `${formatCents(progress.remainingCents)} remaining due.`;
  }
}

function PaymentProgressCard({ progress }: { progress: ChildPaymentProgress }) {
  return (
    <div className="flex flex-col gap-2 rounded-card border border-surface-border px-4 py-3">
      <div className="flex items-center justify-between">
        <h2 className="text-title font-semibold">Payment Plan</h2>
        <span
          className={`rounded-card px-2 py-0.5 text-label font-medium ${STATUS_CHIP_CLASSES[progress.periodStatus]}`}
        >
          {STATUS_LABELS[progress.periodStatus]}
        </span>
      </div>

      <p className="text-body text-ink">{remainingDueCopy(progress)}</p>

      <p className="text-label text-ink-subtle">Due {progress.dueDate}</p>

      <p className="text-label text-ink-subtle">
        {formatCents(progress.paidCents)} of {formatCents(progress.minimumCents)} paid
      </p>
    </div>
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
