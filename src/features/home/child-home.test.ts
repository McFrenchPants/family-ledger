import { describe, expect, it } from "vitest";

import { OVERDUE_MESSAGES, daySeed, pick } from "../../lib/messages";
import type { RecentTransaction } from "../ledger/recent-activity";
import type { ChildPaymentProgress } from "../payment-plans/useChildPaymentProgress";
import {
  DUE_SOON_DAYS,
  SEEN_ACTIVITY_KEY_PREFIX,
  newPaymentsSince,
  paymentReceivedMessage,
  planView,
  readSeenActivity,
  writeSeenActivity,
} from "./child-home";

const LOCALE = "en-US";

const progress = (over: Partial<ChildPaymentProgress>): ChildPaymentProgress => ({
  periodStatus: "due",
  minimumCents: 4000,
  paidCents: 0,
  remainingCents: 4000,
  dueDate: "2026-10-15",
  ...over,
});

const tx = (over: Partial<RecentTransaction> & { id: string }): RecentTransaction => ({
  description: "Thing",
  categoryName: null,
  amountCents: 1000,
  type: "expense",
  occurredOn: "2026-09-30",
  ...over,
});

describe("planView status vocabulary", () => {
  it("overdue: danger chip, callout with amount and due date", () => {
    const view = planView(
      progress({ periodStatus: "overdue", dueDate: "2026-09-15", paidCents: 2500, remainingCents: 1500 }),
      "2026-10-02",
      LOCALE,
    );
    expect(view.chip).toEqual({ kind: "overdue", label: "Overdue" });
    expect(view.callout?.tone).toBe("danger");
    expect(view.callout?.text).toContain("$15.00");
    expect(view.callout?.text).toContain("Sep 15");
    expect(view.callout?.text).toBe(
      pick(OVERDUE_MESSAGES, daySeed("2026-10-02", "overdue"))({ amount: "$15.00", date: "Sep 15" }),
    );
    expect(view.nextLine).toBeNull();
  });

  it(`due within ${DUE_SOON_DAYS} days (inclusive) is warn; beyond it is neutral`, () => {
    const soon = planView(progress({ dueDate: "2026-10-09" }), "2026-10-02", LOCALE);
    expect(soon.chip).toEqual({ kind: "due", label: "Due Oct 9" });
    expect(soon.callout?.tone).toBe("warn");

    const today = planView(progress({ dueDate: "2026-10-02" }), "2026-10-02", LOCALE);
    expect(today.chip.kind).toBe("due");

    const later = planView(progress({ dueDate: "2026-10-10" }), "2026-10-02", LOCALE);
    expect(later.chip).toEqual({ kind: "upcoming", label: "Due Oct 10" });
    expect(later.callout?.tone).toBe("quiet");
    expect(later.nextLine).toBe("Next minimum: $40.00 due Oct 10.");
  });

  it("partially paid: info chip with paid of minimum", () => {
    const view = planView(
      progress({ periodStatus: "partially_paid", paidCents: 2500, remainingCents: 1500 }),
      "2026-10-02",
      LOCALE,
    );
    expect(view.chip).toEqual({ kind: "partial", label: "$25.00 of $40.00 paid" });
    expect(view.progress?.text).toBe("$25.00 of $40.00 paid this month");
    expect(view.progress?.percent).toBe(62);
  });

  it("satisfied: 'Paid for October' and a paid-on-time note", () => {
    const view = planView(
      progress({ periodStatus: "satisfied", paidCents: 4000, remainingCents: 0 }),
      "2026-10-02",
      LOCALE,
    );
    expect(view.chip).toEqual({ kind: "satisfied", label: "Paid for October" });
    expect(view.callout?.tone).toBe("ok");
    expect(view.callout?.text).toContain("October");
    expect(view.nextLine).toBeNull();
  });

  it("waived: neutral chip, no progress bar", () => {
    const view = planView(progress({ periodStatus: "waived" }), "2026-10-02", LOCALE);
    expect(view.chip).toEqual({ kind: "waived", label: "Waived" });
    expect(view.progress).toBeNull();
  });

  it("the same day always gives the same copy", () => {
    const a = planView(progress({ dueDate: "2026-10-05" }), "2026-10-02", LOCALE);
    const b = planView(progress({ dueDate: "2026-10-05" }), "2026-10-02", LOCALE);
    expect(a.callout?.text).toBe(b.callout?.text);
  });
});

describe("new payments since last visit", () => {
  const list = [
    tx({ id: "e2", type: "expense" }),
    tx({ id: "p2", type: "payment", amountCents: -2500 }),
    tx({ id: "p-void", type: "payment", amountCents: -1000, isVoided: true }),
    tx({ id: "adj", type: "adjustment", amountCents: -500 }),
    tx({ id: "p1", type: "payment", amountCents: -2000 }),
  ];

  it("shows nothing on a first-ever visit", () => {
    expect(newPaymentsSince(list, null)).toEqual([]);
  });

  it("finds unseen real payments only (no voided rows, no adjustments)", () => {
    expect(newPaymentsSince(list, ["p1"]).map((t) => t.id)).toEqual(["p2"]);
  });

  it("notices a back-dated payment below already-seen rows", () => {
    expect(newPaymentsSince(list, ["e2", "p2", "adj"]).map((t) => t.id)).toEqual(["p1"]);
  });

  it("shows nothing once everything has been seen", () => {
    expect(newPaymentsSince(list, list.map((t) => t.id))).toEqual([]);
  });

  it("sums several payments in integer cents", () => {
    const message = paymentReceivedMessage(
      [tx({ id: "a", type: "payment", amountCents: -2500 }), tx({ id: "b", type: "payment", amountCents: -1033 })],
      "2026-10-02",
      LOCALE,
    );
    expect(message).toContain("$35.33");
    expect(paymentReceivedMessage([], "2026-10-02", LOCALE)).toBeNull();
  });

  it("stores seen ids per member and survives throwing storage", () => {
    const map = new Map<string, string>();
    const storage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
    };
    expect(readSeenActivity("m1", storage)).toBeNull();
    writeSeenActivity("m1", ["a", "b"], storage);
    expect(map.has(SEEN_ACTIVITY_KEY_PREFIX + "m1")).toBe(true);
    expect(readSeenActivity("m1", storage)).toEqual(["a", "b"]);
    expect(readSeenActivity("m2", storage)).toBeNull();

    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(readSeenActivity("m1", broken)).toBeNull();
    expect(() => writeSeenActivity("m1", ["a"], broken)).not.toThrow();
  });
});
