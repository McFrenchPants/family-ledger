import { describe, expect, it } from "vitest";

import { buildExpenseMemberSelector, validateExpenseForm } from "./add-expense";

describe("buildExpenseMemberSelector", () => {
  it("offers a Parent every active Child, excluding Parents, and defaults to the first", () => {
    const result = buildExpenseMemberSelector({
      callerRole: "parent",
      callerMemberId: "parent-1",
      callerName: "Dana",
      activeMembers: [
        { id: "parent-1", name: "Dana", role: "parent" },
        { id: "child-1", name: "Alex", role: "child" },
        { id: "child-2", name: "Katie", role: "child" },
      ],
      childExpenseScope: "any_member",
    });

    expect(result).toEqual({
      options: [
        { id: "child-1", name: "Alex", role: "child" },
        { id: "child-2", name: "Katie", role: "child" },
      ],
      locked: false,
      defaultMemberId: "child-1",
    });
  });

  it("gives a Parent an empty, unlocked selector when there are no active children yet", () => {
    const result = buildExpenseMemberSelector({
      callerRole: "parent",
      callerMemberId: "parent-1",
      callerName: "Dana",
      activeMembers: [{ id: "parent-1", name: "Dana", role: "parent" }],
      childExpenseScope: "any_member",
    });

    expect(result).toEqual({ options: [], locked: false, defaultMemberId: null });
  });

  it("locks a self_only Child to themselves, offering no sibling choice", () => {
    const result = buildExpenseMemberSelector({
      callerRole: "child",
      callerMemberId: "child-1",
      callerName: "Alex",
      activeMembers: [
        { id: "child-1", name: "Alex", role: "child" },
        { id: "child-2", name: "Katie", role: "child" },
      ],
      childExpenseScope: "self_only",
    });

    expect(result).toEqual({
      options: [{ id: "child-1", name: "Alex", role: "child" }],
      locked: true,
      defaultMemberId: "child-1",
    });
  });

  it("treats an unknown (null) scope exactly like self_only -- the conservative default", () => {
    const result = buildExpenseMemberSelector({
      callerRole: "child",
      callerMemberId: "child-1",
      callerName: "Alex",
      activeMembers: [
        { id: "child-1", name: "Alex", role: "child" },
        { id: "child-2", name: "Katie", role: "child" },
      ],
      childExpenseScope: null,
    });

    expect(result).toEqual({
      options: [{ id: "child-1", name: "Alex", role: "child" }],
      locked: true,
      defaultMemberId: "child-1",
    });
  });

  it("offers an any_member Child every active Child (siblings included) and defaults to themselves", () => {
    const result = buildExpenseMemberSelector({
      callerRole: "child",
      callerMemberId: "child-1",
      callerName: "Alex",
      activeMembers: [
        { id: "child-1", name: "Alex", role: "child" },
        { id: "child-2", name: "Katie", role: "child" },
      ],
      childExpenseScope: "any_member",
    });

    expect(result).toEqual({
      options: [
        { id: "child-1", name: "Alex", role: "child" },
        { id: "child-2", name: "Katie", role: "child" },
      ],
      locked: false,
      defaultMemberId: "child-1",
    });
  });

  it("still locks an any_member Child when activeMembers only contains their own row (e.g. an only child)", () => {
    const result = buildExpenseMemberSelector({
      callerRole: "child",
      callerMemberId: "child-1",
      callerName: "Alex",
      activeMembers: [{ id: "child-1", name: "Alex", role: "child" }],
      childExpenseScope: "any_member",
    });

    expect(result).toEqual({
      options: [{ id: "child-1", name: "Alex", role: "child" }],
      locked: true,
      defaultMemberId: "child-1",
    });
  });

  it("defensively injects the caller's own row if somehow absent from activeMembers", () => {
    const result = buildExpenseMemberSelector({
      callerRole: "child",
      callerMemberId: "child-1",
      callerName: "Alex",
      activeMembers: [{ id: "child-2", name: "Katie", role: "child" }],
      childExpenseScope: "any_member",
    });

    expect(result.options).toEqual([
      { id: "child-2", name: "Katie", role: "child" },
      { id: "child-1", name: "Alex", role: "child" },
    ]);
    expect(result.defaultMemberId).toBe("child-1");
  });
});

describe("validateExpenseForm", () => {
  const validInput = {
    memberId: "child-1",
    amountInput: "12.34",
    description: "Broken window",
    occurredOn: "2026-09-05",
  };

  it("accepts a well-formed form and returns parsed cents", () => {
    const result = validateExpenseForm(validInput);
    expect(result).toEqual({ ok: true, amountCents: 1234 });
  });

  it("rejects a missing member selection", () => {
    const result = validateExpenseForm({ ...validInput, memberId: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.memberId).toBeDefined();
    }
  });

  it("rejects malformed amounts (thousands separator) before any network call, with an actionable message", () => {
    const result = validateExpenseForm({ ...validInput, amountInput: "12,34" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.amount).toMatch(/comma/i);
    }
  });

  it("rejects a negative amount", () => {
    const result = validateExpenseForm({ ...validInput, amountInput: "-5" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.amount).toMatch(/negative/i);
    }
  });

  it("rejects an empty amount", () => {
    const result = validateExpenseForm({ ...validInput, amountInput: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.amount).toMatch(/enter an amount/i);
    }
  });

  it("rejects a zero amount, distinctly from a malformed one", () => {
    const result = validateExpenseForm({ ...validInput, amountInput: "0" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.amount).toMatch(/greater than zero/i);
    }
  });

  it("rejects an empty description", () => {
    const result = validateExpenseForm({ ...validInput, description: "   " });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.description).toBeDefined();
    }
  });

  it("rejects an invalid date", () => {
    const result = validateExpenseForm({ ...validInput, occurredOn: "2026-02-30" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.occurredOn).toBeDefined();
    }
  });
});
