import type { ReactNode } from "react";

import { cx } from "./cx";

type StickyActionBarProps = {
  children: ReactNode;
  className?: string;
};

/**
 * The main action of an entry screen, kept in reach at the bottom of a phone
 * screen. `position: sticky` (not fixed) so it stays in the page's flow: it
 * never covers the last field, needs no padding hacks in the shell, and on
 * browsers that shrink the layout viewport for the on-screen keyboard it
 * rides just above it. Clears the home indicator with the safe-area inset.
 * From 900px up it simply sits under the form, like the mockup.
 */
export function StickyActionBar({ children, className }: StickyActionBarProps) {
  return (
    <div
      data-testid="sticky-action-bar"
      className={cx(
        "sticky bottom-0 z-20 -mx-gutter px-gutter pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3",
        "bg-gradient-to-t from-bg from-70% to-transparent",
        "min-[900px]:static min-[900px]:mx-0 min-[900px]:bg-none min-[900px]:px-0 min-[900px]:pb-0 min-[900px]:pt-4",
        className,
      )}
    >
      {children}
    </div>
  );
}
