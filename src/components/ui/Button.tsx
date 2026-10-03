import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

import { cx } from "./cx";
import { Icon } from "./Icon";
import type { IconName } from "./icon-paths";
import { buttonClass, type ButtonSize, type ButtonVariant } from "./styles";

export type { ButtonSize, ButtonVariant } from "./styles";

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
      className={cx(buttonClass({ variant, size, fullWidth }), className)}
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
