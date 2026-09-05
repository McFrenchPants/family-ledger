/**
 * Mobile install onboarding for Family Ledger (S4.4).
 *
 * The two major mobile platforms give an app no common way to offer an
 * "install" affordance:
 *
 *  - Android Chrome (and most other Chromium-based mobile browsers) fire a
 *    non-standard `beforeinstallprompt` event once the browser's own install
 *    eligibility criteria are met. Capturing it and calling `.prompt()`
 *    later is the *only* way to trigger the native install UI from app code.
 *  - iOS Safari (and every other iOS browser -- they are all WebKit under
 *    the hood, so "iOS Chrome" has the exact same limitation) never fires
 *    that event and exposes no programmatic install trigger at all. The
 *    only path is a human tapping Share -> "Add to Home Screen". A button
 *    wired to `.prompt()` would silently do nothing there, so iOS needs
 *    plain-text instructions instead of a button.
 *
 * This module is the pure, DOM-event-free half of that: types, environment
 * detection, and the branching logic that decides which of the banner's
 * three render states applies. `InstallBanner.tsx` is the thin component
 * that wires this to the actual `beforeinstallprompt` listener and
 * `localStorage` dismissal.
 */

/**
 * The `beforeinstallprompt` event. Chromium-only and non-standard, so it is
 * not in TypeScript's DOM lib -- this is a local shape for the subset this
 * app actually uses.
 */
export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  prompt(): Promise<void>;
}

/** localStorage key for "the user dismissed the install banner". */
export const INSTALL_BANNER_DISMISSED_KEY = "family-ledger:install-banner-dismissed";

/**
 * Is the app already running installed/standalone? Checked two ways because
 * neither alone covers every browser:
 *
 *  - `matchMedia("(display-mode: standalone)")` is the standard signal, true
 *    for an installed PWA on Android/desktop Chrome, Edge, etc.
 *  - `navigator.standalone` is Safari's own long-standing non-standard
 *    property, `true` only when an iOS home-screen app is running -- iOS
 *    Safari does not reliably reflect `display-mode` the same way.
 *
 * Either being true means "already installed": nobody needs to be told to
 * install what they are already using.
 */
export function isStandalone(): boolean {
  const matchesDisplayMode =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(display-mode: standalone)").matches;

  const iosStandaloneFlag = (navigator as { standalone?: boolean }).standalone === true;

  return matchesDisplayMode || iosStandaloneFlag;
}

/**
 * Is this iOS (Safari or any other iOS browser)? There is no feature
 * detection for "this platform has no install API" -- `beforeinstallprompt`
 * simply never fires on iOS, which is indistinguishable from "it just
 * hasn't fired yet" (see `install-prompt.ts` module comment and
 * `decideInstallBannerState` below). UA sniffing is normally something to
 * avoid, but it is the only way to positively identify the one platform
 * that needs the manual-instructions path instead of waiting for an event
 * that will never come.
 *
 * Two checks:
 *  - The UA contains "iPad", "iPhone", or "iPod" -- covers iPhone/iPod and
 *    older iPadOS that still identifies itself as iPad.
 *  - iPadOS 13+'s "Mac-that-supports-touch" quirk: modern iPads report a
 *    desktop Safari/macOS user agent, so a touch-capable "MacIntel" is
 *    treated as iPadOS too.
 */
export function isIOS(): boolean {
  const userAgent = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(userAgent)) {
    return true;
  }
  return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
}

/** Which of the banner's three possible UIs applies. */
export type InstallBannerState = "hidden" | "ios-instructions" | "install-button";

export interface InstallBannerInputs {
  readonly standalone: boolean;
  readonly ios: boolean;
  readonly installEvent: BeforeInstallPromptEvent | null;
}

/**
 * Pure decision function for the banner's render state, independent of any
 * DOM/event wiring so it has a plain unit test. See the four render rules
 * this task specifies:
 *
 *  1. Already standalone -> always hidden, regardless of anything else.
 *  2. iOS and not standalone -> always the manual instructions, regardless
 *     of whether a `beforeinstallprompt` event was captured (it never is,
 *     on iOS, but this function does not need to know that -- it just
 *     checks `ios` first).
 *  3. Not iOS, not standalone, event captured -> the Install button.
 *  4. Not iOS, not standalone, no event (yet) -> hidden. There is nothing
 *     actionable to show; a disabled/broken button would be worse than no
 *     button. If the event fires later, the caller re-renders with an
 *     updated `installEvent` and this function will then return
 *     "install-button".
 */
export function decideInstallBannerState(inputs: InstallBannerInputs): InstallBannerState {
  if (inputs.standalone) {
    return "hidden";
  }
  if (inputs.ios) {
    return "ios-instructions";
  }
  return inputs.installEvent !== null ? "install-button" : "hidden";
}

/** Has the user previously dismissed the install banner on this device? */
export function isInstallBannerDismissed(): boolean {
  try {
    return window.localStorage.getItem(INSTALL_BANNER_DISMISSED_KEY) === "1";
  } catch {
    // Private-browsing mode or disabled storage: fail safe to "not
    // dismissed" rather than throwing and breaking the page.
    return false;
  }
}

/** Persist "the user dismissed the install banner" for this device. */
export function setInstallBannerDismissed(): void {
  try {
    window.localStorage.setItem(INSTALL_BANNER_DISMISSED_KEY, "1");
  } catch {
    // Same fail-safe as isInstallBannerDismissed: if storage is unavailable
    // the banner will simply reappear next load, which is acceptable.
  }
}
