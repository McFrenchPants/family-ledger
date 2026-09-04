import { describe, expect, it } from "vitest";

import {
  MAX_SAFE_CENTS,
  MoneyParseError,
  formatCents,
  parseMoney,
  parseMoneyOrThrow,
  parsePositiveMoney,
  sumCents,
  toDecimalString,
} from "./currency";

/** Narrowing helper so a failed parse reports usefully instead of `undefined`. */
function expectCents(input: string): number {
  const result = parseMoney(input);
  if (!result.ok) {
    throw new Error(`Expected "${input}" to parse, got ${result.code}: ${result.message}`);
  }
  return result.cents;
}

function expectFailure(input: string): string {
  const result = parseMoney(input);
  if (result.ok) {
    throw new Error(`Expected "${input}" to fail, got ${result.cents} cents`);
  }
  return result.code;
}

describe("parseMoney — the IEEE 754 trap", () => {
  /**
   * The whole reason this module exists. `8.29 * 100` is 828.9999999999999 in
   * binary floating point, so a naive parser that multiplies and truncates
   * loses a cent. These cases are chosen specifically because the double
   * nearest to the decimal value sits just *below* the exact product.
   */
  it("parses 8.29 as exactly 829 cents", () => {
    expect(expectCents("8.29")).toBe(829);
  });

  it("proves the naive float approach would have been wrong for 8.29", () => {
    // Documenting the bug in an executable form: if someone "simplifies"
    // parseMoney into a multiply, this contrast shows what breaks.
    const naive = Math.trunc(Number("8.29") * 100);
    expect(naive).toBe(828); // the bug
    expect(Number("8.29") * 100).not.toBe(829); // 828.9999999999999
    expect(expectCents("8.29")).toBe(829); // the fix
  });

  it.each([
    ["8.29", 829],
    ["1.15", 115],
    ["4.35", 435],
    ["10.55", 1055],
    ["262.85", 26285],
    ["0.07", 7],
    ["1.10", 110],
  ])("parses %s without float drift", (input, expected) => {
    expect(expectCents(input)).toBe(expected);
  });

  it("stays exact for values where multiplying by 100 drifts", () => {
    // Independent check that the drift is real for the chosen fixtures, so
    // these are not vacuously-passing test cases.
    const hazards = ["1.15", "4.35", "10.55", "262.85"];
    const drifted = hazards.filter((v) => Math.trunc(Number(v) * 100) !== expectCents(v));
    expect(drifted.length).toBeGreaterThan(0);
    // ...and every one of them is nonetheless parsed exactly.
    expect(hazards.map(expectCents)).toEqual([115, 435, 1055, 26285]);
  });
});

describe("parseMoney — well-formed input", () => {
  it.each([
    ["0", 0],
    ["0.00", 0],
    ["42", 4200],
    ["42.", 4200],
    ["42.1", 4210],
    ["42.17", 4217],
    [".50", 50],
    [".5", 50],
    ["0.05", 5],
    ["+7.25", 725],
    ["-7.25", -725],
    ["-0.01", -1],
    ["  12.34  ", 1234], // surrounding whitespace trimmed (paste artifact)
    ["007.50", 750], // leading zeros are harmless
  ])("parses %j to %i cents", (input, expected) => {
    expect(expectCents(input)).toBe(expected);
  });

  it("normalises negative zero to +0", () => {
    const cents = expectCents("-0.00");
    expect(cents).toBe(0);
    expect(Object.is(cents, -0)).toBe(false);
  });

  it("always returns a safe integer", () => {
    for (const input of ["0", "42.17", "-7.25", ".5", "999999.99"]) {
      expect(Number.isSafeInteger(expectCents(input))).toBe(true);
    }
  });
});

