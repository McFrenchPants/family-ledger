import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";

import { AmountText } from "../components/ui/AmountText";
import { Avatar } from "../components/ui/Avatar";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { cx } from "../components/ui/cx";
import { EmptyState } from "../components/ui/EmptyState";
import { Icon } from "../components/ui/Icon";
import type { IconName } from "../components/ui/icon-paths";
import { ProgressBar } from "../components/ui/ProgressBar";
import { StatusChip } from "../components/ui/StatusChip";
import { useMembership } from "../features/auth/membership-context";
import {
  dismissNewPayments,
  paidOffMessage,
  paymentReceivedMessage,
  planView,
  takeNewPayments,
  type PlanView,
} from "../features/home/child-home";
import type { RecentTransaction } from "../features/ledger/recent-activity";
import { useHouseholdTimezone } from "../features/ledger/useHouseholdTimezone";
import { useOwnBalance } from "../features/ledger/useOwnBalance";
import { useRecentActivity, type RecentActivityState } from "../features/ledger/useRecentActivity";
import type { ChildPaymentProgress } from "../features/payment-plans/useChildPaymentProgress";
import { useChildPaymentProgress } from "../features/payment-plans/useChildPaymentProgress";
import { DeviceNudge } from "../features/push/DeviceNudge";
import { formatCalendarDate, todayInZone, type CalendarDate } from "../lib/dates";
import {
  ALL_CAUGHT_UP_HINT,
  NO_ACTIVITY_HINT,
  NO_ACTIVITY_TITLE,
  OVERDUE_HOW_TO_PAY,
  PAID_OFF_TITLE,
} from "../lib/messages";

/** How many recent rows Home shows; the full list is one tap away under "See all". */
const HOME_ACTIVITY_ROWS = 5;

/**
 * `/home` for a Child. `HomePage` (via `MembershipGate`) guarantees the
 * membership is loaded by the time this renders.
 *
 * Per PROJECT_REQUIREMENTS.md §11.2 this screen never shows a control that
 * implies the Child can record a payment, adjustment or void, and never
 * shows a sibling's name, balance or activity: every read is scoped to this
 * Child's own member id and, regardless of this component, by RLS. Messages
 * here (overdue, payment received, paid off) are announcements, not buttons.
 */
export function ChildDashboardPage() {
  const membership = useMembership();

  if (membership.status !== "loaded") {
    // Unreachable under HomePage; satisfies the type checker.
    return null;
  }

  const { householdId, memberId, name } = membership.membership;
  return <ChildHome householdId={householdId} memberId={memberId} name={name} />;
}

