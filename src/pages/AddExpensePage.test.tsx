// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AddExpensePage } from "./AddExpensePage";
import { MembershipContext } from "../features/auth/membership-context";
import type { MembershipState } from "../features/auth/membership-context";

type QueryResult<T> = { data: T | null; error: { message: string; code?: string } | null };

/**
 * A minimal chainable stand-in for supabase-js's `PostgrestFilterBuilder`,
 * mirroring `ManagePresetsPage.test.tsx`'s convention: every filter/order
 * method returns the same object, and it resolves via `.then` the way the
 * real (thenable) builder does when `await`ed -- used for every query in
 * this file except the household settings lookup, which terminates in
 * `.maybeSingle()` instead of `.returns()`.
 */
function makeSelectBuilder<T>(result: QueryResult<T>) {
  const builder: Record<string, unknown> = {};
  builder.eq = vi.fn(() => builder);
  builder.order = vi.fn(() => builder);
  builder.returns = vi.fn(() => builder);
  builder.then = (resolve: (value: QueryResult<T>) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

function makeMaybeSingleBuilder<T>(result: QueryResult<T>) {
  const builder: Record<string, unknown> = {};
  builder.eq = vi.fn(() => builder);
  builder.maybeSingle = vi.fn(() => Promise.resolve(result));
  return builder;
}

const householdResult: QueryResult<{ timezone: string; child_expense_scope: string }> = {
  data: { timezone: "America/Los_Angeles", child_expense_scope: "any_member" },
  error: null,
};

const membersResult: QueryResult<{ id: string; name: string; role: string; status: string }[]> = {
  data: [
    { id: "m1", name: "Alex", role: "parent", status: "active" },
    { id: "m2", name: "Sam", role: "child", status: "active" },
  ],
  error: null,
};

const categoriesResult: QueryResult<{ id: string; name: string; sort_order: number }[]> = {
  data: [
    { id: "cat1", name: "Food", sort_order: 1 },
    { id: "cat2", name: "Gas", sort_order: 2 },
  ],
  error: null,
};

type PresetRowFixture = {
  id: string;
  label: string;
  amount_cents: number;
  category_id: string | null;
  description: string | null;
  sort_order: number | null;
};

let presetsResult: QueryResult<PresetRowFixture[]> = {
  data: [
    {
      id: "p1",
      label: "Gas",
      amount_cents: 2000,
      category_id: "cat2",
      description: "Fill up",
      sort_order: 1,
    },
    {
      id: "p2",
      label: "Phone",
      amount_cents: 5000,
      category_id: null,
      description: null,
      sort_order: 2,
    },
  ],
  error: null,
};

const { fromMock, rpcMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  rpcMock: vi.fn(),
}));

vi.mock("../lib/supabase", () => ({
  supabase: {
    from: fromMock,
    rpc: rpcMock,
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  rpcMock.mockResolvedValue({ error: null });

  fromMock.mockImplementation((table: string) => {
    if (table === "households") {
      return { select: vi.fn(() => makeMaybeSingleBuilder(householdResult)) };
    }
    if (table === "household_members") {
      return { select: vi.fn(() => makeSelectBuilder(membersResult)) };
    }
    if (table === "categories") {
      return { select: vi.fn(() => makeSelectBuilder(categoriesResult)) };
    }
    if (table === "expense_presets") {
      return { select: vi.fn(() => makeSelectBuilder(presetsResult)) };
    }
    throw new Error(`Unexpected table: ${table}`);
  });
});

const loadedParent: MembershipState = {
  status: "loaded",
  membership: { memberId: "m1", householdId: "h1", role: "parent", name: "Alex", status: "active" },
};

function renderPage() {
  return render(
    <MemoryRouter>
      <MembershipContext.Provider value={loadedParent}>
        <AddExpensePage />
      </MembershipContext.Provider>
    </MemoryRouter>,
  );
}

describe("AddExpensePage quick-add presets", () => {
  it("renders active presets as quick-add buttons", async () => {
    renderPage();

    expect(await screen.findByRole("button", { name: "Gas" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Phone" })).toBeInTheDocument();
  });

  it("prefills amount, category, and description from a clicked preset without submitting", async () => {
    const user = userEvent.setup();
    renderPage();

    const gasButton = await screen.findByRole("button", { name: "Gas" });
    await user.click(gasButton);

    const amountInput = screen.getByLabelText("Amount") as HTMLInputElement;
    const categorySelect = screen.getByLabelText("Category (optional)") as HTMLSelectElement;
    const descriptionInput = screen.getByLabelText("Description") as HTMLInputElement;

    await waitFor(() => {
      expect(amountInput.value).toBe("20.00");
    });
    expect(categorySelect.value).toBe("cat2");
    expect(descriptionInput.value).toBe("Fill up");

    // Never auto-submits.
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("keeps prefilled fields editable after a preset click", async () => {
    const user = userEvent.setup();
    renderPage();

    const gasButton = await screen.findByRole("button", { name: "Gas" });
    await user.click(gasButton);

    const amountInput = screen.getByLabelText("Amount") as HTMLInputElement;
    await waitFor(() => expect(amountInput.value).toBe("20.00"));

    await user.clear(amountInput);
    await user.type(amountInput, "15.50");
    expect(amountInput.value).toBe("15.50");

    const descriptionInput = screen.getByLabelText("Description") as HTMLInputElement;
    await user.clear(descriptionInput);
    await user.type(descriptionInput, "Custom note");
    expect(descriptionInput.value).toBe("Custom note");

    const categorySelect = screen.getByLabelText("Category (optional)") as HTMLSelectElement;
    await user.selectOptions(categorySelect, "cat1");
    expect(categorySelect.value).toBe("cat1");
  });

  it("renders no quick-add section when the household has zero active presets", async () => {
    presetsResult = { data: [], error: null };
    renderPage();

    // Wait for the form to finish loading before asserting absence.
    await screen.findByLabelText("Amount");

    expect(screen.queryByText("Quick add")).not.toBeInTheDocument();
  });
});
