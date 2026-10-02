import { describe, expect, it } from "vitest";

import { PAYMENT_RECORDED_MESSAGES } from "../../lib/messages";
import {
  buildRecordMemberOptions,
  paymentRecordedMessage,
  validateRecordForm,
  validateVoidReason,
} from "./record-transaction";

describe("buildRecordMemberOptions", () => {
  it("returns only active Children, excluding Parents", () => {
    const result = buildRecordMemberOptions([
      { id: "parent-1", name: "Dana", role: "parent" },
      { id: "child-1", name: "Alex", role: "child" },
      { id: "child-2", name: "Katie", role: "child" },
    ]);

    expect(result).toEqual([
      { id: "child-1", name: "Alex", role: "child" },
      { id: "child-2", name: "Katie", role: "child" },
    ]);
  });

  it("returns an empty list when there are no active children", () => {
    expect(buildRecordMemberOptions([{ id: "parent-1", name: "Dana", role: "parent" }])).toEqual([]);
  });
});

describe("validateRecordForm", () => {
  const validBase = {
    memberId: "child-1",
    amountInput: "25.00",
    description: "Allowance payment",
    occurredOn: "2026-09-05",
  };

  it("accepts a well-formed form and negates the parsed amount", () => {
    const result = validateRecordForm(validBase);
    expect(result).toEqual({ ok: true, amountCents: -2500 });
  });

  it("rejects a missing member", () => {
    const result = validateRecordForm({ ...validBase, memberId: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.memberId).toBe("Choose which child this is for.");
    }
  });

  it("rejects a zero amount", () => {
    const result = validateRecordForm({ ...validBase, amountInput: "0.00" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.amount).toBe("Amount must be greater than zero.");
    }
  });

  it("rejects a typed-negative amount with a distinct, actionable message", () => {
    const result = validateRecordForm({ ...validBase, amountInput: "-25.00" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.amount).toBe("Enter a positive amount (no minus sign).");
    }
  });

  it("rejects a malformed amount", () => {
    const result = validateRecordForm({ ...validBase, amountInput: "12,34" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.amount).toBeDefined();
    }
  });

  it("rejects a blank description", () => {
    const result = validateRecordForm({ ...validBase, description: "   " });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.description).toBe("Enter a description.");
    }
  });

  it("rejects an invalid date", () => {
    const result = validateRecordForm({ ...validBase, occurredOn: "2026-13-40" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.occurredOn).toBe("Enter a valid date.");
    }
  });

  it("collects every field error at once rather than stopping at the first", () => {
    const result = validateRecordForm({
      memberId: "",
      amountInput: "",
      description: "",
      occurredOn: "not-a-date",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.errors).sort()).toEqual([
        "amount",
        "description",
        "memberId",
        "occurredOn",
      ]);
    }
  });
});

describe("validateVoidReason", () => {
  it("rejects an empty reason", () => {
    expect(validateVoidReason("")).toEqual({
      ok: false,
      error: "Enter a reason for voiding this transaction.",
    });
  });

  it("rejects a whitespace-only reason", () => {
    expect(validateVoidReason("   ")).toEqual({
      ok: false,
      error: "Enter a reason for voiding this transaction.",
    });
  });

  it("accepts and trims a real reason", () => {
    expect(validateVoidReason("  entered twice by mistake  ")).toEqual({
      ok: true,
      reason: "entered twice by mistake",
    });
  });
});

describe("paymentRecordedMessage", () => {
  it("names the child and the positive amount, stable for one payment", () => {
    const text = paymentRecordedMessage("payment", "Alex", -4000, "tx-1", "en-US");
    expect(text).toContain("Alex");
    expect(text).toContain("$40.00");
    expect(text).not.toContain("-$");
    expect(paymentRecordedMessage("payment", "Alex", -4000, "tx-1", "en-US")).toBe(text);
    const all = PAYMENT_RECORDED_MESSAGES.map((t) => t({ name: "Alex", amount: "$40.00" }));
    expect(all).toContain(text);
  });

  it("says nothing for an adjustment", () => {
    expect(paymentRecordedMessage("adjustment", "Alex", -4000, "tx-1", "en-US")).toBeNull();
  });
});
