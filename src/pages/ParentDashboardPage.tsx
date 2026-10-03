import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { AmountText } from "../components/ui/AmountText";
import { Avatar } from "../components/ui/Avatar";
import { Card } from "../components/ui/Card";
import { cx } from "../components/ui/cx";
import { EmptyState } from "../components/ui/EmptyState";
import { Icon } from "../components/ui/Icon";
import { transactionLook } from "../components/ui/transaction-look";
import { LinkButton } from "../components/ui/LinkButton";
import { LoadError } from "../components/ui/LoadError";
import { ProgressBar } from "../components/ui/ProgressBar";
import { StatusChip } from "../components/ui/StatusChip";
import { useMembership } from "../features/auth/membership-context";
import {
  childCardView,
  greeting,
  householdTotal,
  needsAttention,
  orderChildren,
  type AttentionItem,
} from "../features/home/parent-home";
import type { ChildBalance } from "../features/ledger/household-balances";
import type { HouseholdRecentTransaction } from "../features/ledger/recent-activity";
import {
  useHouseholdBalances,
  type HouseholdBalancesState,
} from "../features/ledger/useHouseholdBalances";
import {
  useHouseholdRecentActivity,
  type HouseholdRecentActivityState,
} from "../features/ledger/useHouseholdRecentActivity";
import {
  useHouseholdTimezone,
  type HouseholdTimezoneState,
} from "../features/ledger/useHouseholdTimezone";
import type { ChildPaymentProgress } from "../features/payment-plans/useChildPaymentProgress";
import {
  useHouseholdPaymentProgress,
  type HouseholdPaymentProgressState,
} from "../features/payment-plans/useHouseholdPaymentProgress";
import { DeviceNudge } from "../features/push/DeviceNudge";
import { formatCalendarDate, todayInZone, type CalendarDate } from "../lib/dates";
import { EVERYONE_UP_TO_DATE, NO_ACTIVITY_HINT_PARENT, NO_ACTIVITY_TITLE } from "../lib/messages";

/**
 * `/home` for a Parent. `HomePage` (via `MembershipGate`) guarantees the
 * membership is loaded by the time this renders.
 *
 * Every number here comes from a server read already scoped by RLS
 * (balances, plan status, recent rows); this page only arranges them. The
 * links it shows (Record payment, Expense, Payment) lead to pages whose
 * writes are independently re-checked server-side -- a link is never the
 * control.
 */
export function ParentDashboardPage() {
  const membership = useMembership();

  if (membership.status !== "loaded") {
    // Unreachable under HomePage; satisfies the type checker.
    return null;
  }

  const { householdId, name } = membership.membership;
  return <ParentHome householdId={householdId} name={name} />;
}

type ProgressMap = ReadonlyMap<string, ChildPaymentProgress | null>;

