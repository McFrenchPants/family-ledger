/**
 * Money handling for Family Ledger.
 *
 * STANDING PROJECT RULE: money is integer cents. It is `bigint` in PostgreSQL
 * and a `number` of cents in TypeScript. Binary floating point must never touch
 * a monetary value during parsing, storage, or arithmetic.
 *
 * The specific bug this module exists to prevent:
 *
 *     Math.round(Number("8.29") * 100)   // 8.29 * 100 === 828.9999999999999
 *     Math.trunc(Number("8.29") * 100)   // => 828, one cent lost
 *
 * `parseMoney` therefore never multiplies. It splits the input string on the
 * decimal point, pads the fractional part to exactly two characters, and
 * concatenates the two digit runs into a single integer literal that is
 * converted with `BigInt`. No float is produced at any step.
 *
 * ---------------------------------------------------------------------------
 * Documented parsing decisions (each has a test in currency.test.ts)
 * ---------------------------------------------------------------------------
 *
 * 1. MORE THAN 2 DECIMALS IS REJECTED (`"12.999"` -> `too_many_decimals`).
 *    Silently rounding a user's typed amount changes a financial figure without
 *    telling them. The ledger is append-oriented and transactions are immutable
 *    after creation, so a wrong-by-a-cent row is expensive to correct. Better to
 *    make the user retype. `"12.90"` and `"12.9"` are both fine; only a third
 *    significant fractional digit is refused, so `"12.990"` is rejected too
 *    (we do not special-case a trailing zero -- that ambiguity is not worth the
 *    surface area).
 *
 * 2. EMPTY / WHITESPACE-ONLY IS REJECTED (`empty`). Surrounding whitespace is
 *    trimmed first, because it is almost always a paste artifact, but internal
 *    whitespace (`"1 2"`) is junk and rejected as `malformed`.
 *
 * 3. THOUSANDS SEPARATORS ARE REJECTED (`"1,234.56"` -> `malformed`). Grouping
 *    characters are locale-dependent and genuinely ambiguous: in much of Europe
 *    `"1.234,56"` and `"1,234"` mean something different than they do in en-US.
 *    Guessing wrong is a 100x error. Input is accepted in one canonical form --
 *    optional sign, digits, optional `.`, up to two digits -- and the UI is
 *    responsible for steering the user there. Note this is asymmetric with
 *    `formatCents`, which *does* emit locale grouping for display; display and
 *    input are deliberately not the same grammar.
 *
 * 4. SIGNS ARE ACCEPTED AND PRESERVED. A leading `-` or `+` parses, and
 *    `parseMoney` returns signed cents. This module deliberately does NOT
 *    enforce "a Child may only enter positive expenses" -- that is an
 *    authorization rule, and per the project's standing rules authorization is
 *    enforced by PostgreSQL (RLS, CHECK constraints, security-definer
 *    functions), never by client-side code. A client-side positivity check here
 *    would be a UX affordance masquerading as a control. Callers that want a
 *    non-negative value should use `parseMoney` and then check `cents`, or use
 *    `parsePositiveMoney`, understanding that it is a UX nicety only.
 *
 * 5. A MISSING INTEGER PART OR MISSING FRACTION IS FINE: `".50"` -> 50,
 *    `"42"` -> 4200, `"42."` -> 4200. A bare `"."` or a bare sign is
 *    `malformed`. Multiple decimal points are `malformed`.
 *
 * 6. NEGATIVE ZERO IS NORMALISED: `"-0.00"` -> `0`, never `-0`. `Object.is(-0, 0)`
 *    is false and `-0` serialises to `0` in JSON, so letting it escape invites a
 *    comparison bug downstream.
 *
 * 7. MAGNITUDE IS CAPPED at `MAX_SAFE_CENTS` (`Number.MAX_SAFE_INTEGER`).
 *    Parsing happens in `BigInt`, so the cap is a deliberate boundary check at
 *    the point of conversion to `number` rather than a silent precision loss.
 *    For a household ledger this ceiling is ~90 trillion dollars; anything
 *    approaching it is a typo or an attack, not a real amount.
 */

/** Integer cents. Always a whole number; never a fractional or float value. */
export type Cents = number;

/** The largest magnitude, in cents, representable exactly as a JS `number`. */
export const MAX_SAFE_CENTS: Cents = Number.MAX_SAFE_INTEGER;

