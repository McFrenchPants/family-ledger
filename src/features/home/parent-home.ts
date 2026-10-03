/**
 * Pure presentation logic for the Parent's Home screen: who needs attention,
 * each child's status chip and progress line, the order of the children, the
 * household total, and the greeting. No React, no network -- everything here
 * is a function of data the page already read, mirroring `child-home.ts`.
 *
 * Nothing here re-derives ledger math. Balances come from
 * `household_member_balances`; "overdue", "satisfied" and "waived" come from
 * the server's `payment_period_status`; "today" is the household-zone
 * calendar day the caller passes in. The only things decided here are the
 * presentation window for "due soon" (`DUE_SOON_DAYS`, shared with Child
 * Home) and the copy.
 */
import type { StatusKind } from "../../components/ui/status";
import { formatCents, sumCents, type Cents } from "../../lib/currency";
import {
  addDays,
  compareCalendarDates,
  daysBetween,
  formatCalendarDate,
  type CalendarDate,
} from "../../lib/dates";
import type { ChildBalance } from "../ledger/household-balances";
import { headlineProgress, type PlansByMember } from "../payment-plans/plan-selection";
import type { ChildPaymentProgress } from "../payment-plans/useChildPaymentProgress";
import { DUE_SOON_DAYS } from "./child-home";

/**
 * A child's plan progress as the page knows it: `undefined` while plan
 * status is still loading (or failed), `null` for "no active plan".
 */
export type KnownProgress = ChildPaymentProgress | null | undefined;

function isDueSoon(dueDate: CalendarDate, today: CalendarDate): boolean {
  return compareCalendarDates(dueDate, addDays(today, DUE_SOON_DAYS)) <= 0;
}

