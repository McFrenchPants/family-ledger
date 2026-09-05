import { useEffect, useState } from "react";

import {
  decideInstallBannerState,
  isInstallBannerDismissed,
  isIOS,
  isStandalone,
  setInstallBannerDismissed,
} from "./install-prompt";
import type { BeforeInstallPromptEvent } from "./install-prompt";

/**
 * S4.4 mobile install onboarding. Rendered once from `RootLayout` (see that
 * file) so both the Parent and Child dashboards -- and every other route --
 * get install guidance without duplicating this component per page.
 *
 * Not a `role="alert"`/`role="status"` element like the error/loading states
 * elsewhere in this app (`RecordPaymentPage.tsx`, etc.): those communicate
 * the *result* of an action. This banner is standing, dismissible, ambient
 * UI, not a status report, so it is a plain `<div>` with an ordinary
 * heading/paragraph/button -- keyboard-reachable via normal tab order.
 *
 * No entrance animation: a static show/hide sidesteps `prefers-reduced-
 * motion` entirely rather than needing to respect it.
 */
export function InstallBanner() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(true);
  const [standalone, setStandalone] = useState(true);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    // Computed on mount only: none of these change over the component's
    // lifetime (a page doesn't flip in or out of standalone mode, or
    // between iOS and not-iOS, while running), so there's nothing to
    // re-check on every render.
    setDismissed(isInstallBannerDismissed());
    setStandalone(isStandalone());
    setIos(isIOS());

    function handleBeforeInstallPrompt(event: Event) {
      // Suppress the browser's own mini-infobar; this component is the UI
      // for triggering install instead.
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    }

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    };
  }, []);

  if (dismissed) {
    return null;
  }

  const state = decideInstallBannerState({ standalone, ios, installEvent });
  if (state === "hidden") {
    return null;
  }

  function handleDismiss() {
    setInstallBannerDismissed();
    setDismissed(true);
  }

  async function handleInstallClick() {
    if (!installEvent) {
      return;
    }
    await installEvent.prompt();
    // A beforeinstallprompt event can only be used once (accepted or
    // dismissed); resolving userChoice doesn't matter for this UI's
    // purposes, but the stashed event must be cleared either way so a
    // second click can't call .prompt() on an already-consumed event.
    await installEvent.userChoice;
    setInstallEvent(null);
  }

  return (
    <div className="mb-4 flex flex-col gap-2 rounded-card border border-accent/40 bg-accent-soft p-3">
      {state === "ios-instructions" ? (
        <>
          <h2 className="text-label font-semibold text-accent">Install Family Ledger</h2>
          <p className="text-label text-ink-muted">
            Tap the Share button, then "Add to Home Screen", to install this app on your device.
          </p>
        </>
      ) : (
        <>
          <h2 className="text-label font-semibold text-accent">Install Family Ledger</h2>
          <p className="text-label text-ink-muted">
            Install this app on your device for quicker, full-screen access.
          </p>
          <button
            type="button"
            onClick={() => void handleInstallClick()}
            className="inline-flex min-h-touch items-center justify-center rounded-card bg-accent px-4 text-body font-medium text-white"
          >
            Install
          </button>
        </>
      )}
      <button
        type="button"
        onClick={handleDismiss}
        className="self-start text-label text-ink-muted underline"
      >
        Dismiss
      </button>
    </div>
  );
}
