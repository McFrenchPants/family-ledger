import { useState } from "react";
import { Link, useParams } from "react-router-dom";

import { AmountText } from "../components/ui/AmountText";
import { Avatar } from "../components/ui/Avatar";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { cx } from "../components/ui/cx";
import { Icon } from "../components/ui/Icon";
import type { IconName } from "../components/ui/icon-paths";
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
} from "../features/family/PlanControls";
import { useFamilyMembers } from "../features/family/useFamilyMembers";
import type { RecentTransaction } from "../features/ledger/recent-activity";
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
import { useChildPaymentProgress } from "../features/payment-plans/useChildPaymentProgress";
import { usePaymentPlan } from "../features/payment-plans/usePaymentPlan";
import { formatCents } from "../lib/currency";
import { formatCalendarDate, todayInZone, type CalendarDate } from "../lib/dates";
import { NO_ACTIVITY_TITLE } from "../lib/messages";

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
  const balanceCents =
    balances.status === "loaded"
      ? balances.children.find((child) => child.memberId === member.id)?.balanceCents
      : undefined;

  return (
    <div className="flex flex-col gap-4 min-[900px]:grid min-[900px]:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] min-[900px]:items-start min-[900px]:gap-6">
      <div className="flex flex-col gap-4">
        <BalanceCard member={member} balances={balances} balanceCents={balanceCents} />
        <PlanCard
          member={member}
          balanceCents={balanceCents}
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
}: {
  member: HouseholdMemberRow;
  balances: HouseholdBalancesState;
  balanceCents: number | undefined;
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
  balanceCents,
  today,
  zoneSettled,
}: {
  member: HouseholdMemberRow;
  balanceCents: number | undefined;
  today: CalendarDate | null;
  zoneSettled: boolean;
}) {
  const plan = usePaymentPlan(member.id);
  // Bumped after any plan change so the current period is read again.
  const [progressKey, setProgressKey] = useState(0);
  const [mode, setMode] = useState<"view" | "edit" | "deactivate">("view");

  function handleChanged() {
    setMode("view");
    setProgressKey((key) => key + 1);
    if (plan.status === "loaded") plan.refetch();
  }

  return (
    <Card as="section" aria-labelledby="plan-heading" className="flex flex-col gap-3">
      <div className="flex min-h-touch items-center justify-between gap-2">
        <h2 id="plan-heading" className="text-head">
          Payment plan
        </h2>
        {plan.status === "loaded" && plan.plan !== null && mode === "view" && (
          <Button size="sm" variant="ghost" icon="edit" onClick={() => setMode("edit")}>
            Edit plan
          </Button>
        )}
      </div>

      {plan.status === "loading" && (
        <p role="status" className="text-label text-subtle">
          Loading payment plan…
        </p>
      )}

      {plan.status === "error" && (
        <LoadError message={`Could not load this plan: ${plan.message}`} onRetry={plan.retry} />
      )}

      {plan.status === "loaded" && plan.plan === null && (
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
          <CreatePlanForm memberId={member.id} onSaved={handleChanged} />
        </div>
      )}

      {plan.status === "loaded" && plan.plan !== null && (
        <>
          <PlanTerms
            key={progressKey}
            plan={plan.plan}
            memberId={member.id}
            balanceCents={balanceCents}
            today={today}
            zoneSettled={zoneSettled}
          />

          {mode === "edit" && (
            <ReplacePlanForm
              memberId={member.id}
              plan={plan.plan}
              onDone={handleChanged}
              onCancel={() => setMode("view")}
            />
          )}

          {mode === "deactivate" && (
            <DeactivatePlanConfirm
              planId={plan.plan.id}
              onDone={handleChanged}
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
              Deactivate plan
            </Button>
          )}
        </>
      )}
    </Card>
  );
}

function PlanTerms({
  plan,
  memberId,
  balanceCents,
  today,
  zoneSettled,
}: {
  plan: PaymentPlanRow;
  memberId: string;
  balanceCents: number | undefined;
  today: CalendarDate | null;
  zoneSettled: boolean;
}) {
  const progress = useChildPaymentProgress(memberId);
  const current = progress.status === "loaded" ? progress.progress : undefined;
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

const TYPE_LOOK: Record<string, { icon: IconName; box: string; label: string }> = {
  payment: { icon: "dollar", box: "bg-ok-soft text-ok", label: "Payment" },
  adjustment: { icon: "edit", box: "bg-accent-soft text-accent-text", label: "Adjustment" },
  expense: { icon: "tag", box: "bg-sunken text-muted", label: "Expense" },
};

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
        <p className="mt-2 text-label text-muted">{NO_ACTIVITY_TITLE}</p>
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
    <li
      data-voided={transaction.isVoided ? "true" : undefined}
      className="flex min-h-[60px] items-center gap-3 border-t border-border py-2.5 first:border-t-0"
    >
      <span className={cx("grid h-11 w-11 shrink-0 place-items-center rounded-control", look.box)}>
        <Icon name={transaction.isVoided ? "ban" : look.icon} />
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
