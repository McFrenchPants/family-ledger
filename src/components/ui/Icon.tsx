import type { SVGProps } from "react";

import { cx } from "./cx";
import { ICON_PATHS, type IconName } from "./icon-paths";

type IconProps = Omit<SVGProps<SVGSVGElement>, "children"> & {
  name: IconName;
  /** Pixel size; defaults to 20. */
  size?: number;
  /**
   * Accessible name. Omit for decorative icons (the default), which are
   * hidden from assistive tech because the adjacent text carries meaning.
   */
  label?: string;
};

/** A stroked 24x24 icon that takes its colour from `currentColor`. */
export function Icon({ name, size = 20, label, className, ...rest }: IconProps) {
  const a11y = label
    ? ({ role: "img", "aria-label": label } as const)
    : ({ "aria-hidden": true, focusable: false } as const);
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cx("shrink-0", className)}
      data-icon={name}
      {...a11y}
      {...rest}
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}
