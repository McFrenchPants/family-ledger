import * as ToggleGroup from "@radix-ui/react-toggle-group";
import type { ReactNode } from "react";

import { cx } from "./cx";

export type ChoiceOption<T extends string> = {
  value: T;
  /** Visible text; also the accessible name unless `content` replaces it. */
  label: string;
  /** Optional richer content (icon, avatar, status) rendered instead of `label`. */
  content?: ReactNode;
};

type ChoiceChipsProps<T extends string> = {
  /** Accessible name for the group (pair with a visible heading). */
  label: string;
  /** id of a visible element that names the group; preferred over `label` when set. */
  labelledBy?: string;
  /** id of an element describing the group, e.g. its error message. */
  describedBy?: string;
  options: ReadonlyArray<ChoiceOption<T>>;
  /** Selected value, or "" for none. */
  value: T | "";
  onValueChange: (value: T | "") => void;
  /** Allow tapping the selected chip again to clear the choice. Default false. */
  allowEmpty?: boolean;
  /** pill: rounded chips in a horizontal row; tile: icon tiles in a 4-column grid; row: full-width rows. */
  variant?: "pill" | "tile" | "row";
  className?: string;
};

const ITEM: Record<NonNullable<ChoiceChipsProps<string>["variant"]>, string> = {
  pill: cx(
    "inline-flex min-h-touch shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-border-strong bg-surface px-3.5 text-[0.9375rem] font-medium text-ink",
    "data-[state=on]:border-accent data-[state=on]:bg-accent-soft data-[state=on]:font-semibold data-[state=on]:text-accent-text",
  ),
  tile: cx(
    "flex min-h-[68px] flex-col items-center justify-center gap-1 rounded-control border border-border bg-surface px-1 text-[0.8125rem] font-medium text-muted",
    "data-[state=on]:border-accent data-[state=on]:bg-accent-soft data-[state=on]:font-semibold data-[state=on]:text-accent-text",
  ),
  row: cx(
    "flex min-h-[60px] w-full items-center justify-between gap-3 rounded-[14px] border border-border-strong bg-surface px-3.5 py-2 text-left text-body text-ink",
    "data-[state=on]:border-accent data-[state=on]:bg-accent-soft",
  ),
};

const ROOT: Record<NonNullable<ChoiceChipsProps<string>["variant"]>, string> = {
  // Scrolls sideways on a phone rather than wrapping; the negative margin
  // lets chips run to the screen edge inside the 16px gutter.
  pill: "-mx-gutter flex gap-2 overflow-x-auto px-gutter pb-1.5 pt-0.5 [scrollbar-width:none]",
  tile: "grid grid-cols-4 gap-2",
  row: "flex flex-col gap-2",
};

/**
 * Single-choice chips (Radix ToggleGroup type="single": a radiogroup with
 * roving arrow-key focus). The selected state is shown by border, fill and
 * weight together, and announced as "checked" -- never colour alone.
 * Each item carries the `group` class so rich `content` can restyle itself
 * when selected (`group-data-[state=on]:…`).
 */
export function ChoiceChips<T extends string>({
  label,
  labelledBy,
  describedBy,
  options,
  value,
  onValueChange,
  allowEmpty = false,
  variant = "pill",
  className,
}: ChoiceChipsProps<T>) {
  return (
    <ToggleGroup.Root
      type="single"
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      value={value}
      onValueChange={(next) => {
        if (next || allowEmpty) onValueChange(next as T | "");
      }}
      className={cx(ROOT[variant], className)}
    >
      {options.map((option) => (
        <ToggleGroup.Item
          key={option.value}
          value={option.value}
          className={cx(
            "group",
            ITEM[variant],
            "cursor-pointer transition-colors duration-toggle motion-reduce:transition-none",
          )}
        >
          {option.content ?? option.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
