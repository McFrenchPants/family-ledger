import { describe, expect, it } from "vitest";

import { todayInZone } from "../../lib/dates";
import type { ChildBalance } from "../ledger/household-balances";
import type { ChildPaymentProgress } from "../payment-plans/useChildPaymentProgress";
import { DUE_SOON_DAYS } from "./child-home";
import {
  childCardView,
  firstName,
  greeting,
  hourInZone,
  householdTotal,
  needsAttention,
  orderChildren,
} from "./parent-home";

const LOCALE = "en-US";
const TODAY = "2026-10-02";

const child = (memberId: string, name: string, balanceCents = 10000): ChildBalance => ({
  memberId,
  name,
  balanceCents,
});

const plan = (over: Partial<ChildPaymentProgress> = {}): ChildPaymentProgress => ({
  periodStatus: "due",
  minimumCents: 4000,
  paidCents: 0,
  remainingCents: 4000,
  dueDate: "2026-10-15",
  ...over,
});

const progressMap = (entries: [string, ChildPaymentProgress | null][]) => new Map(entries);

describe("needsAttention", () => {
  it("lists overdue and due-within-a-week children, worst first", () => {
    const children = [
      child("sam", "Sam"),
      child("katie", "Katie"),
      child("alex", "Alex"),
      child("ryan", "Ryan"),
      child("jo", "Jo"),
    ];
    const progress = progressMap([
      ["sam", plan({ dueDate: "2026-10-05", remainingCents: 3000 })],
      ["katie", plan({ periodStatus: "satisfied", remainingCents: 0 })],
      ["alex", plan({ periodStatus: "overdue", dueDate: "2026-09-15", remainingCents: 1500, paidCents: 2500 })],
      ["ryan", null],
      ["jo", plan({ dueDate: "2026-10-02", remainingCents: 2000 })],
    ]);

    const items = needsAttention(children, progress, TODAY, LOCALE);
    expect(items.map((item) => [item.memberId, item.kind])).toEqual([
      ["alex", "overdue"],
      ["jo", "due-soon"],
      ["sam", "due-soon"],
    ]);

    const [alex, jo, sam] = items;
    expect(alex).toMatchObject({
      headline: "Alex is $15.00 behind",
      detail: "September minimum, due Sep 15 · 17 days overdue",
      chipLabel: "Overdue",
      amountCents: 1500,
    });
    expect(jo).toMatchObject({ headline: "Jo owes $20.00 today", chipLabel: "Due today" });
    expect(sam).toMatchObject({
      headline: "Sam owes $30.00 by Oct 5",
      detail: "October minimum, due Oct 5",
      chipLabel: "Due in 3 days",
    });
  });

  it("orders two overdue children by earliest due date", () => {
    const items = needsAttention(
      [child("a", "Ann"), child("b", "Bo")],
      progressMap([
        ["a", plan({ periodStatus: "overdue", dueDate: "2026-09-20" })],
        ["b", plan({ periodStatus: "overdue", dueDate: "2026-08-20" })],
      ]),
      TODAY,
      LOCALE,
    );
    expect(items.map((item) => item.memberId)).toEqual(["b", "a"]);
  });

  it("uses the DUE_SOON_DAYS window inclusively", () => {
    const edge = "2026-10-09"; // today + 7
    expect(DUE_SOON_DAYS).toBe(7);
    const inside = needsAttention([child("a", "Ann")], progressMap([["a", plan({ dueDate: edge })]]), TODAY, LOCALE);
    expect(inside[0]?.chipLabel).toBe("Due in 7 days");
    const outside = needsAttention(
      [child("a", "Ann")],
      progressMap([["a", plan({ dueDate: "2026-10-10" })]]),
      TODAY,
      LOCALE,
    );
    expect(outside).toEqual([]);
    const tomorrow = needsAttention(
      [child("a", "Ann")],
      progressMap([["a", plan({ dueDate: "2026-10-03", periodStatus: "upcoming" })]]),
      TODAY,
      LOCALE,
    );
    expect(tomorrow[0]?.chipLabel).toBe("Due tomorrow");
  });

  it("never flags satisfied, waived, no plan, zero balance or nothing left to pay", () => {
    const children = [child("s", "S"), child("w", "W"), child("n", "N"), child("z", "Z", 0), child("r", "R")];
    const progress = progressMap([
      ["s", plan({ periodStatus: "satisfied", dueDate: "2026-10-03", remainingCents: 0 })],
      ["w", plan({ periodStatus: "waived", dueDate: "2026-10-03" })],
      ["n", null],
      ["z", plan({ periodStatus: "overdue", dueDate: "2026-09-15" })],
      ["r", plan({ periodStatus: "partially_paid", dueDate: "2026-10-03", remainingCents: 0 })],
    ]);
    expect(needsAttention(children, progress, TODAY, LOCALE)).toEqual([]);
  });

  it("partially paid and due soon is due-soon, with the remaining amount", () => {
    const items = needsAttention(
      [child("a", "Ann")],
      progressMap([["a", plan({ periodStatus: "partially_paid", paidCents: 2500, remainingCents: 1500, dueDate: "2026-10-04" })]]),
      TODAY,
      LOCALE,
    );
    expect(items[0]).toMatchObject({ kind: "due-soon", headline: "Ann owes $15.00 by Oct 4" });
  });

  it("follows the household date just across midnight, not UTC", () => {
    // 06:30 UTC on Oct 3 is still 23:30 on Oct 2 in Los Angeles.
    const instant = new Date("2026-10-03T06:30:00Z");
    const householdToday = todayInZone("America/Los_Angeles", instant);
    expect(householdToday).toBe("2026-10-02");
    expect(todayInZone("UTC", instant)).toBe("2026-10-03");

    const children = [child("a", "Ann"), child("b", "Bo")];
    const progress = progressMap([
      // Due Oct 10: 8 days out in LA (not due soon); 7 by the UTC date.
      ["a", plan({ dueDate: "2026-10-10" })],
      // Overdue since Sep 30: 2 days in LA; 3 by the UTC date.
      ["b", plan({ periodStatus: "overdue", dueDate: "2026-09-30" })],
    ]);

    const items = needsAttention(children, progress, householdToday, LOCALE);
    expect(items).toHaveLength(1);
    expect(items[0]?.detail).toBe("September minimum, due Sep 30 · 2 days overdue");

    const utcItems = needsAttention(children, progress, todayInZone("UTC", instant), LOCALE);
    expect(utcItems).toHaveLength(2);
  });

  it("says 1 day overdue in the singular", () => {
    const items = needsAttention(
      [child("a", "Ann")],
      progressMap([["a", plan({ periodStatus: "overdue", dueDate: "2026-10-01" })]]),
      TODAY,
      LOCALE,
    );
    expect(items[0]?.detail).toContain("1 day overdue");
  });
});

