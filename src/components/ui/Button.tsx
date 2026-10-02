import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

import { cx } from "./cx";
import { Icon } from "./Icon";
import type { IconName } from "./icon-paths";

export type ButtonVariant = "primary" | "ok" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANT: Record<ButtonVariant, string> = {
  primary: "border-accent bg-accent text-on-accent",
  ok: "border-ok-btn bg-ok-btn text-on-ok",
  danger: "border-danger bg-danger text-on-danger",
  secondary: "border-border-strong bg-surface text-ink",
  ghost: "border-transparent bg-transparent text-accent-text",
};

// 44px minimum touch target, 48px main buttons, 56px the screen's main action.
const SIZE: Record<ButtonSize, string> = {
  sm: "min-h-touch px-3.5 text-label",
  md: "min-h-touch-lg px-[18px] text-body",
  lg: "min-h-touch-xl px-5 text-head",
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  /** Shows a busy state; the button is disabled while loading. */
  loading?: boolean;
  /** Optional leading icon (decorative). */
  icon?: IconName;
  children: ReactNode;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "secondary",
    size = "md",
    fullWidth = false,
    loading = false,
    icon,
    disabled,
    type = "button",
    className,
    children,
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      data-variant={variant}
      className={cx(
        "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-control border font-semibold",
        "transition-colors duration-toggle motion-reduce:transition-none",
        "disabled:cursor-not-allowed disabled:opacity-60",
        VARIANT[variant],
        SIZE[size],
        fullWidth && "w-full",
        className,
      )}
      {...rest}
    >
      {loading ? (
        <span
          aria-hidden="true"
          className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none"
        />
      ) : icon ? (
        <Icon name={icon} />
      ) : null}
      {children}
    </button>
  );
});
