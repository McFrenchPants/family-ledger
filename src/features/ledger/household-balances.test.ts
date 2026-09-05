import { describe, expect, it } from "vitest";

import { joinChildBalances } from "./household-balances";

describe("joinChildBalances", () => {
  it("keeps only active Children, joined with their balance", () => {
    const result = joinChildBalances(
      [
        { id: "parent-1", name: "Dana", role: "parent", status: "active" },
        { id: "child-1", name: "Alex", role: "child", status: "active" },
        { id: "child-2", name: "Katie", role: "child", status: "active" },
      ],
      [
        { member_id: "child-1", balance_cents: 18732 },
        { member_id: "child-2", balance_cents: 6381 },
        { member_id: "parent-1", balance_cents: 0 },
      ],
    );

    expect(result).toEqual([
      { memberId: "child-1", name: "Alex", balanceCents: 18732 },
      { memberId: "child-2", name: "Katie", balanceCents: 6381 },
    ]);
  });

  it("defaults a child with no balance row to 0 cents rather than dropping or leaving it blank", () => {
    const result = joinChildBalances(
      [{ id: "child-3", name: "Ryan", role: "child", status: "active" }],
      [],
    );

    expect(result).toEqual([{ memberId: "child-3", name: "Ryan", balanceCents: 0 }]);
  });

  it("returns an empty list when there are no active children", () => {
    const result = joinChildBalances(
      [{ id: "parent-1", name: "Dana", role: "parent", status: "active" }],
      [{ member_id: "parent-1", balance_cents: 500 }],
    );

    expect(result).toEqual([]);
  });
});
