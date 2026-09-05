import { describe, expect, it } from "vitest";

import { toHistoryTransactions } from "./history";

describe("toHistoryTransactions", () => {
  it("maps an active (non-voided) row, including embedded category and creator name", () => {
    const result = toHistoryTransactions([
      {
        id: "tx-1",
        description: "Gas",
        amount_cents: 4217,
        type: "expense",
        occurred_on: "2026-09-04",
        created_at: "2026-09-04T12:00:00Z",
        voided_at: null,
        void_reason: null,
        category: { name: "Transportation" },
        created_by_member: { name: "Mom" },
        voided_by_member: null,
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
        isVoided: false,
        voidReason: null,
        createdByName: "Mom",
        voidedByName: null,
      },
    ]);
  });

  it("marks a voided row as voided and surfaces the voider's name and reason", () => {
    const result = toHistoryTransactions([
      {
        id: "tx-2",
        description: "Movie tickets",
        amount_cents: 1500,
        type: "expense",
        occurred_on: "2026-09-01",
        created_at: "2026-09-01T09:00:00Z",
        voided_at: "2026-09-02T10:00:00Z",
        void_reason: "Entered twice by mistake",
        category: null,
        created_by_member: { name: "Alex" },
        voided_by_member: { name: "Dad" },
      },
    ]);

    expect(result).toEqual([
      {
        id: "tx-2",
        description: "Movie tickets",
        categoryName: null,
        amountCents: 1500,
        type: "expense",
        occurredOn: "2026-09-01",
        isVoided: true,
        voidReason: "Entered twice by mistake",
        createdByName: "Alex",
        voidedByName: "Dad",
      },
    ]);
  });

  it("falls back to a graceful placeholder name when the creator's row is not readable (null embed)", () => {
    const result = toHistoryTransactions([
      {
        id: "tx-3",
        description: "Allowance adjustment",
        amount_cents: -1000,
        type: "adjustment",
        occurred_on: "2026-09-01",
        created_at: "2026-09-01T09:00:00Z",
        voided_at: null,
        void_reason: null,
        category: null,
        created_by_member: null,
        voided_by_member: null,
      },
    ]);

    expect(result).toEqual([
      {
        id: "tx-3",
        description: "Allowance adjustment",
        categoryName: null,
        amountCents: -1000,
        type: "adjustment",
        occurredOn: "2026-09-01",
        isVoided: false,
        voidReason: null,
        createdByName: "someone",
        voidedByName: null,
      },
    ]);
  });

  it("falls back to a graceful placeholder voider name when voided but the voider's row is not readable", () => {
    const result = toHistoryTransactions([
      {
        id: "tx-4",
        description: "Snack run",
        amount_cents: 300,
        type: "expense",
        occurred_on: "2026-08-30",
        created_at: "2026-08-30T09:00:00Z",
        voided_at: "2026-08-31T09:00:00Z",
        void_reason: "Duplicate",
        category: null,
        created_by_member: { name: "Alex" },
        voided_by_member: null,
      },
    ]);

    expect(result[0]).toMatchObject({
      isVoided: true,
      voidedByName: "someone",
    });
  });

  it("returns an empty list for an empty result set", () => {
    expect(toHistoryTransactions([])).toEqual([]);
  });
});
