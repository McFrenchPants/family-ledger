import { toDecimalString, type Cents } from "../../lib/currency";

/**
 * Spoken form of an amount for screen readers, e.g. 18732 -> "187 dollars and
 * 32 cents". Integer/string arithmetic only (via toDecimalString), never a
 * float. Throws TypeError for non-integer input, like the rest of currency.ts.
 */
export function spokenAmount(cents: Cents): string {
  const decimal = toDecimalString(cents);
  const negative = decimal.startsWith("-");
  const [wholeRaw, fraction] = (negative ? decimal.slice(1) : decimal).split(".");
  const whole = wholeRaw.replace(/^0+(?=\d)/, "");
  const centsPart = fraction.replace(/^0(?=\d)/, "");

  const parts: string[] = [];
  if (whole !== "0" || centsPart === "0") {
    parts.push(`${whole} ${whole === "1" ? "dollar" : "dollars"}`);
  }
  if (centsPart !== "0") {
    parts.push(`${centsPart} ${centsPart === "1" ? "cent" : "cents"}`);
  }
  return `${negative ? "minus " : ""}${parts.join(" and ")}`;
}

/**
 * Split a formatted amount into its main part and its fractional part, so
 * the hero variant can render the cents smaller: "$187.32" -> ["$187", ".32"].
 * Locale-tolerant: finds the final separator + two-digit run, and keeps any
 * trailing currency symbol ("187,32 $") in the main part.
 */
export function splitFraction(formatted: string): [main: string, fraction: string] {
  const match = /(\D)(\d{2})(\D*)$/.exec(formatted);
  if (!match || match.index === undefined) return [formatted, ""];
  const [, sep, digits, trailing] = match;
  return [formatted.slice(0, match.index) + trailing, sep + digits];
}
