import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { Avatar } from "../components/ui/Avatar";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { Icon } from "../components/ui/Icon";
import { StatusChip } from "../components/ui/StatusChip";
import { useMembership } from "../features/auth/membership-context";
import { AddMemberForm } from "../features/family/AddMemberForm";
import { ArchivedTag, LoadError, ReminderIcon, RoleTag } from "../features/family/FamilyParts";
import { memberPath, planChip } from "../features/family/family-view";
import { useFamilyMembers } from "../features/family/useFamilyMembers";
import { useHouseholdBalances } from "../features/ledger/useHouseholdBalances";
import { useHouseholdTimezone } from "../features/ledger/useHouseholdTimezone";
import { SetPasswordLinkDialog } from "../features/members/SetPasswordLinkDialog";
import type { SetPasswordLink } from "../features/members/SetPasswordLinkDialog";
import type { HouseholdMemberRow } from "../features/members/useHouseholdMembers";
import { useLoginEmails } from "../features/members/useLoginEmails";
import { remindersFor, useMemberPushStatus } from "../features/members/useMemberPushStatus";
import { useHouseholdPaymentProgress } from "../features/payment-plans/useHouseholdPaymentProgress";
import { todayInZone, type CalendarDate } from "../lib/dates";

/**
 * `/family` (Parent only, via `RequireRole role="parent"` in the router --
 * routing convenience, not the control). Lists the household's people; each
 * row opens that person's page. Every read here is scoped server-side (RLS
 * on `household_members`, security-definer balance / plan / push-status
 * functions), and adding a member goes through an Edge Function that
 * re-checks the caller is a Parent.
 */
export function FamilyPage() {
  const membership = useMembership();

  if (membership.status !== "loaded") {
    // Unreachable under RequireRole; satisfies the type checker.
    return null;
  }

  const { householdId, memberId } = membership.membership;
  return <Family householdId={householdId} selfId={memberId} />;
}

function Family({ householdId, selfId }: { householdId: string; selfId: string }) {
  const family = useFamilyMembers(householdId);
  const { emails, refetch: refetchEmails } = useLoginEmails(householdId);
  const zone = useHouseholdTimezone(householdId);
  const [adding, setAdding] = useState(false);
  // The one-time link lives only here, while its dialog is open.
  const [link, setLink] = useState<SetPasswordLink | null>(null);

  const addButtonRef = useRef<HTMLButtonElement>(null);
  const wasAdding = useRef(false);
  useEffect(() => {
    // Closing the add form hands focus back to the button that opened it.
    if (wasAdding.current && !adding) addButtonRef.current?.focus();
    wasAdding.current = adding;
  }, [adding]);

  const members = family.members;
  const active = members?.filter((member) => member.status === "active") ?? [];
  const archived = members?.filter((member) => member.status === "archived") ?? [];

  // "Today" is the household's, never the browser's. While the zone is still
  // loading, chips wait; if it failed, they fall back to plain due dates.
  const today: CalendarDate | null = zone.status === "loaded" ? todayInZone(zone.timezone) : null;

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-title">Family</h1>
        {!adding && (
          <Button
            ref={addButtonRef}
            size="sm"
            variant="primary"
            icon="plus"
            onClick={() => setAdding(true)}
          >
            Add member
          </Button>
        )}
      </header>

      {link && <SetPasswordLinkDialog link={link} onClose={() => setLink(null)} />}

      {adding && (
        <AddMemberForm
          householdId={householdId}
          onClose={() => setAdding(false)}
          onAdded={(added) => {
            if (added.url) {
              setLink({
                url: added.url,
                heading: `${added.name} was added`,
                intro: `Send this link to ${added.name} so they can choose their password.`,
              });
            }
            refetchEmails();
            family.refetch();
          }}
        />
      )}

      {family.state.status === "loading" && members === null && (
        <p role="status" className="text-label text-subtle">
          Loading members…
        </p>
      )}

      {family.state.status === "error" && (
        <LoadError
          message={`Could not load members: ${family.state.message}`}
          onRetry={family.state.retry}
        />
      )}

      {members !== null && (
        // Keyed on who is active, so adding, archiving or restoring someone
        // re-reads balances, plan status and reminders for the new roster.
        <MemberLists
          key={active.map((member) => member.id).join(",")}
          householdId={householdId}
          selfId={selfId}
          active={active}
          archived={archived}
          emails={emails}
          today={today}
          zoneSettled={zone.status !== "loading"}
        />
      )}
    </div>
  );
}

