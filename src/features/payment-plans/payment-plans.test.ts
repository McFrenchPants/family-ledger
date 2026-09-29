import { describe, expect, it } from "vitest";

import { validatePlanForm } from "./payment-plans";

describe("validatePlanForm", () => {
  const validBase = {
    minimumAmountInput: "25.00",
    dueDayInput: "15",
    startsOn: "2026-09-05",
    endsOn: "",
  };

  it("accepts a well-formed form with no end date", () => {
    const result = validatePlanForm(validBase);
    expect(result).toEqual({
      ok: true,
      minimumCents: 2500,
      dueDay: 15,
      startsOn: "2026-09-05",
      endsOn: null,
    });
  });

  it("accepts a well-formed form with an end date on/after the start date", () => {
    const result = validatePlanForm({ ...validBase, endsOn: "2026-12-31" });
    expect(result).toEqual({
      ok: true,
      minimumCents: 2500,
      dueDay: 15,
      startsOn: "2026-09-05",
      endsOn: "2026-12-31",
    });
  });

  it("rejects an empty amount", () => {
    const result = validatePlanForm({ ...validBase, minimumAmountInput: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.minimumAmount).toBeDefined();
    }
  });

  it("rejects a negative amount", () => {
    const result = validatePlanForm({ ...validBase, minimumAmountInput: "-25.00" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.minimumAmount).toBe("Amount must not be negative.");
    }
  });

  it("rejects a zero amount", () => {
    const result = validatePlanForm({ ...validBase, minimumAmountInput: "0.00" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.minimumAmount).toBe("Minimum amount must be greater than zero.");
    }
  });

  it("rejects a due day of 0", () => {
    const result = validatePlanForm({ ...validBase, dueDayInput: "0" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.dueDay).toBe("Enter a due day between 1 and 28.");
    }
  });

  it("rejects a due day of 29", () => {
    const result = validatePlanForm({ ...validBase, dueDayInput: "29" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.dueDay).toBe("Enter a due day between 1 and 28.");
    }
  });

  it("rejects a non-numeric due day", () => {
    const result = validatePlanForm({ ...validBase, dueDayInput: "fifteen" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.dueDay).toBe("Enter a due day between 1 and 28.");
    }
  });

  it("rejects an invalid startsOn date", () => {
    const result = validatePlanForm({ ...validBase, startsOn: "2026-13-40" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.startsOn).toBe("Enter a valid start date.");
    }
  });

  it("rejects an endsOn before startsOn", () => {
    const result = validatePlanForm({ ...validBase, startsOn: "2026-09-05", endsOn: "2026-09-01" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.endsOn).toBe("End date must not be before the start date.");
    }
  });

  it("rejects a malformed endsOn", () => {
    const result = validatePlanForm({ ...validBase, endsOn: "not-a-date" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.endsOn).toBe("Enter a valid end date.");
    }
  });

  it("treats an empty endsOn as optional, not an error", () => {
    const result = validatePlanForm({ ...validBase, endsOn: "   " });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.endsOn).toBeNull();
    }
  });

  it("collects every field error at once rather than stopping at the first", () => {
    const result = validatePlanForm({
      minimumAmountInput: "",
      dueDayInput: "0",
      startsOn: "not-a-date",
      endsOn: "also-not-a-date",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.errors).sort()).toEqual([
        "dueDay",
        "endsOn",
        "minimumAmount",
        "startsOn",
      ]);
    }
  });
});
