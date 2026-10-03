import { cx } from "./cx";

/**
 * Class strings shared by more than one primitive, so a <Link> that looks
 * like a button, or a raw <select> next to a `Field`, can't drift from the
 * real thing.
 */

export type ButtonVariant = "primary" | "ok" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg" | "icon";

// Hover only when enabled (links never match :disabled, so they always get it).
const VARIANT: Record<ButtonVariant, string> = {
  primary: "border-accent bg-accent text-on-accent [&:not(:disabled)]:hover:bg-accent/90",
  ok: "border-ok-btn bg-ok-btn text-on-ok [&:not(:disabled)]:hover:bg-ok-btn/90",
  danger: "border-danger bg-danger text-on-danger [&:not(:disabled)]:hover:bg-danger/90",
  secondary:
    "border-border-strong bg-surface text-ink [&:not(:disabled)]:hover:bg-sunken",
  ghost:
    "border-transparent bg-transparent text-accent-text [&:not(:disabled)]:hover:bg-accent-soft",
};

// 44px minimum touch target, 48px main buttons, 56px the screen's main action;
// `icon` is a 44px square holding only an icon (its words go in sr-only text).
const SIZE: Record<ButtonSize, string> = {
  sm: "min-h-touch px-3.5 text-label",
  md: "min-h-touch-lg px-[18px] text-body",
  lg: "min-h-touch-xl px-5 text-head",
  icon: "h-touch w-touch shrink-0 px-0",
};

export function buttonClass({
  variant = "secondary",
  size = "md",
  fullWidth = false,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
} = {}): string {
  return cx(
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-control border font-semibold",
    "transition-colors duration-toggle motion-reduce:transition-none",
    "disabled:cursor-not-allowed disabled:opacity-60",
    VARIANT[variant],
    SIZE[size],
    fullWidth && "w-full",
  );
}

/** Text inputs and selects: 48px tall, 12px radius, 16px text (no iOS zoom). No border colour. */
export const INPUT_BASE_CLASS =
  "min-h-touch-lg rounded-control border bg-surface px-3 text-body text-ink placeholder:text-subtle disabled:opacity-60";

/** `INPUT_BASE_CLASS` with the normal (not-in-error) border. */
export const INPUT_CLASS = `${INPUT_BASE_CLASS} border-border-strong`;

/** A form label (matches the mockups: 14px, semibold, muted). */
export const LABEL_CLASS = "text-label font-semibold text-muted";
