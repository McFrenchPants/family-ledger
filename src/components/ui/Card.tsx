import type { HTMLAttributes } from "react";

import { cx } from "./cx";

type CardProps = HTMLAttributes<HTMLElement> & {
  /** Render as a <section> (with its own heading) instead of a plain <div>. */
  as?: "div" | "section" | "article" | "li";
};

/** Surface with a 16px radius and padding; soft shadow in light, border only in dark. */
export function Card({ as: Tag = "div", className, ...rest }: CardProps) {
  return (
    <Tag
      className={cx(
        "rounded-panel border border-border bg-surface p-4 shadow-card",
        className,
      )}
      {...rest}
    />
  );
}
