import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { cx } from "./cx";
import { Icon } from "./Icon";
import type { IconName } from "./icon-paths";
import { buttonClass, type ButtonSize, type ButtonVariant } from "./styles";

/** A router link that looks exactly like a `Button` (Button itself renders a <button>). */
export function LinkButton({
  to,
  icon,
  variant = "secondary",
  size = "sm",
  fullWidth = false,
  className,
  children,
}: {
  to: string;
  icon?: IconName;
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link to={to} className={cx(buttonClass({ variant, size, fullWidth }), className)}>
      {icon ? <Icon name={icon} /> : null}
      {children}
    </Link>
  );
}
