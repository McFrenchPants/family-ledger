import { describe, expect, it } from "vitest";

import {
  HOUSEHOLD_BACKUP_SCHEMA_VERSION,
  toHouseholdBackupJson,
  toHouseholdBackupSnapshot,
} from "./household-backup";

const EXAMPLE_INPUT = {
  household: { id: "house-1", name: "The Smiths", timezone: "America/Chicago" },
  members: [
    {
      id: "member-1",
      user_id: "user-1",
      name: "Alex",
      role: "parent",
      status: "active",
      created_at: "2026-01-01T00:00:00Z",
      archived_at: null,
    },
  ],
  transactions: [
    {
      id: "tx-1",
      member_id: "member-2",
      amount_cents: 4217,
      type: "expense",
      category_id: "cat-1",
      description: "Gas",
      note: null,
      occurred_on: "2026-09-04",
      created_by: "member-1",
      created_at: "2026-09-04T12:00:00Z",
      voided_at: null,
      voided_by: null,
      void_reason: null,
    },
  ],
  paymentPlans: [
    {
      id: "plan-1",
      member_id: "member-2",
      minimum_cents: 2000,
      frequency: "monthly",
      due_day: 1,
      starts_on: "2026-01-01",
      ends_on: null,
      active: true,
      created_by: "member-1",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      tracked_balance_id: null,
    },
  ],
  paymentPeriods: [
    {
      id: "period-1",
      payment_plan_id: "plan-1",
      member_id: "member-2",
      period_start: "2026-09-01",
      due_date: "2026-09-15",
      minimum_cents: 2000,
      waived_at: null,
      waived_by: null,
      waive_reason: null,
      created_at: "2026-09-01T00:00:00Z",
    },
  ],
  categories: [
    { id: "cat-1", name: "Transportation", sort_order: 1, active: true, tracked_balance_id: "bal-car" },
  ],
  trackedBalances: [
    {
      id: "bal-car",
      name: "Car",
      sort_order: 1,
      active: true,
      is_everyday: false,
      created_at: "2026-10-01T00:00:00Z",
    },
  ],
  paymentAllocations: [
    {
      id: "alloc-1",
      member_id: "member-2",
      transaction_id: "tx-2",
      transaction_type: "payment",
      tracked_balance_id: "bal-car",
      amount_cents: 1250,
      created_at: "2026-10-02T00:00:00Z",
    },
  ],
  balanceTransfers: [
    {
      id: "xfer-1",
      member_id: "member-2",
      from_tracked_balance_id: "bal-everyday",
      to_tracked_balance_id: "bal-car",
      amount_cents: 500,
      occurred_on: "2026-10-02",
      note: null,
      created_by: "member-1",
      created_at: "2026-10-02T00:00:00Z",
      voided_at: null,
      voided_by: null,
      void_reason: null,
    },
  ],
  paymentSuggestions: [
    {
      id: "sugg-1",
      member_id: "member-2",
      amount_cents: 3000,
      suggested_on: "2026-10-03",
      note: "from my job",
      status: "pending",
      created_by: "member-2",
      created_at: "2026-10-03T00:00:00Z",
      resolved_at: null,
      resolved_by: null,
      resolution_note: null,
      converted_transaction_id: null,
      converted_transaction_type: null,
    },
  ],
  paymentSuggestionParts: [
    {
      id: "part-1",
      member_id: "member-2",
      suggestion_id: "sugg-1",
      tracked_balance_id: "bal-car",
      amount_cents: 3000,
      created_at: "2026-10-03T00:00:00Z",
    },
  ],
  auditLog: [
    {
      id: "audit-1",
      actor_user_id: "user-1",
      entity_type: "ledger_transactions",
      entity_id: "tx-1",
      action: "insert",
      old_values: null,
      new_values: { amount_cents: 4217 },
      created_at: "2026-09-04T12:00:00Z",
    },
  ],
};

