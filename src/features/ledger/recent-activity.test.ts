import { describe, expect, it } from "vitest";

import { toRecentTransactions } from "./recent-activity";

describe("toRecentTransactions", () => {
  it("maps raw ledger_transactions rows to the rendered shape, including the embedded category name", () => {
    const result = toRecentTransactions([
      {
        id: "tx-1",
        description: "Gas",
        amount_cents: 4217,
        type: "expense",
        occurred_on: "2026-09-04",
        created_at: "2026-09-04T12:00:00Z",
        category: { name: "Transportation" },
      },
    ]);

    expect(result).toEqual([
      {
        id: "tx-1",
        description: "Gas",
        categoryName: "Transportation",
        amountCents: 4217,
        type: "expense",
        occurredOn: "2026-09-04",
      },
    ]);
  });

  it("defaults a missing category to null rather than dropping the row", () => {
    const result = toRecentTransactions([
      {
        id: "tx-2",
        description: "Allowance adjustment",
        amount_cents: -1000,
        type: "adjustment",
        occurred_on: "2026-09-01",
        created_at: "2026-09-01T09:00:00Z",
        category: null,
      },
    ]);

    expect(result).toEqual([
      {
        id: "tx-2",
        description: "Allowance adjustment",
        categoryName: null,
        amountCents: -1000,
        type: "adjustment",
        occurredOn: "2026-09-01",
      },
    ]);
  });

  it("returns an empty list for an empty result set", () => {
    expect(toRecentTransactions([])).toEqual([]);
  });
});

describe("toRecentTransactions voided rows", () => {
  it("flags a voided row and leaves a live row unflagged", () => {
    const [voided, live] = toRecentTransactions([
      {
        id: "tx-v",
        description: "Payment",
        amount_cents: -2500,
        type: "payment",
        occurred_on: "2026-09-10",
        created_at: "2026-09-10T12:00:00Z",
        voided_at: "2026-09-11T12:00:00Z",
        category: null,
      },
      {
        id: "tx-l",
        description: "Payment",
        amount_cents: -2500,
        type: "payment",
        occurred_on: "2026-09-10",
        created_at: "2026-09-10T12:00:00Z",
        voided_at: null,
        category: null,
      },
    ]);
    expect(voided?.isVoided).toBe(true);
    expect(live?.isVoided).toBeUndefined();
  });
});