describe("childCardView", () => {
  it("uses the Parent status vocabulary", () => {
    const chip = (balance: number, progress: ChildPaymentProgress | null | undefined) =>
      childCardView(balance, progress, TODAY, LOCALE).chip;

    expect(chip(0, plan({ periodStatus: "overdue" }))).toEqual({ kind: "clear", label: "All caught up" });
    expect(chip(100, null)).toEqual({ kind: "none", label: "No plan" });
    expect(chip(100, undefined)).toBeNull();
    expect(chip(100, plan({ periodStatus: "overdue", remainingCents: 1500 }))).toEqual({
      kind: "overdue",
      label: "$15.00 overdue",
    });
    expect(chip(100, plan({ dueDate: "2026-10-05", remainingCents: 3000 }))).toEqual({
      kind: "due",
      label: "$30.00 due Oct 5",
    });
    expect(chip(100, plan({ periodStatus: "upcoming" }))).toEqual({ kind: "upcoming", label: "Due Oct 15" });
    expect(chip(100, plan({ periodStatus: "partially_paid", paidCents: 2500 }))).toEqual({
      kind: "partial",
      label: "$25.00 of $40.00 paid",
    });
    expect(chip(100, plan({ periodStatus: "satisfied", paidCents: 4000, remainingCents: 0 }))).toEqual({
      kind: "satisfied",
      label: "October paid",
    });
    expect(chip(100, plan({ periodStatus: "waived" }))).toEqual({ kind: "waived", label: "Waived" });
  });

  it("shows a progress line only while something is owed under an active, non-waived plan", () => {
    const view = childCardView(18732, plan({ periodStatus: "overdue", paidCents: 2500 }), TODAY, LOCALE);
    expect(view.progress).toEqual({
      paidCents: 2500,
      minimumCents: 4000,
      text: "$25.00 of $40.00 paid",
      percent: 62,
      tone: "danger",
    });
    expect(childCardView(0, plan(), TODAY, LOCALE).progress).toBeNull();
    expect(childCardView(100, null, TODAY, LOCALE).progress).toBeNull();
    expect(childCardView(100, plan({ periodStatus: "waived" }), TODAY, LOCALE).progress).toBeNull();
    expect(childCardView(100, plan({ periodStatus: "satisfied", paidCents: 4000 }), TODAY, LOCALE).progress?.tone).toBe("ok");
  });

  it("names the due date at most once per row: in the chip, never again in the progress", () => {
    for (const periodStatus of ["due", "upcoming", "partially_paid", "overdue", "satisfied"] as const) {
      const view = childCardView(100, plan({ periodStatus, dueDate: "2026-10-05" }), TODAY, LOCALE);
      const shown = [view.chip?.label ?? "", view.progress?.text ?? ""].join(" | ");
      expect(shown.match(/Oct 5/g)?.length ?? 0).toBeLessThanOrEqual(1);
    }
    expect(childCardView(100, plan({ periodStatus: "upcoming" }), TODAY, LOCALE)).toMatchObject({
      chip: { label: "Due Oct 15" },
      progress: { text: "$0.00 of $40.00 paid" },
    });
  });

  it("without a known today, never claims 'due soon'", () => {
    expect(childCardView(100, plan({ dueDate: "2026-10-03" }), null, LOCALE).chip?.kind).toBe("upcoming");
  });
});