function ChildHome({
  householdId,
  memberId,
  name,
}: {
  householdId: string;
  memberId: string;
  name: string;
}) {
  const balance = useOwnBalance(householdId, memberId);
  const progress = useChildPaymentProgress(memberId);
  const activity = useRecentActivity(memberId);
  const zone = useHouseholdTimezone(householdId);
  const newPayments = useNewPayments(memberId, activity);

  // "Today" is always the household's calendar day, never the browser's.
  const today: CalendarDate | null =
    zone.status === "loaded" ? todayInZone(zone.timezone) : null;

  const owes = balance.status === "loaded" && balance.balanceCents > 0;
  const overdue =
    owes && progress.status === "loaded" && progress.progress?.periodStatus === "overdue";

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between gap-3">
        <div className="flex flex-col">
          {today && <span className="text-label text-subtle">{formatCalendarDate(today, "long")}</span>}
          <h1 className="text-title">Hi, {name}</h1>
        </div>
        <Avatar name={name} />
      </header>

      <div aria-live="polite">
        {newPayments.payments.length > 0 && (
          <PaymentReceivedCard
            message={paymentReceivedMessage(newPayments.payments, today ?? "") ?? ""}
            onDismiss={newPayments.dismiss}
          />
        )}
      </div>

      <OweCard
        balance={balance}
        progress={progress}
        zone={zone}
        today={today}
        hasHistory={activity.status === "loaded" && activity.transactions.length > 0}
      />

      <Link
        to="/new/expense"
        className="inline-flex min-h-touch-xl w-full items-center justify-center gap-2 rounded-control border border-accent bg-accent px-5 text-head font-semibold text-on-accent"
      >
        <Icon name="plus" />
        Add an expense
      </Link>

      <RecentActivityCard activity={activity} />

      <DeviceNudge needsAttention={progress.status !== "loaded" || overdue} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* New payment since last visit                                         */
/* ------------------------------------------------------------------ */

/**
 * On the first successful activity load of this page load, compare against
 * the ids this member saw last time on this device and record the current
 * ids as seen (`takeNewPayments`). A first-ever visit shows nothing.
 */
function useNewPayments(memberId: string, activity: RecentActivityState) {
  const [payments, setPayments] = useState<RecentTransaction[]>([]);

  useEffect(() => {
    if (activity.status !== "loaded") return;
    setPayments(takeNewPayments(memberId, activity.transactions));
  }, [activity, memberId]);

  return {
    payments,
    dismiss: () => {
      dismissNewPayments(memberId);
      setPayments([]);
    },
  };
}

function PaymentReceivedCard({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div
      data-testid="payment-received"
      className="flex items-center gap-3 rounded-panel border border-transparent bg-ok-soft py-1 pl-4 pr-1 text-ok"
    >
      <Icon name="checkc" />
      <p className="grow py-2 text-body font-semibold">{message}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="grid min-h-touch min-w-touch shrink-0 place-items-center rounded-control"
      >
        <Icon name="x" size={18} />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* You owe                                                              */
/* ------------------------------------------------------------------ */

function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-2">
      <p className="text-label text-danger">{message}</p>
      <Button size="sm" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

function OweCard({
  balance,
  progress,
  zone,
  today,
  hasHistory,
}: {
  balance: ReturnType<typeof useOwnBalance>;
  progress: ReturnType<typeof useChildPaymentProgress>;
  zone: ReturnType<typeof useHouseholdTimezone>;
  today: CalendarDate | null;
  hasHistory: boolean;
}) {
  let body: ReactNode;
  let headerChip: ReactNode = null;

  if (balance.status === "loading") {
    body = (
      <p role="status" className="text-label text-subtle">
        Loading your balance…
      </p>
    );
  } else if (balance.status === "error") {
    body = (
      <LoadError message={`Could not load your balance: ${balance.message}`} onRetry={balance.retry} />
    );
  } else if (balance.balanceCents <= 0) {
    // Nothing owed: no plan details at all. With history it's a "Paid off!"
    // celebration (no motion); a brand-new child gets the teaching hint.
    headerChip = <StatusChip kind="clear" label="All caught up" />;
    body = (
      <>
        <Hero cents={balance.balanceCents} />
        {hasHistory && today ? (
          <div role="status" className="mt-3">
            <h2 className="text-head text-ok">{PAID_OFF_TITLE}</h2>
            <p className="text-label text-muted">{paidOffMessage(today)}</p>
          </div>
        ) : (
          <p className="mt-3 text-label text-muted">{ALL_CAUGHT_UP_HINT}</p>
        )}
      </>
    );
  } else {
    let plan: ReactNode = null;
    if (progress.status === "error") {
      plan = (
        <LoadError
          message={`Could not load your payment plan: ${progress.message}`}
          onRetry={progress.retry}
        />
      );
    } else if (zone.status === "error") {
      plan = (
        <LoadError
          message={`Could not load your household settings: ${zone.message}`}
          onRetry={zone.retry}
        />
      );
    } else if (progress.status === "loading" || today === null) {
      plan = (
        <p role="status" className="text-label text-subtle">
          Loading your payment plan…
        </p>
      );
    } else if (progress.progress) {
      // No active plan (progress === null): nothing plan-related at all.
      const view = planView(progress.progress, today);
      if (view.callout?.tone !== "danger") {
        headerChip = <StatusChip kind={view.chip.kind} label={view.chip.label} />;
      }
      plan = <PlanSection view={view} progress={progress.progress} />;
    }
    body = (
      <>
        <Hero cents={balance.balanceCents} />
        {plan && <div className="mt-3 flex flex-col gap-3">{plan}</div>}
      </>
    );
  }

  return (
    <Card as="section" aria-labelledby="you-owe-label">
      <div className="flex items-center justify-between gap-2">
        <p id="you-owe-label" className="text-label text-subtle">
          You owe
        </p>
        {headerChip}
      </div>
      {body}
    </Card>
  );
}

function Hero({ cents }: { cents: number }) {
  return (
    <div className="mt-1">
      <AmountText cents={cents} variant="hero" srContext="owed" />
    </div>
  );
}

const CALLOUT_CLASSES = {
  danger: "border-l-danger bg-danger-soft",
  warn: "border-l-warn bg-warn-soft",
  ok: "border-l-ok bg-ok-soft",
} as const;

const CALLOUT_TEXT = { danger: "text-danger", warn: "text-warn", ok: "text-ok" } as const;

function PlanSection({ view, progress }: { view: PlanView; progress: ChildPaymentProgress }) {
  const { callout } = view;
  const tone =
    progress.periodStatus === "overdue" ? "danger" : progress.periodStatus === "satisfied" ? "ok" : "accent";

  return (
    <>
      {callout && callout.tone !== "quiet" && (
        <div
          role="status"
          data-callout={callout.tone}
          className={cx(
            "flex items-start gap-3 rounded-control border-l-4 px-3.5 py-3",
            CALLOUT_CLASSES[callout.tone],
          )}
        >
          <div className="grow">
            <p className="text-body font-semibold text-ink">{callout.text}</p>
            {callout.tone === "danger" && (
              <p className={cx("text-label", CALLOUT_TEXT.danger)}>{OVERDUE_HOW_TO_PAY}</p>
            )}
          </div>
          {callout.tone === "danger" && <StatusChip kind={view.chip.kind} label={view.chip.label} />}
        </div>
      )}

      {view.progress && (
        <div>
          <div className="flex items-baseline justify-between gap-2 text-label">
            <span>{view.progress.text}</span>
            <span className="text-subtle">{view.progress.percent}%</span>
          </div>
          <ProgressBar
            className="mt-1.5"
            value={view.progress.paidCents}
            max={view.progress.minimumCents}
            label="Paid this month"
            valueText={view.progress.text}
            tone={tone}
          />
        </div>
      )}

      {view.nextLine && <p className="text-label text-muted">{view.nextLine}</p>}
      {callout?.tone === "quiet" && <p className="text-label text-muted">{callout.text}</p>}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Recent activity                                                      */
/* ------------------------------------------------------------------ */

function RecentActivityCard({ activity }: { activity: RecentActivityState }) {
  if (activity.status === "loaded" && activity.transactions.length === 0) {
    return (
      <Card as="section" aria-labelledby="recent-activity-heading">
        <h2 id="recent-activity-heading" className="sr-only">
          Recent activity
        </h2>
        <EmptyState icon="list" title={NO_ACTIVITY_TITLE}>
          {NO_ACTIVITY_HINT}
        </EmptyState>
      </Card>
    );
  }

  return (
    <Card as="section" aria-labelledby="recent-activity-heading">
      <div className="flex items-center justify-between">
        <h2 id="recent-activity-heading" className="text-head">
          Recent activity
        </h2>
        <Link
          to="/activity"
          className="inline-flex min-h-touch items-center rounded-control px-1 text-label font-semibold text-accent-text"
        >
          See all
        </Link>
      </div>

      {activity.status === "loading" && (
        <p role="status" className="mt-2 text-label text-subtle">
          Loading recent activity…
        </p>
      )}

      {activity.status === "error" && (
        <div className="mt-2">
          <LoadError
            message={`Could not load recent activity: ${activity.message}`}
            onRetry={activity.retry}
          />
        </div>
      )}

      {activity.status === "loaded" && (
        <ul className="mt-1">
          {activity.transactions.slice(0, HOME_ACTIVITY_ROWS).map((transaction) => (
            <ActivityRow key={transaction.id} transaction={transaction} />
          ))}
        </ul>
      )}
    </Card>
  );
}

const TYPE_LOOK: Record<string, { icon: IconName; box: string; label: string }> = {
  payment: { icon: "dollar", box: "bg-ok-soft text-ok", label: "Payment" },
  adjustment: { icon: "edit", box: "bg-accent-soft text-accent-text", label: "Adjustment" },
  expense: { icon: "tag", box: "bg-sunken text-muted", label: "Expense" },
};

function ActivityRow({ transaction }: { transaction: RecentTransaction }) {
  const look = TYPE_LOOK[transaction.type] ?? TYPE_LOOK.expense!;
  const detail = transaction.type === "expense" ? transaction.categoryName : look.label;
  const subline = [
    formatCalendarDate(transaction.occurredOn, "short"),
    detail,
    transaction.isVoided ? "Voided" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <li className="flex min-h-[60px] items-center gap-3 border-t border-border py-2.5 first:border-t-0">
      <span className={cx("grid h-11 w-11 shrink-0 place-items-center rounded-control", look.box)}>
        <Icon name={look.icon} />
      </span>
      <span className="min-w-0 grow">
        <span className="block truncate font-semibold">{transaction.description}</span>
        <span className="block text-label text-subtle">{subline}</span>
      </span>
      <AmountText
        cents={transaction.amountCents}
        kind={transaction.amountCents > 0 ? "expense" : "payment"}
        tone={transaction.isVoided ? "inherit" : transaction.type === "payment" ? "ok" : "ink"}
        srContext={transaction.isVoided ? "voided" : undefined}
        className={cx(transaction.isVoided && "text-subtle line-through")}
      />
    </li>
  );
}
