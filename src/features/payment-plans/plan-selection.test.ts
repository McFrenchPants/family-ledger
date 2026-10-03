import { describe, expect, it } from "vitest";

import { headlineProgress, planOnBalance } from "./plan-selection";
import type { ChildPaymentProgress } from "./useChildPaymentProgress";

const plan = (over: Partial<ChildPaymentProgress>): ChildPaymentProgress => ({
  balanceId: "e",
  periodStatus: "due",
  minimumCents: 4000,
  paidCents: 0,
  remainingCents: 4000,
  dueDate: "2026-10-15",
  ...over,
});

describe("headlineProgress", () => {
  it("picks the overdue plan over a due one, then the earliest due date", () => {
    const everyday = plan({ balanceId: "e", dueDate: "2026-10-05" });
    const car = plan({ balanceId: "car", periodStatus: "overdue", dueDate: "2026-09-15" });
    const college = plan({ balanceId: "col", dueDate: "2026-10-01" });

    expect(headlineProgress([everyday, car, college])?.balanceId).toBe("car");
    expect(headlineProgress([everyday, college])?.balanceId).toBe("col");
  });

  it("ranks something still to pay above paid-up and waived plans, and gives null without plans", () => {
    const paid = plan({ balanceId: "e", periodStatus: "satisfied", remainingCents: 0 });
    const waived = plan({ balanceId: "w", periodStatus: "waived" });
    const due = plan({ balanceId: "car", dueDate: "2026-12-01" });

    expect(headlineProgress([waived, paid, due])?.balanceId).toBe("car");
    expect(headlineProgress([waived, paid])?.balanceId).toBe("e");
    expect(headlineProgress([])).toBeNull();
    expect(headlineProgress(undefined)).toBeNull();
  });
});

describe("planOnBalance", () => {
  it("finds the plan for one balance and never another's", () => {
    const plans = [plan({ balanceId: "e" }), plan({ balanceId: "car", minimumCents: 5000 })];
    expect(planOnBalance(plans, "car")?.minimumCents).toBe(5000);
    expect(planOnBalance(plans, "col")).toBeNull();
    expect(planOnBalance(undefined, "e")).toBeNull();
  });
});
