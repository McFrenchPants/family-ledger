/**
 * Pure presentation logic for the Child's Home screen: which status chip and
 * callout apply, which daily message to show, and whether a payment arrived
 * since the last visit. No React, no network -- everything here is a
 * function of data the page already read, so it has plain unit tests.
 *
 * "Due", "overdue" and "today" come from the server's period status plus the
 * household's IANA zone. The only thing decided here is the presentation
 * window for "due soon" (DUE_SOON_DAYS).
 */
import type { StatusKind } from "../../components/ui/status";
import { formatCents, type Cents } from "../../lib/currency";
import { addDays, compareCalendarDates, formatCalendarDate, type CalendarDate } from "../../lib/dates";
import {
  DUE_SOON_MESSAGES,
  ON_TRACK_MESSAGES,
  OVERDUE_MESSAGES,
  PAID_OFF_MESSAGES,
  PAID_ON_TIME_MESSAGES,
  PAYMENT_RECEIVED_MESSAGES,
  daySeed,
  pick,
} from "../../lib/messages";
import type { RecentTransaction } from "../ledger/recent-activity";
import type { ChildPaymentProgress } from "../payment-plans/useChildPaymentProgress";

/** "Due soon" means due today or within this many days (presentation only). */
export const DUE_SOON_DAYS = 7;

export type PlanCallout =
  | { tone: "danger"; text: string }
  | { tone: "warn"; text: string }
  | { tone: "ok"; text: string }
  | { tone: "quiet"; text: string };

export type PlanView = {
  chip: { kind: StatusKind; label: string };
  callout: PlanCallout | null;
  /** "$25.00 of $40.00 paid this month"; null when waived. */
  progress: { paidCents: Cents; minimumCents: Cents; text: string; percent: number } | null;
  /** "Next minimum: $40.00 due Oct 15." -- only while something is still to pay. */
  nextLine: string | null;
};

function isDueSoon(dueDate: CalendarDate, today: CalendarDate): boolean {
  return compareCalendarDates(dueDate, addDays(today, DUE_SOON_DAYS)) <= 0;
}

/** Whole percent for the bar width; integer arithmetic on cents, never a money value. */
function percentPaid(paidCents: Cents, minimumCents: Cents): number {
  if (minimumCents <= 0) return 100;
  return Math.min(100, Math.max(0, Math.floor((paidCents * 100) / minimumCents)));
}

/**
 * The plan section of the owe card, for a child who still owes something.
 * `today` is today's date in the household zone; `seedDate` is the same day,
 * used to rotate copy.
 */
export function planView(
  progress: ChildPaymentProgress,
  today: CalendarDate,
  locale?: string,
): PlanView {
  const money = (cents: Cents) => formatCents(cents, { locale });
  const due = formatCalendarDate(progress.dueDate, "short");
  const month = formatCalendarDate(progress.dueDate, "month");
  const seed = (kind: string) => daySeed(today, kind);

  const bar = {
    paidCents: progress.paidCents,
    minimumCents: progress.minimumCents,
    text: `${money(progress.paidCents)} of ${money(progress.minimumCents)} paid this month`,
    percent: percentPaid(progress.paidCents, progress.minimumCents),
  };
  const nextLine = `Next minimum: ${money(progress.remainingCents)} due ${due}.`;

  switch (progress.periodStatus) {
    case "overdue":
      return {
        chip: { kind: "overdue", label: "Overdue" },
        callout: {
          tone: "danger",
          text: pick(OVERDUE_MESSAGES, seed("overdue"))({
            amount: money(progress.remainingCents),
            date: due,
          }),
        },
        progress: bar,
        nextLine: null,
      };
    case "satisfied":
      return {
        chip: { kind: "satisfied", label: `Paid for ${month}` },
        callout: { tone: "ok", text: pick(PAID_ON_TIME_MESSAGES, seed("paid-on-time"))({ month }) },
        progress: bar,
        nextLine: null,
      };
    case "waived":
      return {
        chip: { kind: "waived", label: "Waived" },
        callout: { tone: "quiet", text: `No minimum for ${month}.` },
        progress: null,
        nextLine: null,
      };
    case "partially_paid":
    case "due":
    case "upcoming":
    default: {
      const soon = isDueSoon(progress.dueDate, today);
      const chip: PlanView["chip"] =
        progress.periodStatus === "partially_paid"
          ? {
              kind: "partial",
              label: `${money(progress.paidCents)} of ${money(progress.minimumCents)} paid`,
            }
          : soon
            ? { kind: "due", label: `Due ${due}` }
            : { kind: "upcoming", label: `Due ${due}` };
      const callout: PlanCallout = soon
        ? {
            tone: "warn",
            text: pick(DUE_SOON_MESSAGES, seed("due-soon"))({
              amount: money(progress.remainingCents),
              date: due,
            }),
          }
        : { tone: "quiet", text: pick(ON_TRACK_MESSAGES, seed("on-track")) };
      return { chip, callout, progress: bar, nextLine };
    }
  }
}