/** Why a string could not be read as an amount of money. */
export type MoneyParseErrorCode =
  /** Input was empty or only whitespace. */
  | "empty"
  /** Input was not `[+-]?digits[.digits]` -- junk, grouping separators, extra dots. */
  | "malformed"
  /** More than two fractional digits; we refuse to round the user's money silently. */
  | "too_many_decimals"
  /** Magnitude exceeds `MAX_SAFE_CENTS`. */
  | "out_of_range"
  /**
   * Well-formed, but negative where the call site only accepts positives
   * (`parsePositiveMoney`). Distinct from `malformed` on purpose: the user
   * typed a perfectly valid number, so the UI should say "amount must be
   * positive", not "that isn't a valid amount". Still a UX affordance, never
   * an authorization control -- see module comment, decision 4.
   */
  | "negative_not_allowed";

/**
 * Result of parsing money. A discriminated union so that failure cannot be
 * silently treated as a number: there is no `NaN` or `null` sentinel to leak
 * into arithmetic. `result.cents` does not exist until `result.ok` is narrowed
 * to `true`, which the compiler enforces.
 */
export type MoneyParseResult =
  | { readonly ok: true; readonly cents: Cents }
  | { readonly ok: false; readonly code: MoneyParseErrorCode; readonly message: string };

/** Thrown by `parseMoneyOrThrow`. Carries the machine-readable code. */
export class MoneyParseError extends Error {
  readonly code: MoneyParseErrorCode;
  readonly input: string;

  constructor(code: MoneyParseErrorCode, message: string, input: string) {
    super(message);
    this.name = "MoneyParseError";
    this.code = code;
    this.input = input;
  }
}

const failure = (code: MoneyParseErrorCode, message: string): MoneyParseResult => ({
  ok: false,
  code,
  message,
});

/**
 * Canonical input grammar: optional sign, then either `digits[.digits?]` or
 * `.digits`. Deliberately no grouping separators, no exponent, no currency
 * symbol, no internal whitespace. The fractional-digit *count* is checked
 * separately so that "you typed too many decimals" is a distinct, actionable
 * error rather than a generic "that is not a number".
 */
const MONEY_PATTERN = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))$/;

/**
 * Parse a user-entered decimal string into integer cents.
 *
 * Decimal-safe by construction: the digits are recombined as an integer and
 * converted with `BigInt`. No multiplication by 100 and no `Number()` on a
 * fractional string ever occurs.
 *
 * @example
 * parseMoney("8.29")    // { ok: true, cents: 829 }   <- not 828
 * parseMoney("42")      // { ok: true, cents: 4200 }
 * parseMoney(".50")     // { ok: true, cents: 50 }
 * parseMoney("12.999")  // { ok: false, code: "too_many_decimals" }
 * parseMoney("1,234.56")// { ok: false, code: "malformed" }
 */
export function parseMoney(input: string): MoneyParseResult {
  if (typeof input !== "string") {
    return failure("malformed", "Amount must be text.");
  }

  const trimmed = input.trim();
  if (trimmed === "") {
    return failure("empty", "Enter an amount.");
  }

  const match = MONEY_PATTERN.exec(trimmed);
  if (match === null) {
    return failure(
      "malformed",
      "Enter a plain amount such as 12.34 (no commas, spaces, or currency symbols).",
    );
  }

  const sign = match[1] === "-" ? -1n : 1n;
  // Exactly one of group 2 (leading digits) / group 4 (".50" form) is present.
  const wholePart = match[2] ?? "";
  const fractionPart = match[2] !== undefined ? (match[3] ?? "") : (match[4] ?? "");

  if (fractionPart.length > 2) {
    return failure("too_many_decimals", "Amounts can have at most 2 decimal places.");
  }

  // String surgery only. `padEnd` turns "5" into "50" and "" into "00", so the
  // concatenation below is always <whole><exactly two fraction digits>, i.e. the
  // literal integer number of cents.
  const centsLiteral = `${wholePart === "" ? "0" : wholePart}${fractionPart.padEnd(2, "0")}`;
  const magnitude = BigInt(centsLiteral);

  if (magnitude > BigInt(MAX_SAFE_CENTS)) {
    return failure("out_of_range", "That amount is too large.");
  }

  const signed = sign * magnitude;
  // `Number(0n)` is +0, so this also normalises "-0.00" away from -0.
  return { ok: true, cents: Number(signed) };
}

/**
 * `parseMoney`, but throws a typed `MoneyParseError` instead of returning a
 * result. For call sites (mostly tests and internal helpers) where a parse
 * failure is a programming error rather than user input.
 */
export function parseMoneyOrThrow(input: string): Cents {
  const result = parseMoney(input);
  if (!result.ok) {
    throw new MoneyParseError(result.code, result.message, input);
  }
  return result.cents;
}

/**
 * `parseMoney` that additionally rejects negative amounts.
 *
 * UX affordance ONLY. The real "a Child cannot reduce a balance" rule is
 * enforced by the database; see the module comment, decision 4.
 */