describe("toHouseholdBackupSnapshot", () => {
  it("wraps the fetched rows with a schema version and exportedAt timestamp", () => {
    const snapshot = toHouseholdBackupSnapshot(EXAMPLE_INPUT, "2026-09-06T18:30:00.000Z");

    expect(snapshot).toEqual({
      schemaVersion: HOUSEHOLD_BACKUP_SCHEMA_VERSION,
      exportedAt: "2026-09-06T18:30:00.000Z",
      household: EXAMPLE_INPUT.household,
      members: EXAMPLE_INPUT.members,
      transactions: EXAMPLE_INPUT.transactions,
      paymentPlans: EXAMPLE_INPUT.paymentPlans,
      paymentPeriods: EXAMPLE_INPUT.paymentPeriods,
      categories: EXAMPLE_INPUT.categories,
      trackedBalances: EXAMPLE_INPUT.trackedBalances,
      paymentAllocations: EXAMPLE_INPUT.paymentAllocations,
      balanceTransfers: EXAMPLE_INPUT.balanceTransfers,
      paymentSuggestions: EXAMPLE_INPUT.paymentSuggestions,
      paymentSuggestionParts: EXAMPLE_INPUT.paymentSuggestionParts,
      auditLog: EXAMPLE_INPUT.auditLog,
    });
  });

  it("is schema version 2: carries the category-balance tables, with plan and category balance links", () => {
    const snapshot = toHouseholdBackupSnapshot(EXAMPLE_INPUT, "2026-09-06T18:30:00.000Z");

    expect(HOUSEHOLD_BACKUP_SCHEMA_VERSION).toBe(2);
    expect(snapshot.schemaVersion).toBe(2);
    expect(snapshot.categories[0]?.tracked_balance_id).toBe("bal-car");
    expect(snapshot.paymentPlans[0]?.tracked_balance_id).toBeNull();
    expect(snapshot.paymentAllocations[0]?.amount_cents).toBe(1250);
    expect(snapshot.balanceTransfers[0]?.amount_cents).toBe(500);
    expect(snapshot.paymentSuggestionParts[0]?.amount_cents).toBe(3000);
  });

  it("keeps monetary amounts as raw integer cents, never a formatted currency string", () => {
    const snapshot = toHouseholdBackupSnapshot(EXAMPLE_INPUT, "2026-09-06T18:30:00.000Z");

    expect(snapshot.transactions[0]?.amount_cents).toBe(4217);
    expect(typeof snapshot.transactions[0]?.amount_cents).toBe("number");
    expect(snapshot.paymentPlans[0]?.minimum_cents).toBe(2000);
    expect(snapshot.paymentPeriods[0]?.minimum_cents).toBe(2000);
  });

  it("handles a household with no rows in any child table", () => {
    const snapshot = toHouseholdBackupSnapshot(
      {
        household: { id: "house-2", name: "Empty House", timezone: "UTC" },
        members: [],
        transactions: [],
        paymentPlans: [],
        paymentPeriods: [],
        categories: [],
        trackedBalances: [],
        paymentAllocations: [],
        balanceTransfers: [],
        paymentSuggestions: [],
        paymentSuggestionParts: [],
        auditLog: [],
      },
      "2026-09-06T18:30:00.000Z",
    );

    expect(snapshot.members).toEqual([]);
    expect(snapshot.transactions).toEqual([]);
    expect(snapshot.paymentPlans).toEqual([]);
    expect(snapshot.paymentPeriods).toEqual([]);
    expect(snapshot.categories).toEqual([]);
    expect(snapshot.auditLog).toEqual([]);
    expect(snapshot.household).toEqual({ id: "house-2", name: "Empty House", timezone: "UTC" });
  });
});

describe("toHouseholdBackupJson", () => {
  it("produces pretty-printed, parseable JSON that round-trips the snapshot", () => {
    const snapshot = toHouseholdBackupSnapshot(EXAMPLE_INPUT, "2026-09-06T18:30:00.000Z");
    const json = toHouseholdBackupJson(snapshot);

    expect(json).toContain("\n");
    expect(JSON.parse(json)).toEqual(snapshot);
  });
});
