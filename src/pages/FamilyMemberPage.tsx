import { useState } from "react";
import { Link, useParams } from "react-router-dom";

import { AmountText } from "../components/ui/AmountText";
import { Avatar } from "../components/ui/Avatar";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { cx } from "../components/ui/cx";
import { EmptyState } from "../components/ui/EmptyState";
import { Icon } from "../components/ui/Icon";
import { transactionLook } from "../components/ui/transaction-look";
import { ProgressBar } from "../components/ui/ProgressBar";
import { StatusChip } from "../components/ui/StatusChip";
import { useMembership } from "../features/auth/membership-context";
import {
  ArchivedTag,
  LinkButton,
  LoadError,
  TextLink,
} from "../features/family/FamilyParts";
import {
  childParam,
  planChip,
  planProgressView,
  planTermsLine,
  remindersLabel,
  ROLE_LABELS,
} from "../features/family/family-view";
import { MemberManageSection } from "../features/family/MemberManageSection";
import {
  CreatePlanForm,
  DeactivatePlanConfirm,
  ReplacePlanForm,
  type PlanBalanceChoice,
} from "../features/family/PlanControls";
import { useFamilyMembers } from "../features/family/useFamilyMembers";
import { BalanceBreakdownList } from "../features/ledger/BalanceBreakdownList";
import {
  balanceLabeler,
  breakdownLines,
  type BalanceInfo,
  type BreakdownLine,
} from "../features/ledger/balance-breakdown";
import type { RecentTransaction } from "../features/ledger/recent-activity";
import {
  useAllTrackedBalances,
  type AllTrackedBalancesState,
} from "../features/ledger/useAllTrackedBalances";
import { useMemberBreakdown } from "../features/ledger/useBalanceSplitData";
import {
  useHouseholdBalances,
  type HouseholdBalancesState,
} from "../features/ledger/useHouseholdBalances";
import { useHouseholdTimezone } from "../features/ledger/useHouseholdTimezone";
import { useRecentActivity } from "../features/ledger/useRecentActivity";
import type { HouseholdMemberRow } from "../features/members/useHouseholdMembers";
import { useLoginEmails } from "../features/members/useLoginEmails";
import { remindersFor, useMemberPushStatus } from "../features/members/useMemberPushStatus";
import type { PaymentPlanRow } from "../features/payment-plans/payment-plans";
import { planOnBalance } from "../features/payment-plans/plan-selection";
import {
  useChildPaymentProgress,
  type ChildPaymentProgress,
} from "../features/payment-plans/useChildPaymentProgress";
import { usePaymentPlans, type PaymentPlansState } from "../features/payment-plans/usePaymentPlan";
import { formatCents } from "../lib/currency";
import { formatCalendarDate, todayInZone, type CalendarDate } from "../lib/dates";
import { NO_ACTIVITY_TITLE, noActivityForMember } from "../lib/messages";

/** How many recent rows a member's page shows before "See all". */
const RECENT_ON_PAGE = 5;

/**
 * `/family/:memberId` (Parent only, via `RequireRole role="parent"` --
 * routing convenience, not the control). One person: their balance and
 * payment plan if they are an active Child, their recent activity, and the
 * manage actions.
 *
 * The member is looked up in this household's own roster (RLS-scoped), so an
 * id from another household is simply "not found". Every write on this page
 * goes through a security-definer function or Edge Function that re-checks
 * the caller is a Parent; hiding a control is presentation only.
 */
export function FamilyMemberPage() {
  const membership = useMembership();
  const { memberId = "" } = useParams<{ memberId: string }>();

  if (membership.status !== "loaded") {
    // Unreachable under RequireRole; satisfies the type checker.
    return null;
  }

  const { householdId, memberId: selfId } = membership.membership;
  return <MemberPage key={memberId} householdId={householdId} memberId={memberId} selfId={selfId} />;
}

function BackToFamily() {
  return (
    <Link
      to="/family"
      className="-ml-2 inline-flex min-h-touch w-fit items-center gap-1 rounded-control px-2 text-label font-semibold text-accent-text"
    >
      <Icon name="back" />
      Family
    </Link>
  );
}