export function parsePositiveMoney(input: string): MoneyParseResult {
  const result = parseMoney(input);
  if (result.ok && result.cents < 0) {
    return failure("negative_not_allowed", "Amount must not be negative.");
  }
  return result;
}

/**
 * Render integer cents as a plain decimal string, e.g. `829` -> `"8.29"`,
 * `-5` -> `"-0.05"`. Pure integer/string arithmetic; no float, no locale.
 *
 * This is the value to send to an API, put in a test assertion, or hand to
 * `Intl` -- not the value to show a user. Use `formatCents` for display.
 */
export function toDecimalString(cents: Cents): string {
  if (!Number.isInteger(cents)) {
    throw new TypeError(`Cents must be an integer, received ${String(cents)}.`);
  }
  const negative = cents < 0;
  const digits = Math.abs(cents).toString().padStart(3, "0");
  const whole = digits.slice(0, -2);
  const fraction = digits.slice(-2);
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

export interface FormatCentsOptions {
  /** ISO 4217 code. Defaults to USD. */
  readonly currency?: string;
  /** BCP 47 locale tag. Defaults to the runtime's locale. */
  readonly locale?: string;
  /** Emit `"12.34"` instead of `"$12.34"`. */
  readonly omitCurrencySymbol?: boolean;
}

/**
 * `Intl.NumberFormat` accepts a decimal *string* for arbitrary-precision
 * formatting (the ES2023 "Intl.NumberFormat V3" proposal), but the ES2022 lib
 * this project compiles against still types `format` as `(value: number)`.
 * This interface describes the wider runtime capability so we can use it
 * without `any` and without widening the whole `lib` setting.
 */
interface StringCapableNumberFormat {
  format(value: string): string;
}

/**
 * Feature-detected once. Where the runtime supports string input we never
 * create a float at all. Where it does not (older Safari), we fall back to
 * `Number(decimalString)`.
 *
 * That fallback is lossy at the top of the permitted range, and the
 * `MAX_SAFE_CENTS` cap does NOT rescue it -- the cap is exactly where it
 * breaks. Measured:
 *
 *     format("90071992547409.91")         // "90,071,992,547,409.91"
 *     format(Number("90071992547409.91")) // "90,071,992,547,409.90"  <- off by 1c
 *
 * The nearest double to a 2-decimal value re-formats to itself only while the
 * value has enough spare mantissa bits; near `Number.MAX_SAFE_INTEGER` it does
 * not. This is display-only -- no stored or arithmetic value is affected, and
 * a household ledger will not reach ~$90 trillion -- but the guarantee is
 * bounded, not absolute, so do not read this fallback as exact. Prefer the
 * string path, which is exact, wherever the runtime offers it.
 */
const SUPPORTS_STRING_FORMAT: boolean = (() => {
  try {
    const probe = new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) as unknown as StringCapableNumberFormat;
    return probe.format("1.05").includes("1.05");
  } catch {
    return false;
  }
})();

/**
 * Format integer cents for display using `Intl.NumberFormat`.
 *
 * @example
 * formatCents(829, { locale: "en-US" })                        // "$8.29"
 * formatCents(-500, { locale: "en-US" })                       // "-$5.00"
 * formatCents(123456789, { locale: "en-US" })                  // "$1,234,567.89"
 * formatCents(829, { locale: "en-US", omitCurrencySymbol: true }) // "8.29"
 */
export function formatCents(cents: Cents, options: FormatCentsOptions = {}): string {
  const { currency = "USD", locale, omitCurrencySymbol = false } = options;

  const decimal = toDecimalString(cents);

  const formatter = new Intl.NumberFormat(locale, {
    ...(omitCurrencySymbol ? {} : { style: "currency" as const, currency }),
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  if (SUPPORTS_STRING_FORMAT) {
    return (formatter as unknown as StringCapableNumberFormat).format(decimal);
  }
  return formatter.format(Number(decimal));
}

/**
 * Sum integer cents. Trivial, but exists so that call sites have an obvious
 * place to reach for instead of inventing float arithmetic, and so the
 * safe-range boundary is asserted on aggregates too.
 *
 * Note the authoritative balance is always `SUM` over non-voided rows in
 * PostgreSQL; this is for display-side totals only.
 */
export function sumCents(values: readonly Cents[]): Cents {
  let total = 0n;
  for (const value of values) {
    if (!Number.isInteger(value)) {
      throw new TypeError(`Cents must be an integer, received ${String(value)}.`);
    }
    total += BigInt(value);
  }
  const limit = BigInt(MAX_SAFE_CENTS);
  if (total > limit || total < -limit) {
    throw new RangeError("Total exceeds the safe integer range for cents.");
  }
  return Number(total);
}
