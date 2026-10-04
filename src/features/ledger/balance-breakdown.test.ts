import { describe, expect, it } from "vitest";

import {
  balanceLabeler,
  breakdownLines,
  splitText,
  transferText,
  type BalanceInfo,
} from "./balance-breakdown";

const L = "en-US";
const EVERYDAY: BalanceInfo = { id: "e", name: "Everyday", isEveryday: true, active: true };
const CAR: BalanceInfo = { id: "car", name: "Car", isEveryday: false, active: true };
const COLLEGE: BalanceInfo = { id: "col", name: "College", isEveryday: false, active: true };
const owed = (entries: [string, number][]) => new Map(entries);

describe("breakdownLines", () => {
  it("hides balances that owe nothing and have no plan, keeps credit, and the parts add up to the total", () => {
    const amounts = owed([["e", 3000], ["car", -500], ["col", 0]]);
    const lines = breakdownLines([EVERYDAY, CAR, COLLEGE], amounts, new Set());

    expect(lines.map((line) => [line.name, line.cents, line.words])).toEqual([
      ["Everyday", 3000, "$30.00 owed"],
      ["Car", -500, "$5.00 in credit"],
    ]);
    const total = [...amounts.values()].reduce((a, b) => a + b, 0);
    expect(lines.reduce((sum, line) => sum + line.cents, 0)).toBe(total);
  });

  it("keeps a balance with nothing owed when it has an active plan", () => {
    const lines = breakdownLines([EVERYDAY, CAR], owed([["e", 100], ["car", 0]]), new Set(["car"]));
    expect(lines.map((line) => line.name)).toEqual(["Everyday", "Car"]);
  });

  it("is empty when only Everyday would show, or the amounts are unknown", () => {
    expect(breakdownLines([EVERYDAY], owed([["e", 4000]]), new Set(["e"]))).toEqual([]);
    expect(breakdownLines([EVERYDAY, CAR], owed([["e", 4000], ["car", 0]]), new Set())).toEqual([]);
    expect(breakdownLines([EVERYDAY, CAR], undefined, new Set())).toEqual([]);
  });

  it("shows a lone non-Everyday balance (Everyday owing nothing is hidden)", () => {
    const lines = breakdownLines([EVERYDAY, CAR], owed([["e", 0], ["car", 900]]), new Set());
    expect(lines.map((line) => line.name)).toEqual(["Car"]);
  });
});

describe("balanceLabeler", () => {
  it("names balances only when the household has more than Everyday", () => {
    expect(balanceLabeler([EVERYDAY, CAR])("car")).toBe("Car");
    expect(balanceLabeler([EVERYDAY])("e")).toBeNull();
    expect(balanceLabeler(null)("car")).toBeNull();
  });
});

describe("splitText", () => {
  const balances = [EVERYDAY, CAR, COLLEGE];

  it("lists every part of a multi-part payment with its amount", () => {
    expect(
      splitText([{ balanceId: "car", cents: 30000 }, { balanceId: "col", cents: 20000 }], balances, L),
    ).toBe("$300.00 Car · $200.00 College");
  });

  it("says nothing for a single part to Everyday, and names a single other balance", () => {
    expect(splitText([{ balanceId: "e", cents: 2000 }], balances, L)).toBeNull();
    expect(splitText(undefined, balances, L)).toBeNull();
    expect(splitText([{ balanceId: "car", cents: 2000 }], balances, L)).toBe("Applied to Car");
  });
});

describe("transferText", () => {
  it("reads as a move between two named balances", () => {
    expect(
      transferText({ fromBalanceId: "e", toBalanceId: "car", amountCents: 15000 }, [EVERYDAY, CAR], L),
    ).toBe("Moved $150.00 from Everyday to Car");
  });
});