function MemberLists({
  householdId,
  selfId,
  active,
  archived,
  emails,
  today,
  zoneSettled,
}: {
  householdId: string;
  selfId: string;
  active: HouseholdMemberRow[];
  archived: HouseholdMemberRow[];
  emails: Record<string, string | null>;
  today: CalendarDate | null;
  zoneSettled: boolean;
}) {
  const push = useMemberPushStatus(householdId);
  const balances = useHouseholdBalances(householdId);
  const childIds = active.filter((member) => member.role === "child").map((member) => member.id);
  const progress = useHouseholdPaymentProgress(householdId, childIds);

  const balanceOf = new Map(
    balances.status === "loaded"
      ? balances.children.map((child) => [child.memberId, child.balanceCents] as const)
      : [],
  );
  // Only a map covering every child counts, so nobody flashes as "No plan"
  // while the progress hook catches up with the roster.
  const progressMap =
    progress.status === "loaded" && childIds.every((id) => progress.progressByMemberId.has(id))
      ? progress.progressByMemberId
      : null;

  const chipFor = (member: HouseholdMemberRow) =>
    member.role === "child" && progressMap && zoneSettled
      ? planChip(balanceOf.get(member.id), progressMap.get(member.id), today)
      : null;

  // Plan status is secondary here: a failure leaves the list working and
  // says so once, with a retry.
  const planError =
    balances.status === "error"
      ? { message: balances.message, retry: balances.retry }
      : progress.status === "error"
        ? { message: progress.message, retry: progress.retry }
        : null;

  return (
    <>
      {planError && childIds.length > 0 && (
        <LoadError
          message={`Could not load payment plan status: ${planError.message}`}
          onRetry={planError.retry}
        />
      )}

      {active.length === 0 ? (
        <Card>
          <EmptyState icon="users" title="No members yet">
            Add the people in your household to start tracking.
          </EmptyState>
        </Card>
      ) : (
        <Card as="section" aria-label="Members" className="px-4 py-1">
          <ul>
            {active.map((member) => (
              <MemberRow
                key={member.id}
                member={member}
                email={emails[member.id] ?? null}
                isSelf={member.id === selfId}
                chip={chipFor(member)}
                reminders={remindersFor(push, member.id)}
              />
            ))}
          </ul>
        </Card>
      )}

      {archived.length > 0 && (
        <section aria-labelledby="archived-heading" className="flex flex-col gap-2">
          <h2 id="archived-heading" className="text-head text-muted">
            Archived
          </h2>
          <p className="text-label text-subtle">
            Archived people can't sign in. Their history is kept, and you can restore them from
            their page.
          </p>
          <Card className="bg-sunken px-4 py-1 shadow-none">
            <ul>
              {archived.map((member) => (
                <MemberRow
                  key={member.id}
                  member={member}
                  email={emails[member.id] ?? null}
                  isSelf={member.id === selfId}
                  chip={null}
                  reminders={null}
                  quiet
                />
              ))}
            </ul>
          </Card>
        </section>
      )}
    </>
  );
}

function MemberRow({
  member,
  email,
  isSelf,
  chip,
  reminders,
  quiet = false,
}: {
  member: HouseholdMemberRow;
  email: string | null;
  isSelf: boolean;
  chip: ReturnType<typeof planChip>;
  /** null while unknown: no icon at all rather than a guess. */
  reminders: boolean | null;
  quiet?: boolean;
}) {
  return (
    <li className="border-t border-border first:border-t-0" data-testid="member-row">
      <Link
        to={memberPath(member.id)}
        className="-mx-2 flex min-h-[72px] items-center gap-3 rounded-control px-2 py-3 hover:bg-sunken"
      >
        <Avatar name={member.name} className={quiet ? "opacity-70" : undefined} />
        <span className="flex min-w-0 grow flex-col items-start gap-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className={quiet ? "font-semibold text-muted" : "font-semibold text-ink"}>
              {member.name}
            </span>
            <RoleTag role={member.role} />
            {quiet && <ArchivedTag />}
          </span>
          {email && <span className="break-all text-label text-subtle">{email}</span>}
          {isSelf && <span className="text-label text-subtle">You</span>}
          {chip && <StatusChip kind={chip.kind} label={chip.label} />}
        </span>
        {reminders !== null && <ReminderIcon on={reminders} />}
        <Icon name="chev" className="text-subtle" />
      </Link>
    </li>
  );
}
