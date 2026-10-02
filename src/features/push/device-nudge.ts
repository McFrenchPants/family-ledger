/**
 * Rules for the one-line device nudge at the bottom of Home (design spec
 * section 7): "Get a nudge when a payment is due. Turn on | x".
 *
 * Pure decision logic plus small guarded storage helpers, so both Homes
 * (Child now, Parent later) share one tested set of rules:
 *
 *  - Never while something needs attention (the caller decides what that
 *    means for its role -- for a Child, an overdue payment).
 *  - Hidden for good after the second dismissal; snoozed for 30 days after
 *    the first.
 *  - iPhone/iPad not installed: push needs the Home Screen app, so the
 *    install nudge replaces the push nudge (never both).
 *  - Otherwise only when push is supported, permission isn't denied, and
 *    this device is known not to be subscribed.
 *
 * Detection reuses `isPushSupported` / `isIOS` / `isStandalone` unchanged;
 * the full controls and explanations stay in Settings.
 */

export type DeviceNudgeKind = "none" | "push" | "install";

export type NudgeDismissal = {
  /** How many times the x has been pressed on this device. */
  readonly count: number;
  /** Epoch ms until which the nudge stays hidden (0 = not snoozed). */
  readonly snoozedUntil: number;
};

export type DeviceNudgeInputs = {
  readonly pushSupported: boolean;
  readonly ios: boolean;
  readonly standalone: boolean;
  /** `Notification.permission`, or "unsupported" without the API. */
  readonly permission: NotificationPermission | "unsupported";
  /** Whether this device already has a push subscription; null while unknown. */
  readonly subscribed: boolean | null;
  /** True while the page has something that needs attention (or hasn't finished loading). */
  readonly needsAttention: boolean;
  readonly dismissal: NudgeDismissal;
  /** Current instant, epoch ms. */
  readonly now: number;
};

export const NUDGE_SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;
export const NUDGE_DISMISSALS_TO_HIDE = 2;
export const DEVICE_NUDGE_KEY = "family-ledger:device-nudge";

export const NO_DISMISSAL: NudgeDismissal = { count: 0, snoozedUntil: 0 };

export function decideDeviceNudge(inputs: DeviceNudgeInputs): DeviceNudgeKind {
  if (inputs.needsAttention) return "none";
  if (inputs.dismissal.count >= NUDGE_DISMISSALS_TO_HIDE) return "none";
  if (inputs.now < inputs.dismissal.snoozedUntil) return "none";

  if (inputs.ios && !inputs.standalone) return "install";

  if (!inputs.pushSupported) return "none";
  if (inputs.permission === "denied" || inputs.permission === "unsupported") return "none";
  if (inputs.subscribed !== false) return "none";
  return "push";
}

/** The dismissal state after pressing x once more at `now`. */
export function nextDismissal(previous: NudgeDismissal, now: number): NudgeDismissal {
  return { count: previous.count + 1, snoozedUntil: now + NUDGE_SNOOZE_MS };
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function resolveStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Read this device's dismissal state; unusable or garbled storage reads as "never dismissed". */
export function readNudgeDismissal(storage?: StorageLike): NudgeDismissal {
  try {
    const raw = resolveStorage(storage)?.getItem(DEVICE_NUDGE_KEY);
    if (raw == null) return NO_DISMISSAL;
    const parsed = JSON.parse(raw) as Partial<NudgeDismissal> | null;
    const count = Number.isInteger(parsed?.count) ? (parsed?.count as number) : 0;
    const snoozedUntil = Number.isFinite(parsed?.snoozedUntil) ? (parsed?.snoozedUntil as number) : 0;
    return { count: Math.max(0, count), snoozedUntil };
  } catch {
    return NO_DISMISSAL;
  }
}

/** Persist a dismissal. If storage throws, the nudge just comes back next load. */
export function writeNudgeDismissal(dismissal: NudgeDismissal, storage?: StorageLike): void {
  try {
    resolveStorage(storage)?.setItem(DEVICE_NUDGE_KEY, JSON.stringify(dismissal));
  } catch {
    // Ignore: acceptable to show the nudge again.
  }
}

/** `Notification.permission`, guarded for browsers without the API. */
export function currentNotificationPermission(): NotificationPermission | "unsupported" {
  try {
    return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
  } catch {
    return "unsupported";
  }
}

/**
 * Does this device already hold a push subscription? Reads the existing
 * service-worker registration without waiting on `serviceWorker.ready`
 * (which can hang). `null` means "couldn't tell" -- the nudge stays hidden.
 */
export async function detectPushSubscribed(): Promise<boolean | null> {
  try {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) return false;
    const subscription = await registration.pushManager.getSubscription();
    return subscription !== null;
  } catch {
    return null;
  }
}