describe("orderChildren", () => {
  it("orders overdue, then due soonest, then paid up, then no plan", () => {
    const children = [
      child("none", "No plan"),
      child("paid", "Paid", 500),
      child("zero", "Zero", 0),
      child("later", "Later"),
      child("soon", "Soon"),
      child("over", "Over"),
    ];
    const progress = progressMap([
      ["none", null],
      ["paid", plan({ periodStatus: "satisfied", remainingCents: 0 })],
      ["zero", null],
      ["later", plan({ dueDate: "2026-10-20" })],
      ["soon", plan({ dueDate: "2026-10-04" })],
      ["over", plan({ periodStatus: "overdue", dueDate: "2026-09-15" })],
    ]);
    expect(orderChildren(children, progress).map((c) => c.memberId)).toEqual([
      "over",
      "soon",
      "later",
      "paid",
      "zero",
      "none",
    ]);
  });

  it("keeps roster order (paid up last) while plan status is unknown", () => {
    const children = [child("a", "A", 0), child("b", "B"), child("c", "C")];
    expect(orderChildren(children, null).map((c) => c.memberId)).toEqual(["b", "c", "a"]);
  });
});

describe("householdTotal", () => {
  it("sums balances and the still-due minimums with the latest due date", () => {
    const children = [child("a", "A", 18732), child("b", "B", 11240), child("c", "C", 6381), child("d", "D", 0)];
    const progress = progressMap([
      ["a", plan({ periodStatus: "overdue", remainingCents: 1500, dueDate: "2026-09-15" })],
      ["b", plan({ remainingCents: 3000, dueDate: "2026-10-05" })],
      ["c", plan({ periodStatus: "satisfied", remainingCents: 0, dueDate: "2026-10-15" })],
      ["d", null],
    ]);
    expect(householdTotal(children, progress, LOCALE)).toEqual({
      totalCents: 36353,
      summary: "across 4 children · $45.00 due by Oct 5",
    });
  });

  it("omits the due part when nothing is due, or while plans are unknown", () => {
    const children = [child("a", "A", 500)];
    expect(householdTotal(children, progressMap([["a", null]]), LOCALE).summary).toBe("across 1 child");
    expect(householdTotal(children, null, LOCALE).summary).toBe("across 1 child");
  });

  it("ignores waived periods", () => {
    const children = [child("a", "A", 500)];
    expect(
      householdTotal(children, progressMap([["a", plan({ periodStatus: "waived" })]]), LOCALE).summary,
    ).toBe("across 1 child");
  });
});

describe("greeting", () => {
  it("uses the household's clock, not the host's", () => {
    // 15:30 UTC is 08:30 in Los Angeles and 17:30 in Paris.
    const instant = new Date("2026-10-02T15:30:00Z");
    expect(hourInZone("America/Los_Angeles", instant)).toBe(8);
    expect(greeting("Dana Smith", "America/Los_Angeles", instant)).toBe("Good morning, Dana");
    expect(greeting("Dana", "Europe/Paris", instant)).toBe("Good evening, Dana");
    expect(greeting("Dana", "America/New_York", instant)).toBe("Good morning, Dana");
    expect(greeting("Dana", "UTC", instant)).toBe("Good afternoon, Dana");
  });

  it("falls back to a neutral greeting without a zone", () => {
    expect(greeting("Dana", null)).toBe("Hi, Dana");
  });

  it("takes the first word of the name", () => {
    expect(firstName("  Dana  Smith ")).toBe("Dana");
    expect(firstName("Dana")).toBe("Dana");
  });
});
