import { cx } from "./cx";
import { clampProgress } from "./progress";

type ProgressTone = "accent" | "ok" | "warn" | "danger";

const FILL: Record<ProgressTone, string> = {
  accent: "bg-accent",
  ok: "bg-ok",
  warn: "bg-warn",
  danger: "bg-danger",
};

type ProgressBarProps = {
  value: number;
  /** Upper bound; defaults to 100. A non-positive or invalid max is treated as 1. */
  max?: number;
  /** Accessible name (required): what this bar measures. */
  label: string;
  /** Human wording of the value, e.g. "$20 of $40 paid". */
  valueText?: string;
  tone?: ProgressTone;
  className?: string;
};

export function ProgressBar({
  value,
  max = 100,
  label,
  valueText,
  tone = "accent",
  className,
}: ProgressBarProps) {
  const bounded = clampProgress(value, max);
  // Geometry only (a width percentage) -- never a money value.
  const percent = (bounded.value / bounded.max) * 100;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={bounded.max}
      aria-valuenow={bounded.value}
      aria-valuetext={valueText}
      className={cx("h-2 w-full overflow-hidden rounded-full bg-sunken", className)}
    >
      <div
        className={cx(
          "h-full rounded-full transition-[width] duration-progress motion-reduce:transition-none",
          FILL[tone],
        )}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
