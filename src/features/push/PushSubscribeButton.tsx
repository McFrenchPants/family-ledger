import { useEffect, useState } from "react";

import { base64UrlToUint8Array, decideInitialPushState, isPushSupported } from "./push-subscribe";
import type { PushSubscribeState } from "./push-subscribe";
import { isIOS, isStandalone } from "../pwa/install-prompt";
import { useMembership } from "../auth/membership-context";
import { supabase } from "../../lib/supabase";

/**
 * N4.4 subscribe-to-push affordance. Rendered once from `RootLayout` (like
 * `InstallBanner`) so it's available from both the Parent and Child
 * dashboards without duplicating a per-page component -- this is a per-
 * device opt-in any active member should be able to trigger from wherever
 * their own dashboard is, not a Parent-only control and not a dedicated
 * page/route.
 *
 * Scope: subscribe only. No preferences UI, no per-notification-type
 * toggles, and no unsubscribe button -- deliberately out of scope for N4.4
 * (see that task's notes; unsubscribe is a plausible immediate follow-up
 * but is left out here rather than snuck in).
 */
// `pushManager.subscribe()` in particular has no built-in timeout and can
// hang indefinitely on some real devices (e.g. Android Chrome waiting on a
// stalled Google Play Services / FCM registration) instead of rejecting --
// observed during N4.6 hardware validation as a button stuck on "Enabling…"
// forever with no error. Race every awaited step below against this so a
// stall surfaces as a normal, retryable error state instead of a silent hang.
const SUBSCRIBE_TIMEOUT_MS = 15_000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

export function PushSubscribeButton() {
  const membership = useMembership();
  const [state, setState] = useState<PushSubscribeState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    setState(
      decideInitialPushState({
        supported: isPushSupported(),
        ios: isIOS(),
        standalone: isStandalone(),
      }),
    );
  }, []);

  if (membership.status !== "loaded") {
    return null;
  }

  const memberId = membership.membership.memberId;

  async function handleSubscribeClick() {
    setErrorMessage(null);
    setState("requesting");

    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setState("denied");
      return;
    }

    setState("subscribing");

    try {
      const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
      if (!vapidPublicKey) {
        throw new Error("Push notifications are not configured for this deployment.");
      }

      const registration = await withTimeout(
        navigator.serviceWorker.ready,
        SUBSCRIBE_TIMEOUT_MS,
        "Timed out waiting for the service worker to become ready.",
      );
      const subscription = await withTimeout(
        registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64UrlToUint8Array(vapidPublicKey),
        }),
        SUBSCRIBE_TIMEOUT_MS,
        "Timed out registering this device for push notifications. This step talks to your browser's push service (e.g. Google Play Services on Android) -- check your connection and try again.",
      );

      const { keys, endpoint } = subscription.toJSON();
      if (!keys?.p256dh || !keys?.auth) {
        throw new Error("The browser did not return the expected subscription keys.");
      }

      const { error } = await supabase.from("push_subscriptions").upsert(
        {
          household_member_id: memberId,
          endpoint,
          p256dh: keys.p256dh,
          auth: keys.auth,
        },
        { onConflict: "endpoint" },
      );

      if (error) {
        setErrorMessage(error.message);
        setState("error");
        return;
      }

      setState("subscribed");
    } catch (caught) {
      setErrorMessage(
        caught instanceof Error ? caught.message : "Could not enable notifications.",
      );
      setState("error");
    }
  }

  if (state === "unsupported") {
    return (
      <div className="mb-4 rounded-card border border-surface-border bg-surface-sunken p-3">
        <p className="text-label text-ink-muted">
          This browser does not support push notifications.
        </p>
      </div>
    );
  }

  if (state === "ios-install-required") {
    return (
      <div className="mb-4 rounded-card border border-surface-border bg-surface-sunken p-3">
        <p className="text-label text-ink-muted">
          To receive notifications on this device, first install Family Ledger to your Home
          Screen (Share, then "Add to Home Screen"), then open it from there.
        </p>
      </div>
    );
  }

  if (state === "subscribed") {
    return (
      <div className="mb-4 rounded-card border border-accent/40 bg-accent-soft p-3">
        <p role="status" className="text-label text-accent">
          Notifications enabled on this device.
        </p>
      </div>
    );
  }

  return (
    <div className="mb-4 flex flex-col gap-2 rounded-card border border-surface-border bg-surface-sunken p-3">
      <p className="text-label text-ink-muted">Enable notifications on this device.</p>

      {state === "denied" && (
        <p role="alert" className="text-label text-owed">
          Notification permission was denied. Enable notifications for this site in your browser
          settings, then try again.
        </p>
      )}

      {state === "error" && (
        <p role="alert" className="text-label text-owed">
          {errorMessage ?? "Could not enable notifications."}
        </p>
      )}

      <button
        type="button"
        onClick={() => void handleSubscribeClick()}
        disabled={state === "requesting" || state === "subscribing"}
        className="inline-flex min-h-touch items-center justify-center self-start rounded-card bg-accent px-4 text-body font-medium text-white disabled:opacity-60"
      >
        {state === "requesting" || state === "subscribing" ? "Enabling…" : "Enable notifications"}
      </button>
    </div>
  );
}
