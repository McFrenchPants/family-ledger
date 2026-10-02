import { useEffect, useState } from "react";

import { decideInstallBannerState, isIOS, isStandalone } from "./install-prompt";
import type { BeforeInstallPromptEvent } from "./install-prompt";

/**
 * Install row for the Settings page (formerly a banner above every page).
 * Same detection and state machine as before (`decideInstallBannerState`);
 * only the presentation moved. It is a permanent row, so there is no
 * dismiss button.
 *
 * States: already installed (standalone), iOS (manual instructions), install
 * button (browser fired `beforeinstallprompt`), or a plain note when the
 * browser has not offered an install prompt (yet).
 */
export function InstallRow() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [standalone, setStandalone] = useState(false);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    setStandalone(isStandalone());
    setIos(isIOS());

    function handleBeforeInstallPrompt(event: Event) {
      // Suppress the browser's own mini-infobar; this row is the UI for
      // triggering install instead.
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    }

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    };
  }, []);

  const state = decideInstallBannerState({ standalone, ios, installEvent });

  async function handleInstallClick() {
    if (!installEvent) {
      return;
    }
    await installEvent.prompt();
    // A beforeinstallprompt event can only be used once; clear it either way.
    await installEvent.userChoice;
    setInstallEvent(null);
  }

  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-label font-semibold text-ink">Install Family Ledger</h4>
      {standalone ? (
        <p className="text-label text-ink-muted">Installed on this device.</p>
      ) : state === "ios-instructions" ? (
        <p className="text-label text-ink-muted">
          Tap Share, then Add to Home Screen, to install this app on your device.
        </p>
      ) : state === "install-button" ? (
        <>
          <p className="text-label text-ink-muted">
            Install this app on your device for quicker, full-screen access.
          </p>
          <button
            type="button"
            onClick={() => void handleInstallClick()}
            className="inline-flex min-h-touch items-center justify-center self-start rounded-card bg-accent px-4 text-body font-medium text-white"
          >
            Install
          </button>
        </>
      ) : (
        <p className="text-label text-ink-muted">
          Your browser has not offered an install option yet. You can also look for Install or Add
          to Home Screen in the browser menu.
        </p>
      )}
    </div>
  );
}
