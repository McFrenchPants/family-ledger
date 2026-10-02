import type { ReactNode } from "react";

import { cx } from "./cx";
import { Icon } from "./Icon";
import type { IconName } from "./icon-paths";
import { TONE_CLASSES } from "./status";

type InlineStatusTone = "info" | "ok" | "warn" | "danger";

const ICON: Record<InlineStatusTone, IconName> = {
  info: "bell",
  ok: "checkc",
  warn: "clock",
  danger: "alert",
};

type InlineStatusProps = {
  tone?: InlineStatusTone;
  children: ReactNode;
  className?: string;
};

/**
 * The app's "toast": an inline status message that stays where the action
 * happened. A polite live region, so screen readers announce it without
 * interrupting.
 */
export function InlineStatus({ tone = "info", children, className }: InlineStatusProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-tone={tone}
      className={cx(
        "flex items-start gap-2 rounded-control px-3 py-2.5 text-label font-medium",
        TONE_CLASSES[tone],
        className,
      )}
    >
      <Icon name={ICON[tone]} size={18} className="mt-px" />
      <div>{children}</div>
    </div>
  );
}