/** Copy for the "Paid off!" state, rotated daily. */
export function paidOffMessage(today: CalendarDate): string {
  return pick(PAID_OFF_MESSAGES, daySeed(today, "paid-off"));
}

/* ------------------------------------------------------------------ */
/* "Payment received since your last visit"                            */
/* ------------------------------------------------------------------ */

/** localStorage key prefix; one entry per member so a shared device can't mix children up. */
export const SEEN_ACTIVITY_KEY_PREFIX = "family-ledger:seen-activity:";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function storageOrNull(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Ids of the activity rows this member has already seen on this device, or
 * `null` if nothing has been stored yet (first visit) or storage is unusable.
 */
export function readSeenActivity(memberId: string, storage?: StorageLike): string[] | null {
  try {
    const raw = storageOrNull(storage)?.getItem(SEEN_ACTIVITY_KEY_PREFIX + memberId);
    if (raw == null) return null;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : null;
  } catch {
    return null;
  }
}

export function writeSeenActivity(
  memberId: string,
  ids: readonly string[],
  storage?: StorageLike,
): void {
  try {
    storageOrNull(storage)?.setItem(SEEN_ACTIVITY_KEY_PREFIX + memberId, JSON.stringify(ids));
  } catch {
    // Private mode or full storage: the card may simply show again next time.
  }
}

/** A real payment: type 'payment' and not voided. Adjustments and voided rows never count. */
export function isRealPayment(transaction: RecentTransaction): boolean {
  return transaction.type === "payment" && !transaction.isVoided;
}

/**
 * Payments in `transactions` that were not there last time. A set of seen
 * ids (rather than only the newest id) so a payment a parent back-dates
 * below a newer expense is still noticed. `seen === null` (first visit on
 * this device) never announces anything.
 */
export function newPaymentsSince(
  transactions: readonly RecentTransaction[],
  seen: readonly string[] | null,
): RecentTransaction[] {
  if (seen === null) return [];
  const seenIds = new Set(seen);
  return transactions.filter((t) => isRealPayment(t) && !seenIds.has(t.id));
}

/**
 * What this page load decided to announce, per member. Kept outside React
 * so a remount (an auth refresh re-rendering the tree, StrictMode, a trip to
 * Activity and back) shows the same card instead of finding everything
 * already marked seen. Cleared on dismiss; a fresh app load starts empty.
 */
const sessionAnnouncements = new Map<string, RecentTransaction[]>();

/**
 * New payments to announce for `memberId`: decided once per page load from
 * the stored seen ids, which are then replaced by the current ids.
 */
export function takeNewPayments(
  memberId: string,
  transactions: readonly RecentTransaction[],
  storage?: StorageLike,
): RecentTransaction[] {
  const decided = sessionAnnouncements.get(memberId);
  if (decided) return decided;
  const payments = newPaymentsSince(transactions, readSeenActivity(memberId, storage));
  sessionAnnouncements.set(memberId, payments);
  writeSeenActivity(
    memberId,
    transactions.map((t) => t.id),
    storage,
  );
  return payments;
}

export function dismissNewPayments(memberId: string): void {
  sessionAnnouncements.set(memberId, []);
}

/** Test-only: forget this page load's decisions. */
export function resetSessionAnnouncements(): void {
  sessionAnnouncements.clear();
}

/** The one-time announcement for new payments (amounts summed as integer cents). */
export function paymentReceivedMessage(
  payments: readonly RecentTransaction[],
  today: CalendarDate,
  locale?: string,
): string | null {
  if (payments.length === 0) return null;
  const totalCents = payments.reduce((sum, p) => sum + Math.abs(p.amountCents), 0);
  return pick(PAYMENT_RECEIVED_MESSAGES, daySeed(today, "payment-received"))({
    amount: formatCents(totalCents, { locale }),
  });
}
