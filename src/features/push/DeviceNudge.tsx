import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { Icon } from "../../components/ui/Icon";
import {
  INSTALL_NUDGE_ACTION,
  INSTALL_NUDGE_TEXT,
  PUSH_NUDGE_ACTION,
  PUSH_NUDGE_TEXT,
} from "../../lib/messages";
import { isIOS, isStandalone } from "../pwa/install-prompt";
import {
  currentNotificationPermission,
  decideDeviceNudge,
  detectPushSubscribed,
  nextDismissal,
  readNudgeDismissal,
  writeNudgeDismissal,
} from "./device-nudge";
import { isPushSupported } from "./push-subscribe";

/**
 * One quiet line at the bottom of Home. "Turn on" / "Show me" go to Settings,
 * the permanent home of the install and reminder controls. Rules live in
 * `device-nudge.ts`.
 */
export function DeviceNudge({ needsAttention }: { needsAttention: boolean }) {
  const [environment] = useState(() => ({
    pushSupported: isPushSupported(),
    ios: isIOS(),
    standalone: isStandalone(),
    permission: currentNotificationPermission(),
  }));
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [dismissal, setDismissal] = useState(() => readNudgeDismissal());

  useEffect(() => {
    if (!environment.pushSupported) return;
    let active = true;
    void detectPushSubscribed().then((value) => {
      if (active) setSubscribed(value);
    });
    return () => {
      active = false;
    };
  }, [environment.pushSupported]);

  const kind = decideDeviceNudge({
    ...environment,
    subscribed,
    needsAttention,
    dismissal,
    now: Date.now(),
  });

  if (kind === "none") return null;

  function dismiss() {
    const next = nextDismissal(dismissal, Date.now());
    writeNudgeDismissal(next);
    setDismissal(next);
  }

  return (
    <div data-testid="device-nudge" className="flex items-center gap-1 text-label text-muted">
      <Icon name="bell" size={18} />
      <span className="ml-1">{kind === "install" ? INSTALL_NUDGE_TEXT : PUSH_NUDGE_TEXT}</span>
      <Link
        to="/settings"
        className="inline-flex min-h-touch items-center rounded-control px-2 font-semibold text-accent-text"
      >
        {kind === "install" ? INSTALL_NUDGE_ACTION : PUSH_NUDGE_ACTION}
      </Link>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Not now, dismiss"
        className="ml-auto grid min-h-touch min-w-touch place-items-center rounded-control text-subtle transition-colors hover:bg-sunken hover:text-ink motion-reduce:transition-none"
      >
        <Icon name="x" size={18} />
      </button>
    </div>
  );
}
