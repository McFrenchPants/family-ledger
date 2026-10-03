import { describe, expect, it } from "vitest";

import {
  creditedBalanceIds,
  planEffects,
  rowsFromParts,
  suggestSplit,
  transferPreview,
  validateSplit,
  validateTransfer,
} from "./payment-split";
import type { PlanTarget, SplitBalance } from "./payment-split";

const everyday: SplitBalance = { id: "e", name: "Everyday", isEveryday: true };
const car: SplitBalance = { id: "car", name: "Car", isEveryday: false };
const college: SplitBalance = { id: "col", name: "College", isEveryday: false };
const balances = [everyday, car, college];

const target = (balanceId: string, remainingCents: number, dueDate: string): PlanTarget => ({
  balanceId,
  periodStart: "2026-10-01",
  dueDate,
  minimumCents: remainingCents,
  remainingCents,
});

describe("suggestSplit", () => {
  it("covers minimums by earliest due date, capped at the payment, then the rest to the last-used balance", () => {
    const targets = [target("col", 5000, "2026-10-20"), target("car", 3000, "2026-10-05")];

    expect(
      suggestSplit({ amountCents: 10000, balances, targets, lastUsedBalanceId: "car" }),
    ).toEqual([
      { balanceId: "car", cents: 3000 + 2000 },
      { balanceId: "col", cents: 5000 },
    ]);
    // Capped: the earliest-due minimum gets paid first, the later one gets what is left.
    expect(
      suggestSplit({ amountCents: 4000, balances, targets, lastUsedBalanceId: null }),
    ).toEqual([
      { balanceId: "car", cents: 3000 },
      { balanceId: "col", cents: 1000 },
    ]);
  });

  it("falls back to Everyday when the last-used balance is gone or nothing is due", () => {
    expect(
      suggestSplit({ amountCents: 700, balances, targets: [], lastUsedBalanceId: "archived" }),
    ).toEqual([{ balanceId: "e", cents: 700 }]);
    expect(
      suggestSplit({
        amountCents: 700,
        balances,
        targets: [target("car", 0, "2026-10-05")],
        lastUsedBalanceId: null,
      }),
    ).toEqual([{ balanceId: "e", cents: 700 }]);
  });
});

describe("validateSplit", () => {
  const rows = (...pairs: [string, string][]) =>
    pairs.map(([balanceId, amountInput], index) => ({ key: `k${index}`, balanceId, amountInput }));

  it("passes only when the parts add up exactly, with no repeats", () => {
    expect(validateSplit(1000, rows(["car", "6.00"], ["e", "4.00"]))).toEqual({
      ok: true,
      parts: [
        { balanceId: "car", cents: 600 },
        { balanceId: "e", cents: 400 },
      ],
    });
    expect(validateSplit(1000, rows(["car", "6.00"], ["e", "3.99"]))).toMatchObject({
      ok: false,
      message: "$0.01 still to assign.",
    });
    expect(validateSplit(1000, rows(["car", "6.00"], ["e", "4.01"]))).toMatchObject({ ok: false });
    expect(validateSplit(1000, rows(["car", "6.00"], ["car", "4.00"]))).toMatchObject({
      ok: false,
      message: "Each balance can only be used once.",
    });
    expect(validateSplit(1000, rows(["car", "10.00"], ["e", "0"]))).toMatchObject({ ok: false });
  });

  it("round-trips suggested parts through rows without losing a cent", () => {
    const parts = [{ balanceId: "car", cents: 829 }];
    expect(validateSplit(829, rowsFromParts(parts))).toEqual({ ok: true, parts });
  });
});

describe("creditedBalanceIds", () => {
  it("flags a part bigger than what the balance owes (including a balance already in credit)", () => {
    const owed = new Map([
      ["car", 5000],
      ["e", 0],
      ["col", -100],
    ]);
    const parts = [
      { balanceId: "car", cents: 5000 },
      { balanceId: "e", cents: 1 },
      { balanceId: "col", cents: 100 },
    ];
    expect(creditedBalanceIds(parts, owed)).toEqual(["e", "col"]);
    expect(creditedBalanceIds(parts, null)).toEqual([]);
  });
});

describe("planEffects", () => {
  it("reduces the remaining minimum on the plan's balance and ignores payments dated before the period", () => {
    const targets = [target("car", 3000, "2026-10-05")];
    const parts = [{ balanceId: "car", cents: 3500 }];
    expect(planEffects({ parts, targets, occurredOn: "2026-10-03" })).toEqual([
      { balanceId: "car", remainingAfterCents: 0 },
    ]);
    expect(
      planEffects({ parts: [{ balanceId: "car", cents: 1000 }], targets, occurredOn: "2026-10-03" }),
    ).toEqual([{ balanceId: "car", remainingAfterCents: 2000 }]);
    expect(planEffects({ parts, targets, occurredOn: "2026-09-30" })).toEqual([]);
  });
});

describe("transfers", () => {
  it("moving from X to Y raises X and lowers Y", () => {
    expect(transferPreview({ fromBefore: 10000, toBefore: 20000, amountCents: 15000 })).toEqual({
      fromAfter: 25000,
      toAfter: 5000,
    });
    // A balance may go negative (credit).
    expect(transferPreview({ fromBefore: 0, toBefore: 1000, amountCents: 1500 }).toAfter).toBe(-500);
  });

  it("requires two different balances and a positive amount", () => {
    expect(validateTransfer({ fromId: "e", toId: "e", amountInput: "5" })).toMatchObject({ ok: false });
    expect(validateTransfer({ fromId: "e", toId: "car", amountInput: "0" })).toMatchObject({ ok: false });
    expect(validateTransfer({ fromId: "e", toId: "car", amountInput: "1.50" })).toEqual({
      ok: true,
      amountCents: 150,
    });
  });
});
