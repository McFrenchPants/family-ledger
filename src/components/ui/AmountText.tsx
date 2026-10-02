import type { HTMLAttributes } from "react";

import { formatCents, type Cents } from "../../lib/currency";
import { cx } from "./cx";
import { spokenAmount, splitFraction } from "./money-speech";

/** True minus sign (U+2212), not a hyphen. */
export const MINUS = "−";

export type AmountKind =
  /** As given; negative values show a true minus. */
  | "plain"
  /** A charge: "+$42.17" in ink. Sign comes from `kind`, magnitude from |cents|. */
  | "expense"
  /** A payment: "−$25.00" in the ok colour. */
  | "payment";

type AmountTextProps = Omit<HTMLAttributes<HTMLSpanElement>, "children"> & {
  /** Integer cents only. Non-integers throw (via formatCents). */
  cents: Cents;
  /** hero: one big amount per screen with small cents; list: full-size, tabular. */
  variant?: "hero" | "list";
  kind?: AmountKind;
  /** Words appended to the spoken label, e.g. "owed" -> "187 dollars and 32 cents owed". */
  srContext?: string;
  /** Colour override. Defaults: payment -> ok, everything else -> ink. */
  tone?: "ink" | "ok" | "danger" | "inherit";
  /** BCP 47 locale passed to formatCents; defaults to the runtime locale like the rest of the app. */
  locale?: string;
};

const TONE = {
  ink: "text-ink",
  ok: "text-ok",
  danger: "text-danger",
  inherit: "",
} as const;

/** Displays money. All formatting goes through formatCents. */
export function AmountText({
  cents,
  variant = "list",
  kind = "plain",
  srContext,
  tone,
  locale,
  className,
  ...rest
}: AmountTextProps) {
  const signed = kind !== "plain";
  const magnitude = signed ? Math.abs(cents) : cents;
  // formatCents validates integer input and throws TypeError otherwise.
  let formatted = formatCents(magnitude, { locale }).replace("-", MINUS);
  if (kind === "expense") formatted = `+${formatted}`;
  if (kind === "payment") formatted = `${MINUS}${formatted}`;

  const spoken = [
    kind === "expense" ? "plus" : kind === "payment" ? "minus" : null,
    spokenAmount(magnitude),
    srContext,
  ]
    .filter(Boolean)
    .join(" ");

  const [main, fraction] =
    variant === "hero" ? splitFraction(formatted) : [formatted, ""];

  return (
    <span
      role="img"
      aria-label={spoken}
      className={cx(
        "tabular whitespace-nowrap tabular-nums",
        variant === "hero" ? "text-display tracking-tight" : "text-body font-semibold",
        TONE[tone ?? (kind === "payment" ? "ok" : "ink")],
        className,
      )}
      data-kind={kind}
      {...rest}
    >
      <span aria-hidden="true">
        {main}
        {fraction ? (
          <span className="ml-px align-[0.32em] text-[0.6em] font-semibold">
            {fraction}
          </span>
        ) : null}
      </span>
    </span>
  );
}
