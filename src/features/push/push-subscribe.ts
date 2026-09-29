/**
 * Push subscription support detection and pure helpers for N4.4.
 *
 * Kept DOM-event-free (aside from feature checks against ambient globals)
 * so the branching logic has a plain unit test, mirroring
 * `../pwa/install-prompt.ts`'s split between pure decision logic and the
 * thin component that wires it up (`PushSubscribeButton.tsx`).
 */

/** Which of the button's render states applies. */
export type PushSubscribeState =
  | "unsupported"
  | "ios-install-required"
  | "idle"
  | "requesting"
  | "denied"
  | "subscribing"
  | "subscribed"
  | "error";

export interface PushSupportInputs {
  readonly supported: boolean;
  readonly ios: boolean;
  readonly standalone: boolean;
}

/**
 * Decides between the three "can't proceed normally" states this task
 * specifies and "idle" (ready to show the subscribe button):
 *
 *  1. No `Notification`/`PushManager`/`serviceWorker` support at all -> a
 *     plain informational state, never a button that can only fail.
 *  2. iOS Safari not running standalone -> explain the home-screen-install
 *     requirement (ARCHITECTURE.md §12.3) instead of offering a button.
 *  3. Otherwise -> "idle", the normal subscribe-button state.
 */
export function decideInitialPushState(inputs: PushSupportInputs): PushSubscribeState {
  if (!inputs.supported) {
    return "unsupported";
  }
  if (inputs.ios && !inputs.standalone) {
    return "ios-install-required";
  }
  return "idle";
}

/** Does this browser support the Notification/Push/service-worker APIs this feature needs? */
export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "Notification" in window &&
    "PushManager" in window &&
    "serviceWorker" in navigator
  );
}

/**
 * Converts a base64url-encoded string (the format VAPID public keys and
 * `VITE_VAPID_PUBLIC_KEY` arrive in) to the raw `Uint8Array` the Push API's
 * `applicationServerKey` option requires.
 *
 * Standard `atob` only understands base64 (`+`/`/`), not base64url
 * (`-`/`_`), and needs `=` padding restored -- both of which
 * `PushManager.subscribe` callers hitting a VAPID key run into, hence this
 * well-known small conversion helper (no new dependency needed for it).
 */
export function base64UrlToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");

  const rawData = atob(base64);
  const outputArray = new Uint8Array(new ArrayBuffer(rawData.length));
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
