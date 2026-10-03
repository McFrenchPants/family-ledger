import { describe, expect, it } from "vitest";

import {
  activitySubline,
  toHouseholdRecentTransactions,
  toRecentTransactions,
  type RecentTransaction,
} from "./recent-activity";

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

describe("toHouseholdRecentTransactions", () => {
  it("keeps each row's member id and the voided flag", () => {
    const [voided, live] = toHouseholdRecentTransactions([
      {
        id: "t1",
        member_id: "kid-1",
        description: "Payment",
        amount_cents: -2500,
        type: "payment",
        occurred_on: "2026-10-01",
        created_at: "2026-10-01T10:00:00Z",
        voided_at: "2026-10-01T11:00:00Z",
        category: null,
      },
      {
        id: "t2",
        member_id: "kid-2",
        description: "Gas",
        amount_cents: 4217,
        type: "expense",
        occurred_on: "2026-09-30",
        created_at: "2026-09-30T10:00:00Z",
        voided_at: null,
        category: { name: "Gas" },
      },
    ]);
    expect(voided).toMatchObject({ id: "t1", memberId: "kid-1", isVoided: true });
    expect(live).toMatchObject({ id: "t2", memberId: "kid-2", categoryName: "Gas" });
    expect(live).not.toHaveProperty("isVoided");
  });
});

describe("activitySubline", () => {
  const row = (over: Partial<RecentTransaction>): RecentTransaction => ({
    id: "t",
    description: "Gas",
    categoryName: "Transportation",
    amountCents: 4217,
    type: "expense",
    occurredOn: "2026-09-10",
    ...over,
  });
  const payment = row({ description: "Payment", categoryName: null, type: "payment", amountCents: -2000 });

  it("drops the type word when the title already says it, keeping the child's name", () => {
    expect(activitySubline(payment, "Payment", "Katie")).toBe("Sep 10 · Katie");
    expect(activitySubline(payment, "Payment")).toBe("Sep 10");
    expect(activitySubline(row({ ...payment, description: "Cash payment" }), "Payment")).toBe("Sep 10");
  });

  it("keeps the type word when the title is something else", () => {
    expect(activitySubline(row({ ...payment, description: "Cash" }), "Payment", "Sam")).toBe(
      "Sep 10 · Payment · Sam",
    );
    // A word that merely contains the label is not the label.
    expect(activitySubline(row({ ...payment, description: "Payments app" }), "Payment")).toBe(
      "Sep 10 · Payment",
    );
  });

  it("shows an expense's category, unless the title repeats it", () => {
    expect(activitySubline(row({}), "Expense", "Alex")).toBe("Sep 10 · Transportation · Alex");
    expect(activitySubline(row({ categoryName: "Gas" }), "Expense")).toBe("Sep 10");
    expect(activitySubline(row({ categoryName: null }), "Expense")).toBe("Sep 10");
  });

  it("still marks a voided row", () => {
    expect(activitySubline(row({ isVoided: true }), "Expense")).toBe("Sep 10 · Transportation · Voided");
  });
});
