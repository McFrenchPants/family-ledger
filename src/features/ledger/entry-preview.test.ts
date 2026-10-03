import { describe, expect, it } from "vitest";

import {
  addExpenseButtonLabel,
  balanceAfterExpense,
  balanceAfterPayment,
  categoryIcon,
  dateChoiceFor,
  dateForChoice,
  expensePreviewLine,
  paymentPreview,
  paymentShortcuts,
  recordButtonLabel,
  typedAmountCents,
} from "./entry-preview";
import type { ChildPaymentProgress } from "../payment-plans/useChildPaymentProgress";

const L = "en-US";
const ALEX = { name: "Alex", self: false };
const ME = { name: "Sam", self: true };

function progress(overrides: Partial<ChildPaymentProgress> = {}): ChildPaymentProgress {
  return {
    periodStatus: "due",
    minimumCents: 4000,
    paidCents: 0,
    remainingCents: 4000,
    dueDate: "2026-10-15",
    ...overrides,
  };
}

describe("typedAmountCents", () => {
  it("parses decimal-safely into integer cents", () => {
    expect(typedAmountCents("8.29")).toBe(829);
    expect(typedAmountCents("42")).toBe(4200);
    expect(typedAmountCents(" .50 ")).toBe(50);
  });

  it("is null for anything that is not a positive amount", () => {
    for (const input of ["", "0", "0.00", "-5", "abc", "1,000", "12.999"]) {
      expect(typedAmountCents(input)).toBeNull();
    }
  });
});

describe("balance after", () => {
  it("adds an expense", () => {
    expect(balanceAfterExpense(18732, 4217)).toBe(22949);
    expect(balanceAfterExpense(0, 1)).toBe(1);
    expect(balanceAfterExpense(-500, 200)).toBe(-300);
  });

  it("subtracts a payment or adjustment magnitude", () => {
    expect(balanceAfterPayment(18732, 1500)).toBe(17232);
    expect(balanceAfterPayment(18732, 18732)).toBe(0);
  });

  it("goes below zero honestly when the amount is more than the balance", () => {
    expect(balanceAfterPayment(1000, 1500)).toBe(-500);
  });

  it("stays exact where floats would drift", () => {
    // 0.1 + 0.2 style traps do not exist in integer cents.
    expect(balanceAfterExpense(10, 20)).toBe(30);
    expect(balanceAfterPayment(829, 1)).toBe(828);
  });
});

describe("addExpenseButtonLabel / expensePreviewLine", () => {
  it("names the amount and person once both are known", () => {
    expect(addExpenseButtonLabel(4217, ALEX, L)).toBe("Add $42.17 to Alex’s balance");
    expect(addExpenseButtonLabel(4217, ME, L)).toBe("Add $42.17 to your balance");
  });

  it("falls back to plain copy until the amount is valid", () => {
    expect(addExpenseButtonLabel(null, ALEX, L)).toBe("Add expense");
    expect(addExpenseButtonLabel(4217, null, L)).toBe("Add expense");
  });

  it("previews the new balance", () => {
    expect(expensePreviewLine(18732, 4217, ALEX, L)).toBe("Alex’s balance will be $229.49");
    expect(expensePreviewLine(0, 500, ME, L)).toBe("Your balance will be $5.00");
  });

  it("shows credit honestly when the result is still below zero", () => {
    expect(expensePreviewLine(-1000, 500, ALEX, L)).toBe("Alex will be $5.00 in credit");
    expect(expensePreviewLine(-1000, 500, ME, L)).toBe("You will be $5.00 in credit");
  });

  it("shows nothing when the balance is unknown (e.g. a sibling's)", () => {
    expect(expensePreviewLine(null, 4217, ALEX, L)).toBeNull();
    expect(expensePreviewLine(18732, null, ALEX, L)).toBeNull();
  });
});

describe("paymentPreview", () => {
  it("shows from and to", () => {
    expect(paymentPreview(18732, 1500, "Alex", L)).toEqual({
      line: "Alex’s balance goes from $187.32 to $172.32",
      creditLine: null,
      overNote: null,
    });
  });

  it("paying exactly the balance is not 'more than owed'", () => {
    expect(paymentPreview(18732, 18732, "Alex", L)?.overNote).toBeNull();
    expect(paymentPreview(18732, 18732, "Alex", L)?.line).toBe(
      "Alex’s balance goes from $187.32 to $0.00",
    );
  });

  it("shows credit and a gentle note when the amount is more than the balance", () => {
    expect(paymentPreview(1000, 1500, "Alex", L)).toEqual({
      line: "Alex’s balance goes from $10.00 to −$5.00",
      creditLine: "Alex will be $5.00 in credit.",
      overNote: "This is more than Alex owes.",
    });
  });

  it("is null without a balance or a valid amount", () => {
    expect(paymentPreview(null, 1500, "Alex", L)).toBeNull();
    expect(paymentPreview(1000, null, "Alex", L)).toBeNull();
  });
});