describe("parseMoney — documented rejections", () => {
  it("rejects more than two decimal places rather than rounding silently", () => {
    expect(expectFailure("12.999")).toBe("too_many_decimals");
    expect(expectFailure("0.001")).toBe("too_many_decimals");
    // Even a trailing zero third digit is refused: we do not special-case it.
    expect(expectFailure("12.990")).toBe("too_many_decimals");
  });

  it.each(["", "   ", "\t\n"])("rejects empty/whitespace input %j", (input) => {
    expect(expectFailure(input)).toBe("empty");
  });

  it.each([
    "abc",
    "12abc",
    "$12.34",
    "12.34USD",
    "1 2",
    "1 234.56",
    "--5",
    "+-5",
    "-",
    "+",
    ".",
    "..",
    "1..2",
    "1.2.3",
    "12.34.56",
    "1e3",
    "0x10",
    "Infinity",
    "NaN",
    "½",
  ])("rejects malformed input %j", (input) => {
    expect(expectFailure(input)).toBe("malformed");
  });

  it("rejects thousands separators in either convention", () => {
    // Decision 3: grouping is locale-ambiguous, so we accept exactly one
    // canonical input form and let the UI steer the user to it.
    expect(expectFailure("1,234.56")).toBe("malformed");
    expect(expectFailure("1.234,56")).toBe("malformed");
    expect(expectFailure("1,234")).toBe("malformed");
  });

  it("rejects magnitudes beyond the safe integer range", () => {
    expect(expectFailure("99999999999999999999.99")).toBe("out_of_range");
    // Exactly at the boundary is accepted...
    const atLimit = toDecimalString(MAX_SAFE_CENTS);
    expect(expectCents(atLimit)).toBe(MAX_SAFE_CENTS);
    // ...one cent past it is not.
    expect(expectFailure(toDecimalString(MAX_SAFE_CENTS).replace(".", "") + ".00")).toBe(
      "out_of_range",
    );
  });

  it("never returns NaN or null as a sentinel", () => {
    const result = parseMoney("nonsense");
    expect(result.ok).toBe(false);
    // The discriminated union means `cents` simply is not present on failure.
    expect(result).not.toHaveProperty("cents");
  });
});

describe("parseMoneyOrThrow", () => {
  it("returns cents on success", () => {
    expect(parseMoneyOrThrow("8.29")).toBe(829);
  });

  it("throws a typed error carrying the code and input", () => {
    expect(() => parseMoneyOrThrow("12.999")).toThrow(MoneyParseError);
    try {
      parseMoneyOrThrow("12.999");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(MoneyParseError);
      const typed = error as MoneyParseError;
      expect(typed.code).toBe("too_many_decimals");
      expect(typed.input).toBe("12.999");
      expect(typed.name).toBe("MoneyParseError");
    }
  });
});

describe("parsePositiveMoney", () => {
  it("accepts zero and positive amounts", () => {
    expect(parsePositiveMoney("0")).toEqual({ ok: true, cents: 0 });
    expect(parsePositiveMoney("8.29")).toEqual({ ok: true, cents: 829 });
  });

  it("rejects negative amounts", () => {
    const result = parsePositiveMoney("-0.01");
    expect(result.ok).toBe(false);
  });

  it("distinguishes a negative amount from junk, so the UI can say why", () => {
    // A well-formed negative and actual gibberish are different user mistakes
    // and deserve different messages. Callers switch on `code`, so these must
    // not collapse to the same value.
    const negative = parsePositiveMoney("-0.01");
    const junk = parsePositiveMoney("not money");

    expect(negative).toEqual({
      ok: false,
      code: "negative_not_allowed",
      message: expect.any(String),
    });
    expect(junk).toEqual({
      ok: false,
      code: "malformed",
      message: expect.any(String),
    });
    expect(negative.ok).toBe(false);
    expect(junk.ok).toBe(false);
    if (!negative.ok && !junk.ok) {
      expect(negative.code).not.toBe(junk.code);
    }
  });

  it("is a UX affordance only, not an authorization control", () => {
    // Documented decision 4: parseMoney itself preserves the sign. Enforcement
    // of "a Child may never reduce a balance" lives in PostgreSQL, so this
    // module must not be the only thing standing between a Child and a credit.
    expect(expectCents("-100.00")).toBe(-10000);
  });
});

