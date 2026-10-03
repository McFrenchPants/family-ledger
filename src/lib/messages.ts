/**
 * Every piece of encouragement / reminder copy the Home screen shows, in one
 * place, so the tone can be changed without touching components.
 *
 * Tone: light, warm, a little cheeky. Never shaming, never ranking, never
 * comparing siblings, and never anything that suggests a Child can lower
 * their own balance -- payments are recorded by a parent, so messages are
 * announcements, not calls to press a button.
 *
 * Variants rotate once per day. The seed is the household-zone calendar date
 * (`todayInZone(householdZone)`), never the browser's date, so the same
 * message stays put all day and does not flicker between renders.
 */

/** Text with the bits that vary already filled in (amounts and dates are pre-formatted). */
type Template<V> = (vars: V) => string;

type AmountDate = { amount: string; date: string };

/** Overdue callout. Always names the amount and the due date. */
export const OVERDUE_MESSAGES: readonly Template<AmountDate>[] = [
  ({ amount, date }) =>
    `${amount} was due ${date}. If this were a real lender, you'd be paying a late fee!`,
  ({ amount, date }) =>
    `${amount} was due ${date}. Lucky for you, the bank of Mom and Dad doesn't charge interest.`,
  ({ amount, date }) =>
    `${amount} has been waiting since ${date}. It's starting to feel a little left out.`,
  ({ amount, date }) =>
    `${amount} was due ${date}. A real bank would have sent a very stern letter by now.`,
];

/** Second line of the overdue callout: how payments actually happen. */
export const OVERDUE_HOW_TO_PAY = "Payments are recorded by a parent when you hand it over.";

/** Due within the next few days (or today). Always names the amount and the date. */
export const DUE_SOON_MESSAGES: readonly Template<AmountDate>[] = [
  ({ amount, date }) => `${amount} is due ${date}. Plenty of time to sort it out with a parent.`,
  ({ amount, date }) => `Heads up: ${amount} is due ${date}. Future you will be grateful.`,
  ({ amount, date }) => `${amount} is due ${date}. Paying on time is a very grown-up move.`,
];

/** Plan in good shape, nothing pressing. */
export const ON_TRACK_MESSAGES: readonly string[] = [
  "You're on track. Keep it up.",
  "All good for now. Nice and steady.",
  "On track. Your credit score (if you had one) would approve.",
];

/** The current month's minimum is already met. `month` is e.g. "October". */
export const PAID_ON_TIME_MESSAGES: readonly Template<{ month: string }>[] = [
  ({ month }) => `Paid on time for ${month}. Nicely done.`,
  ({ month }) => `${month} is covered, and on time too. Look at you.`,
  ({ month }) => `${month}: paid on time. A lender's dream customer.`,
];

/** Balance is zero and there is history behind it. */
export const PAID_OFF_MESSAGES: readonly string[] = [
  "You don't owe a thing. Enjoy that feeling.",
  "Balance cleared. Your future self says thanks.",
  "Nothing owed. Debt-free looks good on you.",
];

/** Heading for the paid-off state. */
export const PAID_OFF_TITLE = "Paid off!";

/** A payment arrived since the last visit. `amount` is the total of the new payments. */
export const PAYMENT_RECEIVED_MESSAGES: readonly Template<{ amount: string }>[] = [
  ({ amount }) => `Payment received: ${amount}. Look at you go!`,
  ({ amount }) => `Payment received: ${amount}. Your balance just got lighter.`,
  ({ amount }) => `Payment received: ${amount}. That's how it's done.`,
];

/**
 * Parent-side: the line under "Payment recorded". `name` is the child's
 * name, `amount` the payment. Seeded per payment (its transaction id), so it
 * stays put if the panel re-renders. About progress, never about shame.
 */
export const PAYMENT_RECORDED_MESSAGES: readonly Template<{ name: string; amount: string }>[] = [
  ({ name, amount }) => `Nice. ${name} is ${amount} closer to zero.`,
  ({ name, amount }) => `${amount} down. ${name}'s balance just got lighter.`,
  ({ name, amount }) => `Logged. ${name} just chipped ${amount} off the total.`,
  ({ name, amount }) => `${name} is ${amount} closer to debt-free. Somebody's learning.`,
];

/** Parent Home when nothing is overdue or due within the week. */
export const EVERYONE_UP_TO_DATE = "Everyone is up to date";

/** Owe-card copy when nothing is owed and nothing has happened yet. */
export const ALL_CAUGHT_UP_HINT =
  "Nothing due right now. If a parent covers something for you, add it here so the balance stays right.";

/** Empty recent-activity card (brand-new child). */
export const NO_ACTIVITY_TITLE = "No activity yet";
export const NO_ACTIVITY_HINT =
  "When a parent pays for something of yours, like gas or a phone bill, add it as an expense. Payments show up here once a parent records them.";

/** Parent-side empty activity (Home's Recent activity card and the Activity page). */
export const NO_ACTIVITY_HINT_PARENT =
  "Expenses and payments show up here as soon as anyone records them.";

/** Empty Recent card on one member's page. */
export const noActivityForMember = (name: string): string =>
  `Nothing recorded for ${name} yet. Expenses and payments show up here as they happen.`;

/** Device nudges at the bottom of Home. */
export const PUSH_NUDGE_TEXT = "Get a nudge when a payment is due.";
export const PUSH_NUDGE_ACTION = "Turn on";
export const INSTALL_NUDGE_TEXT = "Add Family Ledger to your Home Screen to get payment reminders.";
export const INSTALL_NUDGE_ACTION = "Show me";

/**
 * 32-bit FNV-1a hash of a string. Small, deterministic, and good enough to
 * spread a handful of daily seeds across a handful of variants.
 */
function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Deterministically choose one item for `seed`. Same seed, same item, always.
 *
 * Callers pass the household-zone calendar date plus a per-message salt
 * (see `daySeed`) so different messages on the same day don't all land on
 * the same index.
 */
export function pick<T>(items: readonly T[], seed: string): T {
  if (items.length === 0) {
    throw new RangeError("pick() needs at least one item.");
  }
  return items[hashSeed(seed) % items.length] as T;
}

/** Seed for one kind of message on one household-zone calendar day. */
export function daySeed(householdDate: string, kind: string): string {
  return `${householdDate}:${kind}`;
}
