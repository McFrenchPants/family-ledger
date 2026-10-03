/**
 * Pure presentation helpers for the Family list and a member's page. No
 * React, no network. Status wording is the Parent column of the shared
 * vocabulary (`childCardView` in `features/home/parent-home.ts`); nothing
 * here re-derives ledger math -- balances and period status come from the
 * server.
 */
import type { StatusKind } from "../../components/ui/status";
import { formatCents, type Cents } from "../../lib/currency";
import { formatCalendarDate, type CalendarDate } from "../../lib/dates";
import type { MembershipRole } from "../auth/membership-context";
import { childCardView } from "../home/parent-home";
import type { PaymentPlanRow } from "../payment-plans/payment-plans";
import type { ChildPaymentProgress } from "../payment-plans/useChildPaymentProgress";

export const ROLE_LABELS: Record<MembershipRole, string> = {
  parent: "Parent",
  child: "Child",
};

export const remindersLabel = (on: boolean) => (on ? "Reminders on" : "Reminders off");

export const childParam = (memberId: string) => `?child=${encodeURIComponent(memberId)}`;
export const memberPath = (memberId: string) => `/family/${encodeURIComponent(memberId)}`;

export type Chip = { kind: StatusKind; label: string };

/**
 * A child's plan status chip, exactly as Home shows it. `null` whenever
 * either input is still unknown (loading or failed) -- the chip is then
 * left out rather than guessed. `progress === null` means "no active plan".
 */
export function planChip(
  balanceCents: Cents | undefined,
  progress: ChildPaymentProgress | null | undefined,
  today: CalendarDate | null,
  locale?: string,
): Chip | null {
  if (balanceCents === undefined || progress === undefined) return null;
  return childCardView(balanceCents, progress, today, locale).chip;
}

export type PlanProgressView = {
  /** "October: $25.00 of $40.00". */
  text: string;
  /** "$15.00 left" -- null once nothing is left this period. */
  leftText: string | null;
  /** "Due Oct 15". */
  dueText: string;
  paidCents: Cents;
  minimumCents: Cents;
  tone: "accent" | "ok" | "danger";
};

/**
 * The current period's progress line for the plan card. Unlike Home's card,
 * this shows even when the balance is zero: it describes the plan, not the
 * debt. A waived period has nothing to track, so it shows no bar.
 */
export function planProgressView(
  progress: ChildPaymentProgress,
  locale?: string,
): PlanProgressView | null {
  if (progress.periodStatus === "waived") return null;
  const money = (cents: Cents) => formatCents(cents, { locale });
  const month = formatCalendarDate(progress.dueDate, "month");
  return {
    text: `${month}: ${money(progress.paidCents)} of ${money(progress.minimumCents)}`,
    leftText: progress.remainingCents > 0 ? `${money(progress.remainingCents)} left` : null,
    dueText: `Due ${formatCalendarDate(progress.dueDate, "short")}`,
    paidCents: progress.paidCents,
    minimumCents: progress.minimumCents,
    tone:
      progress.periodStatus === "overdue"
        ? "danger"
        : progress.periodStatus === "satisfied"
          ? "ok"
          : "accent",
  };
}

/** "Due on day 15 each month · since Jun 15 · until Dec 15". */
export function planTermsLine(plan: PaymentPlanRow): string {
  const parts = [
    `Due on day ${plan.dueDay} each month`,
    `since ${formatCalendarDate(plan.startsOn, "short")}`,
  ];
  if (plan.endsOn) parts.push(`until ${formatCalendarDate(plan.endsOn, "short")}`);
  return parts.join(" · ");
}
