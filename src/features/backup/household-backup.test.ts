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
  categories: [{ id: "cat-1", name: "Transportation", sort_order: 1, active: true }],
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
      auditLog: EXAMPLE_INPUT.auditLog,
    });
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
