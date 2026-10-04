import { describe, expect, it } from "vitest";

import type { ChildPaymentProgress } from "../payment-plans/useChildPaymentProgress";
import {
  childParam,
  memberPath,
  planChip,
  planProgressView,
  planTermsLine,
  remindersLabel,
} from "./family-view";

const progress = (over: Partial<ChildPaymentProgress> = {}): ChildPaymentProgress => ({
  balanceId: "everyday",
  periodStatus: "partially_paid",
  minimumCents: 4000,
  paidCents: 2500,
  remainingCents: 1500,
  dueDate: "2026-09-15",
  ...over,
});

describe("planChip", () => {
  it("is absent while the balance or plan status is unknown", () => {
    expect(planChip(undefined, progress(), "2026-10-02")).toBeNull();
    expect(planChip(1000, undefined, "2026-10-02")).toBeNull();
  });

  it("uses the shared Parent wording", () => {
    expect(planChip(1000, null, "2026-10-02", "en-US")).toEqual({ kind: "none", label: "No plan" });
    expect(planChip(0, progress(), "2026-10-02", "en-US")).toEqual({
      kind: "clear",
      label: "All caught up",
    });
    expect(planChip(1000, progress({ periodStatus: "overdue" }), "2026-10-02", "en-US")).toEqual({
      kind: "overdue",
      label: "$15.00 overdue",
    });
  });
});

describe("planProgressView", () => {
  it("describes the current period in words", () => {
    expect(planProgressView(progress({ periodStatus: "overdue" }), "en-US")).toEqual({
      text: "September: $25.00 of $40.00",
      leftText: "$15.00 left",
      dueText: "Due Sep 15",
      paidCents: 2500,
      minimumCents: 4000,
      tone: "danger",
    });
  });

  it("drops the 'left' text when the period is met, and hides a waived period", () => {
    const met = planProgressView(
      progress({ periodStatus: "satisfied", paidCents: 4000, remainingCents: 0 }),
      "en-US",
    );
    expect(met?.leftText).toBeNull();
    expect(met?.tone).toBe("ok");
    expect(planProgressView(progress({ periodStatus: "waived" }))).toBeNull();
  });
});

describe("planTermsLine", () => {
  const plan = {
    id: "p",
    balanceId: "everyday",
    minimumCents: 4000,
    dueDay: 15,
    startsOn: "2026-06-15",
    endsOn: null,
    active: true,
  };

  it("names the due day and start date, and the end date only when set", () => {
    expect(planTermsLine(plan)).toBe("Due on day 15 each month · since Jun 15");
    expect(planTermsLine({ ...plan, endsOn: "2026-12-15" })).toBe(
      "Due on day 15 each month · since Jun 15 · until Dec 15",
    );
  });
});

describe("small helpers", () => {
  it("builds addresses with the id encoded", () => {
    expect(childParam("a b")).toBe("?child=a%20b");
    expect(memberPath("a/b")).toBe("/family/a%2Fb");
    expect(remindersLabel(true)).toBe("Reminders on");
    expect(remindersLabel(false)).toBe("Reminders off");
  });
});
