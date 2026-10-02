import type { IconName } from "./icon-paths";

/**
 * The status vocabulary (design spec): one source of truth for which icon
 * and colour each status uses. The label text is supplied by the caller
 * because it varies by role. A chip always shows icon + text, never colour
 * alone.
 */
export type StatusTone = "danger" | "warn" | "info" | "ok" | "neutral";

export type StatusKind =
  "overdue" | "due" | "partial" | "satisfied" | "upcoming" | "waived" | "none" | "clear";

export const STATUS_KINDS: Record<StatusKind, { icon: IconName; tone: StatusTone }> = {
  overdue: { icon: "alert", tone: "danger" },
  due: { icon: "clock", tone: "warn" },
  partial: { icon: "half", tone: "info" },
  satisfied: { icon: "checkc", tone: "ok" },
  upcoming: { icon: "cal", tone: "neutral" },
  waived: { icon: "dash", tone: "neutral" },
  none: { icon: "dash", tone: "neutral" },
  clear: { icon: "checkc", tone: "ok" },
};

/** Text-on-tint classes per tone. Every pair is covered by the contrast test. */
export const TONE_CLASSES: Record<StatusTone, string> = {
  danger: "bg-danger-soft text-danger",
  warn: "bg-warn-soft text-warn",
  info: "bg-accent-soft text-accent-text",
  ok: "bg-ok-soft text-ok",
  neutral: "bg-sunken text-muted",
};