describe("toDecimalString", () => {
  it.each([
    [0, "0.00"],
    [5, "0.05"],
    [50, "0.50"],
    [829, "8.29"],
    [4217, "42.17"],
    [-1, "-0.01"],
    [-10000, "-100.00"],
    [123456789, "1234567.89"],
  ])("renders %i cents as %s", (cents, expected) => {
    expect(toDecimalString(cents)).toBe(expected);
  });

  it("rejects non-integer cents", () => {
    expect(() => toDecimalString(8.29)).toThrow(TypeError);
  });
});

describe("round-tripping", () => {
  it.each(["0.00", "0.05", "0.50", "8.29", "42.17", "1.15", "4.35", "262.85", "1234567.89"])(
    "parse -> toDecimalString round-trips %s",
    (input) => {
      expect(toDecimalString(expectCents(input))).toBe(input);
    },
  );

  it.each([
    ["-0.01", "-0.01"],
    ["+7.25", "7.25"],
    [".5", "0.50"],
    ["42", "42.00"],
    ["007.50", "7.50"],
  ])("parse -> toDecimalString normalises %s to %s", (input, expected) => {
    expect(toDecimalString(expectCents(input))).toBe(expected);
  });

  it("parse -> format -> parse is stable for display strings", () => {
    for (const input of ["8.29", "1.15", "1234567.89"]) {
      const cents = expectCents(input);
      const display = formatCents(cents, { locale: "en-US", omitCurrencySymbol: true });
      // Strip locale grouping before re-parsing, since parseMoney rejects it.
      expect(expectCents(display.replace(/,/g, ""))).toBe(cents);
    }
  });
});

describe("formatCents", () => {
  it("formats via Intl.NumberFormat with a currency symbol", () => {
    expect(formatCents(829, { locale: "en-US" })).toBe("$8.29");
    expect(formatCents(0, { locale: "en-US" })).toBe("$0.00");
    expect(formatCents(5, { locale: "en-US" })).toBe("$0.05");
    expect(formatCents(123456789, { locale: "en-US" })).toBe("$1,234,567.89");
  });

  it("formats negative amounts", () => {
    expect(formatCents(-500, { locale: "en-US" })).toBe("-$5.00");
  });

  it("can omit the currency symbol", () => {
    expect(formatCents(4217, { locale: "en-US", omitCurrencySymbol: true })).toBe("42.17");
  });

  it("always shows exactly two fraction digits", () => {
    expect(formatCents(4200, { locale: "en-US", omitCurrencySymbol: true })).toBe("42.00");
    expect(formatCents(4210, { locale: "en-US", omitCurrencySymbol: true })).toBe("42.10");
  });

  it("does not drift on float-hazard values", () => {
    for (const [cents, expected] of [
      [829, "8.29"],
      [115, "1.15"],
      [435, "4.35"],
      [26285, "262.85"],
    ] as const) {
      expect(formatCents(cents, { locale: "en-US", omitCurrencySymbol: true })).toBe(expected);
    }
  });

  it("honours a non-USD currency", () => {
    expect(formatCents(829, { locale: "en-US", currency: "EUR" })).toBe("€8.29");
  });
});

describe("sumCents", () => {
  it("sums exactly, including values that would drift as floats", () => {
    // 0.1 + 0.2 !== 0.3 in floats; in cents it is simply 10 + 20 === 30.
    expect(sumCents([10, 20])).toBe(30);
    expect(0.1 + 0.2).not.toBe(0.3);
  });

  it("returns 0 for an empty list", () => {
    expect(sumCents([])).toBe(0);
  });

  it("handles mixed signs", () => {
    expect(sumCents([1000, -250, -750])).toBe(0);
  });

  it("rejects non-integer inputs", () => {
    expect(() => sumCents([1.5])).toThrow(TypeError);
  });

  it("rejects totals beyond the safe range", () => {
    expect(() => sumCents([MAX_SAFE_CENTS, 1])).toThrow(RangeError);
  });
});