/** Whole percent for the bar; integer arithmetic on cents, never a money value. */
function percentPaid(paidCents: Cents, minimumCents: Cents): number {
  if (minimumCents <= 0) return 100;
  return Math.min(100, Math.max(0, Math.floor((paidCents * 100) / minimumCents)));
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/* ------------------------------------------------------------------ */
/* Needs attention                                                      */
/* ------------------------------------------------------------------ */

export type AttentionItem = {
  memberId: string;
  name: string;
  /** Which of the child's plans this is (a child can have one per balance). */
  balanceId: string;
  kind: "overdue" | "due-soon";
  /** What is still owed for the current period (server's remaining, clamped >= 0). */
  amountCents: Cents;
  dueDate: CalendarDate;
  /** "Alex is $15.00 behind" / "Sam owes $30.00 by Oct 5". */
  headline: string;
  /** "October minimum, due Oct 15 · 3 days overdue". */
  detail: string;
  /** "Overdue" / "Due today" / "Due in 3 days". */
  chipLabel: string;
};

/**
 * One item per plan that is overdue or due within `DUE_SOON_DAYS` (today
 * included), worst first: overdue before due-soon, then earliest due date,
 * then name. A child with nothing owed, no plan, a satisfied or waived
 * period, or nothing left to pay this period never needs attention.
 *
 * `balanceLabel` names a plan's balance ("Car") when the household has more
 * than one, so two plans of one child read apart; null leaves the wording as
 * it was.
 *
 * `today` must be today's date in the household zone.
 */
export function needsAttention(
  children: readonly ChildBalance[],
  plansByMemberId: PlansByMember,
  today: CalendarDate,
  locale?: string,
  balanceLabel: (balanceId: string) => string | null = () => null,
): AttentionItem[] {
  const money = (cents: Cents) => formatCents(cents, { locale });
  const items: AttentionItem[] = [];

  for (const child of children) {
    for (const progress of plansByMemberId.get(child.memberId) ?? []) {
      // Same rule as Child Home: with nothing owed, nothing is pressing.
      if (child.balanceCents <= 0 || progress.remainingCents <= 0) continue;
      const label = balanceLabel(progress.balanceId);
      const on = label ? ` on ${label}` : "";

      const due = formatCalendarDate(progress.dueDate, "short");
      const month = formatCalendarDate(progress.dueDate, "month");
      const base = {
        memberId: child.memberId,
        balanceId: progress.balanceId,
        name: child.name,
        amountCents: progress.remainingCents,
        dueDate: progress.dueDate,
      };

      if (progress.periodStatus === "overdue") {
        const late = Math.max(0, daysBetween(progress.dueDate, today));
        items.push({
          ...base,
          kind: "overdue",
          headline: `${child.name} is ${money(progress.remainingCents)} behind${on}`,
          detail: `${month} ${label ? `${label} ` : ""}minimum, due ${due} · ${plural(late, "day", "days")} overdue`,
          chipLabel: "Overdue",
        });
        continue;
      }

      if (progress.periodStatus === "satisfied" || progress.periodStatus === "waived") continue;
      if (!isDueSoon(progress.dueDate, today)) continue;

      const until = Math.max(0, daysBetween(today, progress.dueDate));
      items.push({
        ...base,
        kind: "due-soon",
        headline:
          until === 0
            ? `${child.name} owes ${money(progress.remainingCents)}${on} today`
            : `${child.name} owes ${money(progress.remainingCents)}${on} by ${due}`,
        detail: `${month} ${label ? `${label} ` : ""}minimum, due ${due}`,
        chipLabel:
          until === 0 ? "Due today" : until === 1 ? "Due tomorrow" : `Due in ${until} days`,
      });
    }
  }

  return items.sort(
    (a, b) =>
      (a.kind === b.kind ? 0 : a.kind === "overdue" ? -1 : 1) ||
      compareCalendarDates(a.dueDate, b.dueDate) ||
      a.name.localeCompare(b.name),
  );
}

/* ------------------------------------------------------------------ */
/* Children                                                             */
/* ------------------------------------------------------------------ */

export type ChildCardView = {
  /** null while plan status is unknown (loading or failed). */
  chip: { kind: StatusKind; label: string } | null;
  /**
   * The thin bar under a child's row, shown only while something is owed
   * under an active, non-waived plan. It carries no date: the due date, when
   * Home shows one, lives in the chip alone.
   */
  progress: {
    paidCents: Cents;
    minimumCents: Cents;
    /** "$25.00 of $40.00 paid" -- the bar's spoken value. */
    text: string;
    percent: number;
    tone: "accent" | "ok" | "danger";
  } | null;
};

/**
 * Status chip and progress bar for one child row, using the Parent column
 * of the status vocabulary (design spec 6.7).
 */
export function childCardView(
  balanceCents: Cents,
  progress: KnownProgress,
  today: CalendarDate | null,
  locale?: string,
): ChildCardView {
  const money = (cents: Cents) => formatCents(cents, { locale });

  if (balanceCents <= 0) {
    return { chip: { kind: "clear", label: "All caught up" }, progress: null };
  }
  if (progress === undefined) return { chip: null, progress: null };
  if (progress === null) return { chip: { kind: "none", label: "No plan" }, progress: null };

  const due = formatCalendarDate(progress.dueDate, "short");
  const month = formatCalendarDate(progress.dueDate, "month");

  let chip: ChildCardView["chip"];
  switch (progress.periodStatus) {
    case "overdue":
      chip = { kind: "overdue", label: `${money(progress.remainingCents)} overdue` };
      break;
    case "satisfied":
      chip = { kind: "satisfied", label: `${month} paid` };
      break;
    case "waived":
      chip = { kind: "waived", label: "Waived" };
      break;
    case "partially_paid":
      chip = {
        kind: "partial",
        label: `${money(progress.paidCents)} of ${money(progress.minimumCents)} paid`,
      };
      break;
    case "due":
    case "upcoming":
    default:
      chip =
        today !== null && isDueSoon(progress.dueDate, today)
          ? { kind: "due", label: `${money(progress.remainingCents)} due ${due}` }
          : { kind: "upcoming", label: `Due ${due}` };
  }

  if (progress.periodStatus === "waived") return { chip, progress: null };

  return {
    chip,
    progress: {
      paidCents: progress.paidCents,
      minimumCents: progress.minimumCents,
      text: `${money(progress.paidCents)} of ${money(progress.minimumCents)} paid`,
      percent: percentPaid(progress.paidCents, progress.minimumCents),
      tone:
        progress.periodStatus === "overdue"
          ? "danger"
          : progress.periodStatus === "satisfied"
            ? "ok"
            : "accent",
    },
  };
}

/**
 * 0 overdue, 1 something still due under a plan, 2 paid up (satisfied,
 * waived, or nothing owed), 3 no plan. `undefined` (plan status unknown)
 * ranks by balance alone so the list still has a sensible order.
 */
function childRank(child: ChildBalance, progress: KnownProgress): number {
  if (child.balanceCents <= 0) return 2;
  if (progress === undefined) return 1;
  if (progress === null) return 3;
  switch (progress.periodStatus) {
    case "overdue":
      return 0;
    case "satisfied":
    case "waived":
      return 2;
    default:
      return progress.remainingCents > 0 ? 1 : 2;
  }
}

/**
 * Children in display order (by each child's most pressing plan): overdue
 * first, then due soonest, then paid up, then no plan. Ties keep the
 * roster's order (the sort is stable).
 */
export function orderChildren(
  children: readonly ChildBalance[],
  plansByMemberId: PlansByMember | null,
): ChildBalance[] {
  const progressOf = (child: ChildBalance): KnownProgress =>
    plansByMemberId ? headlineProgress(plansByMemberId.get(child.memberId)) : undefined;

  return [...children].sort((a, b) => {
    const pa = progressOf(a);
    const pb = progressOf(b);
    const rank = childRank(a, pa) - childRank(b, pb);
    if (rank !== 0) return rank;
    if (pa && pb && childRank(a, pa) <= 1) return compareCalendarDates(pa.dueDate, pb.dueDate);
    return 0;
  });
}

/* ------------------------------------------------------------------ */
/* Owed to the family                                                   */
/* ------------------------------------------------------------------ */

export type HouseholdTotal = {
  /** Sum of the children's balances (integer cents, display-only total). */
  totalCents: Cents;
  /** "across 3 children · $85.00 due by Oct 15" -- the due part only when something is due. */
  summary: string;
};

/**
 * The household total and its secondary line. `plansByMemberId` is null
 * while plan status is unknown; the line then only counts the children.
 * Only periods that are neither satisfied nor waived, for a child who owes
 * something, count toward "due"; the date is the latest such due date.
 */
export function householdTotal(
  children: readonly ChildBalance[],
  plansByMemberId: PlansByMember | null,
  locale?: string,
): HouseholdTotal {
  const totalCents = sumCents(children.map((child) => child.balanceCents));
  const across = `across ${plural(children.length, "child", "children")}`;

  const dueRows = plansByMemberId
    ? children.flatMap((child) =>
        child.balanceCents <= 0
          ? []
          : (plansByMemberId.get(child.memberId) ?? []).filter(
              (progress) =>
                progress.remainingCents > 0 &&
                progress.periodStatus !== "satisfied" &&
                progress.periodStatus !== "waived",
            ),
      )
    : [];

  if (dueRows.length === 0) return { totalCents, summary: across };

  const dueCents = sumCents(dueRows.map((row) => row.remainingCents));
  const latest = dueRows
    .map((row) => row.dueDate)
    .reduce((a, b) => (compareCalendarDates(a, b) >= 0 ? a : b));
  return {
    totalCents,
    summary: `${across} · ${formatCents(dueCents, { locale })} due by ${formatCalendarDate(latest, "short")}`,
  };
}

/* ------------------------------------------------------------------ */
/* Greeting                                                             */
/* ------------------------------------------------------------------ */

/** The hour (0-23) at `now` in `timeZone` -- never the host's zone. */
export function hourInZone(timeZone: string, now: Date = new Date()): number {
  const hour = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    hourCycle: "h23",
  })
    .formatToParts(now)
    .find((part) => part.type === "hour")?.value;
  return Number(hour) % 24;
}

/** First word of a member's name, for a friendly greeting. */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

/**
 * "Good morning, Dana" by the household's clock. Without a known zone
 * (still loading, or failed) a neutral "Hi, Dana" rather than guessing from
 * the browser.
 */
export function greeting(name: string, timeZone: string | null, now: Date = new Date()): string {
  const who = firstName(name);
  if (timeZone === null) return `Hi, ${who}`;
  const hour = hourInZone(timeZone, now);
  const part = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
  return `Good ${part}, ${who}`;
}