describe("recordButtonLabel", () => {
  it("names amount and child", () => {
    expect(recordButtonLabel("payment", 1500, "Alex", L)).toBe("Record $15.00 from Alex");
    expect(recordButtonLabel("adjustment", 1500, "Alex", L)).toBe(
      "Record $15.00 adjustment for Alex",
    );
  });

  it("falls back to plain copy", () => {
    expect(recordButtonLabel("payment", null, "Alex", L)).toBe("Record payment");
    expect(recordButtonLabel("adjustment", 1500, null, L)).toBe("Record adjustment");
  });
});

describe("paymentShortcuts", () => {
  const kinds = (list: ReturnType<typeof paymentShortcuts>) =>
    list.map((s) => [s.kind, s.cents, s.label]);

  it("overdue: catch up, then pay in full", () => {
    expect(kinds(paymentShortcuts(18732, progress({ periodStatus: "overdue", remainingCents: 1500 }), L))).toEqual([
      ["catch-up", 1500, "Catch up $15.00"],
      ["full", 18732, "Pay in full $187.32"],
    ]);
  });

  it.each(["due", "partially_paid", "upcoming"] as const)(
    "%s: minimum (what is left), then pay in full",
    (periodStatus) => {
      expect(kinds(paymentShortcuts(11240, progress({ periodStatus, remainingCents: 3000 }), L))).toEqual([
        ["minimum", 3000, "Minimum $30.00"],
        ["full", 11240, "Pay in full $112.40"],
      ]);
    },
  );

  it.each(["satisfied", "waived"] as const)("%s: only pay in full", (periodStatus) => {
    expect(kinds(paymentShortcuts(6381, progress({ periodStatus, remainingCents: 0 }), L))).toEqual([
      ["full", 6381, "Pay in full $63.81"],
    ]);
  });

  it("nothing left this period: only pay in full", () => {
    expect(kinds(paymentShortcuts(6381, progress({ remainingCents: 0 }), L))).toEqual([
      ["full", 6381, "Pay in full $63.81"],
    ]);
  });

  it("caps a period shortcut at the balance and drops the duplicate", () => {
    expect(kinds(paymentShortcuts(1000, progress({ periodStatus: "overdue", remainingCents: 4000 }), L))).toEqual([
      ["catch-up", 1000, "Catch up $10.00"],
    ]);
  });

  it("drops a duplicate when remaining equals the balance", () => {
    expect(kinds(paymentShortcuts(4000, progress(), L))).toEqual([["minimum", 4000, "Minimum $40.00"]]);
  });

  it("no plan, or plan status unknown: only pay in full", () => {
    expect(kinds(paymentShortcuts(18732, null, L))).toEqual([["full", 18732, "Pay in full $187.32"]]);
    expect(kinds(paymentShortcuts(18732, undefined, L))).toEqual([["full", 18732, "Pay in full $187.32"]]);
  });

  it("nothing owed, in credit, or balance unknown: no shortcuts", () => {
    expect(paymentShortcuts(0, progress(), L)).toEqual([]);
    expect(paymentShortcuts(-500, progress({ periodStatus: "overdue" }), L)).toEqual([]);
    expect(paymentShortcuts(null, progress(), L)).toEqual([]);
  });

  it("every shortcut amount is integer cents", () => {
    for (const s of paymentShortcuts(18732, progress({ periodStatus: "overdue", remainingCents: 1501 }), L)) {
      expect(Number.isInteger(s.cents)).toBe(true);
    }
  });
});

describe("categoryIcon", () => {
  it.each([
    ["Gas", "fuel"],
    ["Food", "food"],
    ["Groceries", "food"],
    ["Phone", "phone"],
    ["Auto", "car"],
    ["Car insurance", "car"],
    ["Fun", "ticket"],
    ["School", "book"],
    ["Household", "home"],
    ["Other", "tag"],
    ["Clothes", "tag"],
  ])("%s -> %s", (name, icon) => {
    expect(categoryIcon(name)).toBe(icon);
  });
});

describe("date chips", () => {
  const today = "2026-10-01";

  it("maps a chosen date to its chip", () => {
    expect(dateChoiceFor("2026-10-01", today)).toBe("today");
    expect(dateChoiceFor("2026-09-30", today)).toBe("yesterday");
    expect(dateChoiceFor("2026-09-12", today)).toBe("pick");
    expect(dateChoiceFor("", today)).toBe("pick");
  });

  it("yesterday crosses month and year boundaries via calendar arithmetic", () => {
    expect(dateForChoice("yesterday", "2026-03-01", "")).toBe("2026-02-28");
    expect(dateForChoice("yesterday", "2027-01-01", "")).toBe("2026-12-31");
  });

  it("pick keeps the current date", () => {
    expect(dateForChoice("today", today, "2026-09-12")).toBe(today);
    expect(dateForChoice("pick", today, "2026-09-12")).toBe("2026-09-12");
  });
});