function MemberPage({
  householdId,
  memberId,
  selfId,
}: {
  householdId: string;
  memberId: string;
  selfId: string;
}) {
  const family = useFamilyMembers(householdId);
  const { emails, refetch: refetchEmails } = useLoginEmails(householdId);
  const push = useMemberPushStatus(householdId);
  const zone = useHouseholdTimezone(householdId);

  const member = family.members?.find((row) => row.id === memberId) ?? null;

  let body;
  if (family.state.status === "error" && family.members === null) {
    body = (
      <LoadError
        message={`Could not load this person: ${family.state.message}`}
        onRetry={family.state.retry}
      />
    );
  } else if (family.members === null) {
    body = (
      <p role="status" className="text-label text-subtle">
        Loading…
      </p>
    );
  } else if (member === null) {
    body = (
      <Card className="flex flex-col items-center gap-2 px-4 py-8 text-center">
        <span className="grid h-12 w-12 place-items-center rounded-full bg-sunken text-muted">
          <Icon name="user" size={24} />
        </span>
        <h1 className="text-head text-ink">We couldn&apos;t find this person</h1>
        <p className="max-w-sm text-body text-muted">
          They may not be part of this household, or the link is wrong.
        </p>
        <TextLink to="/family">Back to Family</TextLink>
      </Card>
    );
  } else {
    const isActiveChild = member.role === "child" && member.status === "active";
    const today: CalendarDate | null =
      zone.status === "loaded" ? todayInZone(zone.timezone) : null;

    body = (
      <>
        <MemberHeader
          member={member}
          isSelf={member.id === selfId}
          reminders={remindersFor(push, member.id)}
        />

        {member.status === "archived" && (
          <p className="text-label text-muted">
            {member.name} is archived and can&apos;t sign in. Their history is kept.{" "}
            <TextLink to={`/activity${childParam(member.id)}`}>See their history</TextLink>
          </p>
        )}

        {isActiveChild && (
          <ChildSections
            householdId={householdId}
            member={member}
            today={today}
            zoneSettled={zone.status !== "loading"}
          />
        )}

        <MemberManageSection
          member={member}
          email={emails[member.id] ?? null}
          onMemberChanged={family.refetch}
          onEmailChanged={refetchEmails}
        />
      </>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[960px] flex-col gap-4">
      <BackToFamily />
      {family.refreshError && (
        <LoadError
          message={`Could not refresh this person's details: ${family.refreshError.message}`}
          onRetry={family.refreshError.retry}
        />
      )}
      {body}
    </div>
  );
}

function MemberHeader({
  member,
  isSelf,
  reminders,
}: {
  member: HouseholdMemberRow;
  isSelf: boolean;
  reminders: boolean | null;
}) {
  const details = [ROLE_LABELS[member.role], isSelf ? "You" : null].filter(Boolean).join(" · ");
  return (
    <header className="flex items-center gap-3">
      <Avatar name={member.name} className="!h-14 !w-14 !text-title" />
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="break-words text-title">{member.name}</h1>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-label text-subtle">
          <span>{details}</span>
          {member.status === "archived" && <ArchivedTag />}
          {reminders !== null && (
            <span className="inline-flex items-center gap-1" data-testid="reminder-line">
              <span aria-hidden="true">·</span>
              <Icon name={reminders ? "bell" : "ban"} size={16} />
              {remindersLabel(reminders)}
            </span>
          )}
        </div>
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* Active child: balance, plan, recent                                  */
/* ------------------------------------------------------------------ */

function ChildSections({
  householdId,
  member,
  today,
  zoneSettled,
}: {
  householdId: string;
  member: HouseholdMemberRow;
  today: CalendarDate | null;
  zoneSettled: boolean;
}) {
  const balances = useHouseholdBalances(householdId);
  const balanceState = useAllTrackedBalances(householdId);
  const { breakdown } = useMemberBreakdown(householdId);
  const plans = usePaymentPlans(member.id);
  const balanceCents =
    balances.status === "loaded"
      ? balances.children.find((child) => child.memberId === member.id)?.balanceCents
      : undefined;

  // The balances worth listing under the total (none for an Everyday-only household).
  const lines =
    balanceState.status === "loaded" && breakdown && plans.status === "loaded"
      ? breakdownLines(
          balanceState.balances,
          breakdown.get(member.id),
          new Set(plans.plans.map((plan) => plan.balanceId)),
        )
      : [];

  // What the child owes on one balance, for that balance's plan chip. Before the
  // breakdown is known, an Everyday-only household's total is its one balance.
  const owedOn = (balanceId: string): number | undefined => {
    if (breakdown) return breakdown.get(member.id)?.get(balanceId) ?? 0;
    return balanceState.status === "loaded" && balanceState.balances.every((b) => b.isEveryday)
      ? balanceCents
      : undefined;
  };

  return (
    <div className="flex flex-col gap-4 min-[900px]:grid min-[900px]:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] min-[900px]:items-start min-[900px]:gap-6">
      <div className="flex flex-col gap-4">
        <BalanceCard
          member={member}
          balances={balances}
          balanceCents={balanceCents}
          lines={balanceCents !== undefined && balanceCents > 0 ? lines : []}
        />
        <PlanCard
          member={member}
          plans={plans}
          balanceState={balanceState}
          owedOn={owedOn}
          today={today}
          zoneSettled={zoneSettled}
        />
      </div>
      <RecentCard member={member} />
    </div>
  );
}

function BalanceCard({
  member,
  balances,
  balanceCents,
  lines,
}: {
  member: HouseholdMemberRow;
  balances: HouseholdBalancesState;
  balanceCents: number | undefined;
  lines: readonly BreakdownLine[];
}) {
  return (
    <Card as="section" aria-labelledby="balance-label">
      <p id="balance-label" className="text-label text-subtle">
        Owes
      </p>
      <div className="mb-3 mt-0.5 min-h-[2.625rem]">
        {balances.status === "loading" && (
          <p role="status" className="text-label text-subtle">
            Loading balance…
          </p>
        )}
        {balances.status === "error" && (
          <LoadError
            message={`Could not load the balance: ${balances.message}`}
            onRetry={balances.retry}
          />
        )}
        {/* Never a $0 stand-in: a balance the server did not return is left out. */}
        {balanceCents !== undefined && (
          <AmountText cents={balanceCents} variant="hero" srContext="owed" />
        )}
        {lines.length > 0 && (
          <BalanceBreakdownList lines={lines} plans={undefined} today={null} childName={member.name} />
        )}
      </div>
      <div className="flex gap-2">
        <LinkButton to={`/new/expense${childParam(member.id)}`} icon="plus" className="flex-1">
          Expense<span className="sr-only"> for {member.name}</span>
        </LinkButton>
        <LinkButton to={`/new/payment${childParam(member.id)}`} icon="check" className="flex-1">
          Payment<span className="sr-only"> from {member.name}</span>
        </LinkButton>
      </div>
    </Card>
  );
}

function PlanCard({
  member,
  plans,
  balanceState,
  owedOn,
  today,
  zoneSettled,
}: {
  member: HouseholdMemberRow;
  plans: PaymentPlansState;
  balanceState: AllTrackedBalancesState;
  owedOn: (balanceId: string) => number | undefined;
  today: CalendarDate | null;
  zoneSettled: boolean;
}) {
  // Bumped after any plan change so the current periods are read again.
  const [progressKey, setProgressKey] = useState(0);
  const [adding, setAdding] = useState(false);

  function handleChanged() {
    setAdding(false);
    setProgressKey((key) => key + 1);
    if (plans.status === "loaded") plans.refetch();
  }

  const infos = balanceState.status === "loaded" ? balanceState.balances : null;
  // The household has balances beyond Everyday: plans are named after theirs.
  const named = infos !== null && infos.some((balance) => !balance.isEveryday);
  const labelOf = balanceLabeler(infos);

  const planned = new Set(plans.status === "loaded" ? plans.plans.map((plan) => plan.balanceId) : []);
  // Active balances with no plan yet, Everyday first: where a plan can still be added.
  const available: PlanBalanceChoice[] = (infos ?? []).filter(
    (balance) => balance.active && !planned.has(balance.id),
  );

  const ready = plans.status === "loaded" && infos !== null;

  return (
    <Card as="section" aria-labelledby="plan-heading" className="flex flex-col gap-3">
      <div className="flex min-h-touch items-center justify-between gap-2">
        <h2 id="plan-heading" className="text-head">
          {named ? "Payment plans" : "Payment plan"}
        </h2>
      </div>

      {!ready && plans.status !== "error" && balanceState.status !== "error" && (
        <p role="status" className="text-label text-subtle">
          Loading payment plan…
        </p>
      )}

      {plans.status === "error" && (
        <LoadError message={`Could not load this plan: ${plans.message}`} onRetry={plans.retry} />
      )}

      {balanceState.status === "error" && (
        <LoadError
          message={`Could not load the balances: ${balanceState.message}`}
          onRetry={balanceState.retry}
        />
      )}

      {ready && plans.plans.length === 0 && (
        // "No active plan" is a first-class state -- not blank, not an error.
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <p className="flex items-center gap-2 font-semibold text-muted">
              <Icon name="dash" />
              No active plan
            </p>
            <p className="text-label text-subtle">
              {member.name} does not have a payment plan. Create one to set a monthly minimum and
              due day.
            </p>
          </div>
          <CreatePlanForm memberId={member.id} balances={available} onSaved={handleChanged} />
        </div>
      )}

      {ready && plans.plans.length > 0 && (
        <PlanList
          key={progressKey}
          member={member}
          plans={orderPlans(plans.plans, infos)}
          named={named}
          labelOf={labelOf}
          owedOn={owedOn}
          today={today}
          zoneSettled={zoneSettled}
          onChanged={handleChanged}
        />
      )}

      {ready && plans.plans.length > 0 && available.length > 0 && (
        <div className="flex flex-col gap-3 border-t border-border pt-3">
          {adding ? (
            <>
              <h3 className="text-head">Add a plan</h3>
              <CreatePlanForm memberId={member.id} balances={available} onSaved={handleChanged} />
              <Button size="sm" className="self-start" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              icon="plus"
              className="self-start"
              onClick={() => setAdding(true)}
            >
              Add a plan for another balance
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

/** Plans in the household's balance order (Everyday first). */
function orderPlans(
  plans: readonly PaymentPlanRow[],
  infos: readonly BalanceInfo[] | null,
): PaymentPlanRow[] {
  const position = (plan: PaymentPlanRow) => {
    const index = (infos ?? []).findIndex((balance) => balance.id === plan.balanceId);
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };
  return [...plans].sort((a, b) => position(a) - position(b));
}

/**
 * Every active plan with this month's progress. The progress read happens
 * once for the child (not per plan); the card re-mounts this after a change.
 */
function PlanList({
  member,
  plans,
  named,
  labelOf,
  owedOn,
  today,
  zoneSettled,
  onChanged,
}: {
  member: HouseholdMemberRow;
  plans: readonly PaymentPlanRow[];
  named: boolean;
  labelOf: (balanceId: string) => string | null;
  owedOn: (balanceId: string) => number | undefined;
  today: CalendarDate | null;
  zoneSettled: boolean;
  onChanged: () => void;
}) {
  const progress = useChildPaymentProgress(member.id);

  return (
    <div className="flex flex-col gap-3">
      {progress.status === "loading" && (
        <p role="status" className="text-label text-subtle">
          Checking this month…
        </p>
      )}
      {progress.status === "error" && (
        <LoadError
          message={`Could not load this month's progress: ${progress.message}`}
          onRetry={progress.retry}
        />
      )}
      {plans.map((plan, index) => (
        <PlanBlock
          key={plan.id}
          member={member}
          plan={plan}
          balanceName={named ? labelOf(plan.balanceId) : null}
          current={
            progress.status === "loaded" ? planOnBalance(progress.plans, plan.balanceId) : undefined
          }
          owedCents={owedOn(plan.balanceId)}
          today={today}
          zoneSettled={zoneSettled}
          onChanged={onChanged}
          separated={index > 0}
        />
      ))}
    </div>
  );
}

/** One plan: its terms and progress, with Edit (replace) and Deactivate for that plan only. */
function PlanBlock({
  member,
  plan,
  balanceName,
  current,
  owedCents,
  today,
  zoneSettled,
  onChanged,
  separated,
}: {
  member: HouseholdMemberRow;
  plan: PaymentPlanRow;
  balanceName: string | null;
  current: ChildPaymentProgress | null | undefined;
  owedCents: number | undefined;
  today: CalendarDate | null;
  zoneSettled: boolean;
  onChanged: () => void;
  separated: boolean;
}) {
  const [mode, setMode] = useState<"view" | "edit" | "deactivate">("view");
  const forBalance = balanceName ? <span className="sr-only"> on {balanceName}</span> : null;

  function handleDone() {
    setMode("view");
    onChanged();
  }

  return (
    <div
      data-balance={balanceName ?? undefined}
      className={cx("flex flex-col gap-3", separated && "border-t border-border pt-3")}
    >
      <div className="flex min-h-touch items-center justify-between gap-2">
        {balanceName ? <h3 className="text-head">{balanceName}</h3> : <span />}
        {mode === "view" && (
          <Button size="sm" variant="ghost" icon="edit" onClick={() => setMode("edit")}>
            Edit plan{forBalance}
          </Button>
        )}
      </div>

      <PlanTerms
        plan={plan}
        current={current}
        balanceCents={owedCents}
        today={today}
        zoneSettled={zoneSettled}
      />

      {mode === "edit" && (
        <ReplacePlanForm
          memberId={member.id}
          plan={plan}
          balanceName={balanceName}
          onDone={handleDone}
          onCancel={() => setMode("view")}
        />
      )}

      {mode === "deactivate" && (
        <DeactivatePlanConfirm
          planId={plan.id}
          balanceName={balanceName}
          onDone={handleDone}
          onCancel={() => setMode("view")}
        />
      )}

      {mode === "view" && (
        <Button
          size="sm"
          variant="ghost"
          className="self-start !px-1 !text-danger"
          onClick={() => setMode("deactivate")}
        >
          Deactivate plan{forBalance}
        </Button>
      )}
    </div>
  );
}

function PlanTerms({
  plan,
  current,
  balanceCents,
  today,
  zoneSettled,
}: {
  plan: PaymentPlanRow;
  /** This plan's current period; undefined while unknown. */
  current: ChildPaymentProgress | null | undefined;
  /** What the child owes on this plan's balance, for the status chip. */
  balanceCents: number | undefined;
  today: CalendarDate | null;
  zoneSettled: boolean;
}) {
  const chip = zoneSettled ? planChip(balanceCents, current, today) : null;
  const view = current ? planProgressView(current) : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p>
            <span className="tabular text-amount tabular-nums">{formatCents(plan.minimumCents)}</span>{" "}
            <span className="text-label text-subtle">/ month</span>
          </p>
          <p className="text-label text-muted">{planTermsLine(plan)}</p>
        </div>
        {chip && <StatusChip kind={chip.kind} label={chip.label} />}
      </div>

      {view && (
        <div>
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-label">
            <span>{view.text}</span>
            <span className="text-subtle">
              {[view.leftText, view.dueText].filter(Boolean).join(" · ")}
            </span>
          </div>
          <ProgressBar
            className="mt-1.5"
            value={view.paidCents}
            max={view.minimumCents}
            label="Paid this period"
            valueText={view.text}
            tone={view.tone}
          />
        </div>
      )}
      {current?.periodStatus === "waived" && (
        <p className="text-label text-muted">This period's minimum is waived.</p>
      )}
    </div>
  );
}

function RecentCard({ member }: { member: HouseholdMemberRow }) {
  const activity = useRecentActivity(member.id);

  return (
    <Card as="section" aria-labelledby="recent-heading">
      <div className="flex items-center justify-between">
        <h2 id="recent-heading" className="text-head">
          Recent
        </h2>
        <TextLink to={`/activity${childParam(member.id)}`}>
          See all<span className="sr-only"> of {member.name}&apos;s activity</span>
        </TextLink>
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
          {noActivityForMember(member.name)}
        </EmptyState>
      )}

      {activity.status === "loaded" && activity.transactions.length > 0 && (
        <ul className="mt-1">
          {activity.transactions.slice(0, RECENT_ON_PAGE).map((transaction) => (
            <RecentRow key={transaction.id} transaction={transaction} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function RecentRow({ transaction }: { transaction: RecentTransaction }) {
  const look = transactionLook(transaction.type);
  const detail = transaction.type === "expense" ? transaction.categoryName : look.label;
  const subline = [
    formatCalendarDate(transaction.occurredOn, "short"),
    detail,
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