function ParentHome({ householdId, name }: { householdId: string; name: string }) {
  const balances = useHouseholdBalances(householdId);
  const zone = useHouseholdTimezone(householdId);
  const activity = useHouseholdRecentActivity(householdId);

  // Plan progress needs the roster's ids, which exist only once balances
  // have loaded; the hook treats an empty list as "loaded, nothing to show".
  const memberIds =
    balances.status === "loaded" ? balances.children.map((child) => child.memberId) : [];
  const progress = useHouseholdPaymentProgress(householdId, memberIds);

  // "Today" and the time of day are the household's, never the browser's.
  const timezone = zone.status === "loaded" ? zone.timezone : null;
  const today: CalendarDate | null = timezone ? todayInZone(timezone) : null;

  const children = balances.status === "loaded" ? balances.children : null;
  // The progress hook answers "loaded, empty" for the empty pre-roster id
  // list, and keeps that answer for one render after the roster arrives;
  // only a map covering every child counts, so nobody flashes as "No plan".
  const progressMap: ProgressMap | null =
    progress.status === "loaded" &&
    children !== null &&
    children.every((child) => progress.progressByMemberId.has(child.memberId))
      ? progress.progressByMemberId
      : null;

  const attention: AttentionItem[] | null =
    children && progressMap && today ? needsAttention(children, progressMap, today) : null;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between gap-3">
        <div className="flex flex-col">
          {today && (
            <span className="text-label text-subtle">{formatCalendarDate(today, "long")}</span>
          )}
          <h1 className="text-title">{greeting(name, timezone)}</h1>
        </div>
        <Avatar name={name} />
      </header>

      <div
        className={cx(
          "flex flex-col gap-4",
          "min-[900px]:grid min-[900px]:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] min-[900px]:items-start min-[900px]:gap-6",
          "min-[900px]:[grid-template-areas:'total_total'_'attention_recent'_'children_recent']",
        )}
      >
        <div className="min-[900px]:[grid-area:attention]">
          <NeedsAttention
            hasChildren={children !== null && children.length > 0}
            attention={attention}
            progress={progress}
            zone={zone}
          />
        </div>

        {children && children.length > 0 && (
          <div className="min-[900px]:[grid-area:total]">
            <TotalCard roster={children} progressMap={progressMap} />
          </div>
        )}

        <div className="min-[900px]:[grid-area:children]">
          <ChildrenSection balances={balances} progressMap={progressMap} today={today} />
        </div>

        <div className="flex flex-col gap-3 min-[900px]:[grid-area:recent]">
          <RecentActivityCard activity={activity} roster={children} />
        </div>
      </div>

      <DeviceNudge needsAttention={attention === null || attention.length > 0} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Shared bits                                                          */
/* ------------------------------------------------------------------ */

const childParam = (memberId: string) => `?child=${encodeURIComponent(memberId)}`;

/* ------------------------------------------------------------------ */
/* Needs attention                                                      */
/* ------------------------------------------------------------------ */

function NeedsAttention({
  hasChildren,
  attention,
  progress,
  zone,
}: {
  hasChildren: boolean;
  attention: AttentionItem[] | null;
  progress: HouseholdPaymentProgressState;
  zone: HouseholdTimezoneState;
}) {
  // Each read fails on its own: a plan or settings error shows here, while
  // the balances and children below still render.
  if (progress.status === "error") {
    return (
      <LoadError
        message={`Could not load payment plans: ${progress.message}`}
        onRetry={progress.retry}
      />
    );
  }
  if (zone.status === "error") {
    return (
      <LoadError
        message={`Could not load your household settings: ${zone.message}`}
        onRetry={zone.retry}
      />
    );
  }
  if (!hasChildren) return null;
  if (attention === null) {
    return (
      <p role="status" className="text-label text-subtle">
        Checking payment plans…
      </p>
    );
  }
  if (attention.length === 0) {
    return (
      <p data-testid="all-clear" className="flex items-center gap-2 text-body text-ok">
        <Icon name="checkc" />
        {EVERYONE_UP_TO_DATE}
      </p>
    );
  }

  return (
    <section aria-labelledby="attention-heading">
      <h2 id="attention-heading" className="mb-2 flex items-center gap-2 text-head">
        Needs attention
        <span className="inline-flex min-w-[1.5rem] items-center justify-center rounded-full bg-danger-soft px-2 py-0.5 text-label font-semibold text-danger">
          {attention.length}
          <span className="sr-only"> {attention.length === 1 ? "child" : "children"}</span>
        </span>
      </h2>
      <ul className="flex flex-col gap-2.5">
        {attention.map((item) => (
          <AttentionCard key={item.memberId} item={item} />
        ))}
      </ul>
    </section>
  );
}

function AttentionCard({ item }: { item: AttentionItem }) {
  const overdue = item.kind === "overdue";
  return (
    <Card
      as="li"
      data-attention={item.kind}
      className={cx(
        "flex flex-col gap-2.5 border-l-4 px-3.5 py-3",
        overdue ? "border-l-danger" : "border-l-warn",
      )}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 grow">
          <p className="text-body font-semibold">{item.headline}</p>
          <p className="text-label text-muted">{item.detail}</p>
        </div>
        <StatusChip kind={overdue ? "overdue" : "due"} label={item.chipLabel} />
      </div>
      <div className="flex">
        <LinkButton
          to={`/new/payment${childParam(item.memberId)}`}
          icon="check"
          className="flex-1"
        >
          Record payment<span className="sr-only"> for {item.name}</span>
        </LinkButton>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Owed to the family                                                   */
/* ------------------------------------------------------------------ */

function TotalCard({
  roster,
  progressMap,
}: {
  roster: readonly ChildBalance[];
  progressMap: ProgressMap | null;
}) {
  const total = householdTotal(roster, progressMap);
  return (
    <Card as="section" aria-labelledby="total-label">
      <p id="total-label" className="text-label text-subtle">
        Owed to the family
      </p>
      <div className="mt-1">
        <AmountText cents={total.totalCents} variant="hero" srContext="owed to the family" />
      </div>
      <p className="mt-0.5 text-label text-muted">{total.summary}</p>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Children                                                             */
/* ------------------------------------------------------------------ */

function ChildrenSection({
  balances,
  progressMap,
  today,
}: {
  balances: HouseholdBalancesState;
  progressMap: ProgressMap | null;
  today: CalendarDate | null;
}) {
  let body: ReactNode;
  if (balances.status === "loading") {
    body = (
      <p role="status" className="text-label text-subtle">
        Loading balances…
      </p>
    );
  } else if (balances.status === "error") {
    body = (
      <LoadError message={`Could not load balances: ${balances.message}`} onRetry={balances.retry} />
    );
  } else if (balances.children.length === 0) {
    body = (
      <Card>
        <EmptyState
          icon="users"
          title="No children yet"
          action={
            <LinkButton to="/family" icon="users" size="md">
              Add a child in Family
            </LinkButton>
          }
        >
          Once a child is added, their balance and plan show up here.
        </EmptyState>
      </Card>
    );
  } else {
    body = (
      <ul className="flex flex-col gap-3">
        {orderChildren(balances.children, progressMap).map((child) => (
          <ChildCard
            key={child.memberId}
            child={child}
            progress={progressMap ? (progressMap.get(child.memberId) ?? null) : undefined}
            today={today}
          />
        ))}
      </ul>
    );
  }

  return (
    <section aria-labelledby="children-heading">
      <div className="mb-1 flex items-center justify-between">
        <h2 id="children-heading" className="text-head">
          Children
        </h2>
        <Link
          to="/family"
          className="inline-flex min-h-touch items-center rounded-control px-1 text-label font-semibold text-accent-text"
        >
          Manage
        </Link>
      </div>
      {body}
    </section>
  );
}

function ChildCard({
  child,
  progress,
  today,
}: {
  child: ChildBalance;
  progress: ChildPaymentProgress | null | undefined;
  today: CalendarDate | null;
}) {
  const view = childCardView(child.balanceCents, progress, today);
  return (
    <Card as="li" aria-label={child.name} data-testid="child-card">
      <div className="flex items-center gap-3">
        <Avatar name={child.name} />
        <div className="min-w-0 grow">
          <Link
            to={`/family/${encodeURIComponent(child.memberId)}`}
            className="inline-flex min-h-touch items-center text-head text-ink hover:underline"
          >
            {child.name}
          </Link>
          {view.chip && (
            <div>
              <StatusChip kind={view.chip.kind} label={view.chip.label} />
            </div>
          )}
        </div>
        <div className="text-right">
          <AmountText
            cents={child.balanceCents}
            variant="hero"
            srContext="owed"
            className="!text-amount"
          />
          <p className="text-caption text-subtle" aria-hidden="true">
            owed
          </p>
        </div>
      </div>

      {view.progress && (
        <div className="mt-3">
          <div className="flex items-baseline justify-between gap-2 text-label">
            <span>{view.progress.text}</span>
            <span className="text-subtle">{view.progress.dueLabel}</span>
          </div>
          <ProgressBar
            className="mt-1.5"
            value={view.progress.paidCents}
            max={view.progress.minimumCents}
            label={`${child.name}: paid this month`}
            valueText={view.progress.text}
            tone={view.progress.tone}
          />
        </div>
      )}

      <div className="mt-3 flex gap-2">
        <LinkButton
          to={`/new/expense${childParam(child.memberId)}`}
          icon="plus"
          className="flex-1"
        >
          Expense<span className="sr-only"> for {child.name}</span>
        </LinkButton>
        <LinkButton
          to={`/new/payment${childParam(child.memberId)}`}
          icon="check"
          className="flex-1"
          variant={progress?.periodStatus === "overdue" && child.balanceCents > 0 ? "ok" : "secondary"}
        >
          Payment<span className="sr-only"> from {child.name}</span>
        </LinkButton>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Recent activity                                                      */
/* ------------------------------------------------------------------ */

function RecentActivityCard({
  activity,
  roster,
}: {
  activity: HouseholdRecentActivityState;
  roster: readonly ChildBalance[] | null;
}) {
  const nameOf = new Map((roster ?? []).map((child) => [child.memberId, child.name]));

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

      {activity.status === "loaded" && activity.transactions.length === 0 && (
        <EmptyState icon="list" title={NO_ACTIVITY_TITLE}>
          {NO_ACTIVITY_HINT_PARENT}
        </EmptyState>
      )}

      {activity.status === "loaded" && activity.transactions.length > 0 && (
        <ul className="mt-1">
          {activity.transactions.map((transaction) => (
            <ActivityRow
              key={transaction.id}
              transaction={transaction}
              childName={nameOf.get(transaction.memberId) ?? null}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}

function ActivityRow({
  transaction,
  childName,
}: {
  transaction: HouseholdRecentTransaction;
  childName: string | null;
}) {
  const look = transactionLook(transaction.type);
  const detail = transaction.type === "expense" ? transaction.categoryName : look.label;
  const subline = [
    formatCalendarDate(transaction.occurredOn, "short"),
    detail,
    childName,
    transaction.isVoided ? "Voided" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <li
      data-voided={transaction.isVoided ? "true" : undefined}
      className="flex min-h-[60px] items-center gap-3 border-t border-border py-2.5 first:border-t-0"
    >
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
