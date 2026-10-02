import { describe, expect, it } from "vitest";

import { todayInZone } from "./dates";
import {
  DUE_SOON_MESSAGES,
  OVERDUE_MESSAGES,
  PAID_OFF_MESSAGES,
  PAID_ON_TIME_MESSAGES,
  PAYMENT_RECEIVED_MESSAGES,
  PAYMENT_RECORDED_MESSAGES,
  daySeed,
  pick,
} from "./messages";

describe("pick", () => {
  it("is deterministic for a given seed", () => {
    const items = ["a", "b", "c", "d", "e"];
    for (const seed of ["2026-10-01:overdue", "2026-10-02:overdue", "x"]) {
      expect(pick(items, seed)).toBe(pick(items, seed));
    }
  });

  it("rotates across days rather than always returning the same item", () => {
    const items = ["a", "b", "c"];
    const picked = new Set<string>();
    for (let day = 1; day <= 28; day += 1) {
      picked.add(pick(items, daySeed(`2026-10-${String(day).padStart(2, "0")}`, "overdue")));
    }
    expect(picked.size).toBeGreaterThan(1);
  });

  it("refuses an empty list", () => {
    expect(() => pick([], "seed")).toThrow(RangeError);
  });
});

describe("daily seed uses the household zone", () => {
  it("an instant just after midnight UTC is still the previous day in America/New_York", () => {
    const instant = new Date("2026-10-02T00:30:00Z");
    const householdDay = todayInZone("America/New_York", instant);
    expect(householdDay).toBe("2026-10-01");
    expect(todayInZone("UTC", instant)).toBe("2026-10-02");

    // The message for that instant is the New York day's message.
    expect(pick(PAID_OFF_MESSAGES, daySeed(householdDay, "paid-off"))).toBe(
      pick(PAID_OFF_MESSAGES, "2026-10-01:paid-off"),
    );
  });
});

describe("message copy", () => {
  it("every overdue and due-soon variant names the amount and the date", () => {
    for (const template of [...OVERDUE_MESSAGES, ...DUE_SOON_MESSAGES]) {
      const text = template({ amount: "$15.00", date: "Sep 15" });
      expect(text).toContain("$15.00");
      expect(text).toContain("Sep 15");
    }
  });

  it("payment and paid-on-time variants fill in their values", () => {
    for (const template of PAYMENT_RECEIVED_MESSAGES) {
      expect(template({ amount: "$25.00" })).toContain("$25.00");
    }
    for (const template of PAID_ON_TIME_MESSAGES) {
      expect(template({ month: "October" })).toContain("October");
    }
  });

  it("payment-recorded variants name the child and the amount, and never shame", () => {
    for (const template of PAYMENT_RECORDED_MESSAGES) {
      const text = template({ name: "Alex", amount: "$40.00" });
      expect(text).toContain("Alex");
      expect(text).toContain("$40.00");
      expect(text).not.toMatch(/late|behind|shame|sibling|brother|sister/i);
    }
  });
});
