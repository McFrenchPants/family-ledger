import * as ToggleGroup from "@radix-ui/react-toggle-group";

import { cx } from "./cx";
import { Icon } from "./Icon";

export type ToggleOption<T extends string> = { value: T; label: string };

type SegmentedProps<T extends string> = {
  /** Accessible name for the whole group. */
  label: string;
  options: ReadonlyArray<ToggleOption<T>>;
  value: T;
  onValueChange: (value: T) => void;
  className?: string;
};

/**
 * Single-choice segmented control (Radix ToggleGroup, arrow-key roving
 * focus). Always has exactly one selected option: Radix would let a click on
 * the active segment clear the value, which we ignore. The selected
 * segment uses `--raised`, which stays clearly lighter than the sunken
 * track in dark mode too.
 */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onValueChange,
  className,
}: SegmentedProps<T>) {
  return (
    <ToggleGroup.Root
      type="single"
      aria-label={label}
      value={value}
      onValueChange={(next) => {
        if (next) onValueChange(next as T);
      }}
      className={cx("flex w-full gap-1 rounded-control bg-sunken p-1", className)}
    >
      {options.map((option) => (
        <ToggleGroup.Item
          key={option.value}
          value={option.value}
          className={cx(
            "min-h-touch flex-1 rounded-[0.5rem] px-3 text-label font-semibold text-muted",
            "transition-colors duration-toggle motion-reduce:transition-none",
            "data-[state=on]:bg-raised data-[state=on]:text-ink data-[state=on]:shadow-card",
          )}
        >
          {option.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}

type ChipGroupProps<T extends string> = {
  label: string;
  options: ReadonlyArray<ToggleOption<T>>;
  /** Selected values (multi-select filter chips). */
  value: T[];
  onValueChange: (value: T[]) => void;
  className?: string;
};

/** Multi-select pill toggles (filters). Selected state shows a check, not colour alone. */
export function ChipGroup<T extends string>({
  label,
  options,
  value,
  onValueChange,
  className,
}: ChipGroupProps<T>) {
  return (
    <ToggleGroup.Root
      type="multiple"
      aria-label={label}
      value={value}
      onValueChange={(next) => onValueChange(next as T[])}
      className={cx("flex flex-wrap gap-2", className)}
    >
      {options.map((option) => (
        <ToggleGroup.Item
          key={option.value}
          value={option.value}
          className={cx(
            "group inline-flex min-h-touch items-center gap-1.5 rounded-full border border-border-strong bg-surface px-4 text-label font-semibold text-ink",
            "transition-colors duration-toggle motion-reduce:transition-none",
            "data-[state=on]:border-accent data-[state=on]:bg-accent-soft data-[state=on]:text-accent-text",
          )}
        >
          <Icon name="check" size={16} className="hidden group-data-[state=on]:block" />
          {option.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
