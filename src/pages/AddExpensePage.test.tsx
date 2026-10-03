// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AddExpensePage } from "./AddExpensePage";
import { MembershipContext } from "../features/auth/membership-context";
import type { MembershipState } from "../features/auth/membership-context";
import { addDays, todayInZone } from "../lib/dates";

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

let balancesResult: QueryResult<{ member_id: string; balance_cents: number }[]> = {
  data: [],
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
  balancesResult = { data: [], error: null };
  rpcMock.mockImplementation((name: string) =>
    Promise.resolve(name === "household_member_balances" ? balancesResult : { error: null }),
  );

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

/** The checked radio in a named single-choice group (Radix ToggleGroup type="single"). */
function selectedIn(groupName: string): HTMLElement {
  const group = screen.getByRole("radiogroup", { name: groupName });
  const selected = within(group)
    .getAllByRole("radio")
    .filter((radio) => radio.getAttribute("aria-checked") === "true");
  expect(selected).toHaveLength(1);
  return selected[0]!;
}

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

    expect(await screen.findByRole("button", { name: "Gas $20.00" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Phone $50.00" })).toBeInTheDocument();
  });

  it("prefills amount, category, and description from a clicked preset without submitting", async () => {
    const user = userEvent.setup();
    renderPage();

    const gasButton = await screen.findByRole("button", { name: "Gas $20.00" });
    await user.click(gasButton);

    const amountInput = screen.getByLabelText("Amount") as HTMLInputElement;
    const descriptionInput = screen.getByLabelText("What was it?") as HTMLInputElement;

    await waitFor(() => {
      expect(amountInput.value).toBe("20.00");
    });
    expect(selectedIn("Category (optional)")).toHaveTextContent("Gas");
    expect(descriptionInput.value).toBe("Fill up");

    // Never auto-submits.
    expect(rpcMock).not.toHaveBeenCalledWith("record_expense", expect.anything());
  });

  it("keeps prefilled fields editable after a preset click", async () => {
    const user = userEvent.setup();
    renderPage();

    const gasButton = await screen.findByRole("button", { name: "Gas $20.00" });
    await user.click(gasButton);

    const amountInput = screen.getByLabelText("Amount") as HTMLInputElement;
    await waitFor(() => expect(amountInput.value).toBe("20.00"));

    await user.clear(amountInput);
    await user.type(amountInput, "15.50");
    expect(amountInput.value).toBe("15.50");

    const descriptionInput = screen.getByLabelText("What was it?") as HTMLInputElement;
    await user.clear(descriptionInput);
    await user.type(descriptionInput, "Custom note");
    expect(descriptionInput.value).toBe("Custom note");

    await user.click(screen.getByRole("radio", { name: "Food" }));
    expect(selectedIn("Category (optional)")).toHaveTextContent("Food");
  });

  it("renders no quick-add section when the household has zero active presets", async () => {
    presetsResult = { data: [], error: null };
    renderPage();

    // Wait for the form to finish loading before asserting absence.
    await screen.findByLabelText("Amount");

    expect(screen.queryByText("Quick add")).not.toBeInTheDocument();
  });
});

describe("AddExpensePage ?child= prefill", () => {
  const twoChildren: QueryResult<{ id: string; name: string; role: string; status: string }[]> = {
    data: [
      { id: "m1", name: "Alex", role: "parent", status: "active" },
      { id: "m2", name: "Sam", role: "child", status: "active" },
      { id: "m3", name: "Jo", role: "child", status: "active" },
    ],
    error: null,
  };

  function renderAt(path: string) {
    const original = fromMock.getMockImplementation()!;
    fromMock.mockImplementation((table: string) =>
      table === "household_members"
        ? { select: vi.fn(() => makeSelectBuilder(twoChildren)) }
        : original(table),
    );
    return render(
      <MemoryRouter initialEntries={[path]}>
        <MembershipContext.Provider value={loadedParent}>
          <AddExpensePage />
        </MembershipContext.Provider>
      </MemoryRouter>,
    );
  }

  it("selects the child named in the link", async () => {
    renderAt("/new/expense?child=m3");
    await waitFor(() => expect(selectedIn("For")).toHaveTextContent("Jo"));
  });

  it("ignores an id that is not one of the choices", async () => {
    renderAt("/new/expense?child=m1");
    await waitFor(() => expect(selectedIn("For")).toHaveTextContent("Sam"));
  });
});

describe("AddExpensePage chooser for every role", () => {
  const family: QueryResult<{ id: string; name: string; role: string; status: string }[]> = {
    data: [
      { id: "m1", name: "Dana", role: "parent", status: "active" },
      { id: "m2", name: "Sam", role: "child", status: "active" },
      { id: "m3", name: "Jo", role: "child", status: "active" },
    ],
    error: null,
  };

  function renderAs(membership: MembershipState, scope: "any_member" | "self_only" = "any_member") {
    const original = fromMock.getMockImplementation()!;
    fromMock.mockImplementation((table: string) => {
      if (table === "household_members") return { select: vi.fn(() => makeSelectBuilder(family)) };
      if (table === "households") {
        return {
          select: vi.fn(() =>
            makeMaybeSingleBuilder({
              data: { timezone: "America/Los_Angeles", child_expense_scope: scope },
              error: null,
            }),
          ),
        };
      }
      return original(table);
    });
    return render(
      <MemoryRouter initialEntries={["/new/expense"]}>
        <MembershipContext.Provider value={membership}>
          <Routes>
            <Route path="/new/expense" element={<AddExpensePage />} />
            <Route path="/home" element={<p>stub: home</p>} />
          </Routes>
        </MembershipContext.Provider>
      </MemoryRouter>,
    );
  }

  const childSam: MembershipState = {
    status: "loaded",
    membership: { memberId: "m2", householdId: "h1", role: "child", name: "Sam", status: "active" },
  };

  it("lets a Child pick a sibling when the household allows it", async () => {
    // A Child's balance read only ever returns their own row.
    balancesResult = { data: [{ member_id: "m2", balance_cents: 1000 }], error: null };
    const user = userEvent.setup();
    renderAs(childSam);

    await waitFor(() => expect(selectedIn("For")).toHaveTextContent("Sam"));
    await user.type(screen.getByLabelText("Amount"), "5");
    expect(screen.getByRole("button", { name: "Add $5.00 to your balance" })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("expense-balance-preview")).toHaveTextContent(
        "Your balance will be $15.00",
      ),
    );

    // Picking a sibling: their balance is not visible to a Child, so no
    // preview at all -- never a wrong or zero one.
    await user.click(screen.getByRole("radio", { name: "Jo" }));
    expect(screen.getByRole("button", { name: "Add $5.00 to Jo’s balance" })).toBeInTheDocument();
    expect(screen.queryByTestId("expense-balance-preview")).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("What was it?"), "Snacks");
    await user.click(screen.getByRole("button", { name: "Add $5.00 to Jo’s balance" }));
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith(
        "record_expense",
        expect.objectContaining({ p_member_id: "m3", p_amount_cents: 500 }),
      ),
    );
    expect(await screen.findByText("stub: home")).toBeInTheDocument();
  });

  it("offers a Child only themselves in a self_only household", async () => {
    renderAs(childSam, "self_only");
    await waitFor(() => expect(selectedIn("For")).toHaveTextContent("Sam"));
    expect(within(screen.getByRole("radiogroup", { name: "For" })).getAllByRole("radio")).toHaveLength(1);
  });

  it("previews a Parent's choice of child", async () => {
    balancesResult = {
      data: [
        { member_id: "m1", balance_cents: 0 },
        { member_id: "m2", balance_cents: 18732 },
        { member_id: "m3", balance_cents: 500 },
      ],
      error: null,
    };
    const user = userEvent.setup();
    renderAs(loadedParent);

    await waitFor(() => expect(selectedIn("For")).toHaveTextContent("Sam"));
    expect(screen.getByRole("button", { name: "Add expense" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("Amount"), "42.17");
    expect(screen.getByRole("button", { name: "Add $42.17 to Sam’s balance" })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("expense-balance-preview")).toHaveTextContent(
        "Sam’s balance will be $229.49",
      ),
    );
    await user.click(screen.getByRole("radio", { name: "Jo" }));
    expect(screen.getByTestId("expense-balance-preview")).toHaveTextContent(
      "Jo’s balance will be $47.17",
    );
  });

  it("still works with no preview when balances fail to load", async () => {
    balancesResult = { data: null, error: { message: "nope" } };
    const user = userEvent.setup();
    renderAs(loadedParent);
    await waitFor(() => expect(selectedIn("For")).toHaveTextContent("Sam"));
    await user.type(screen.getByLabelText("Amount"), "3");
    await user.type(screen.getByLabelText("What was it?"), "Gum");
    expect(screen.queryByTestId("expense-balance-preview")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add $3.00 to Sam’s balance" }));
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith("record_expense", expect.objectContaining({ p_amount_cents: 300 })),
    );
  });
});

describe("AddExpensePage dates, errors and retries", () => {
  const zone = "America/Los_Angeles";

  async function ready() {
    renderPage();
    await screen.findByLabelText("Amount");
    await waitFor(() => expect(selectedIn("For")).toHaveTextContent("Sam"));
  }

  it("defaults to today in the household zone; Yesterday is the day before", async () => {
    const user = userEvent.setup();
    await ready();
    expect(selectedIn("Date")).toHaveTextContent("Today");

    await user.click(screen.getByRole("radio", { name: "Yesterday" }));
    await user.type(screen.getByLabelText("Amount"), "1");
    await user.type(screen.getByLabelText("What was it?"), "Gum");
    await user.click(screen.getByRole("button", { name: /^Add \$1\.00/ }));
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith(
        "record_expense",
        expect.objectContaining({ p_occurred_on: addDays(todayInZone(zone), -1) }),
      ),
    );
  });

  it("Pick date reveals a date field", async () => {
    const user = userEvent.setup();
    await ready();
    expect(screen.queryByLabelText("Pick a date")).not.toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Pick date" }));
    expect(screen.getByLabelText("Pick a date")).toHaveValue(todayInZone(zone));
  });

  it("lists what to fix in an announced summary and marks the fields", async () => {
    const user = userEvent.setup();
    await ready();
    await user.click(screen.getByRole("button", { name: "Add expense" }));
    const summary = screen.getByRole("alert");
    expect(summary).toHaveTextContent("Enter a description.");
    expect(screen.getByLabelText("Amount")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("What was it?")).toHaveAttribute("aria-invalid", "true");
    expect(rpcMock).not.toHaveBeenCalledWith("record_expense", expect.anything());
  });

  it("shows a retry state on a failed save and never queues it", async () => {
    let calls = 0;
    rpcMock.mockImplementation((name: string) => {
      if (name === "record_expense") {
        calls += 1;
        return Promise.resolve({ error: { message: "network down" } });
      }
      return Promise.resolve({ data: [], error: null });
    });
    const user = userEvent.setup();
    await ready();
    await user.type(screen.getByLabelText("Amount"), "2");
    await user.type(screen.getByLabelText("What was it?"), "Gum");
    await user.click(screen.getByRole("button", { name: /^Add \$2\.00/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not save this expense: network down",
    );
    expect(calls).toBe(1);
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(calls).toBe(2));
  });

  it("disables the button while saving so a double tap records once", async () => {
    rpcMock.mockImplementation((name: string) =>
      name === "record_expense" ? new Promise(() => {}) : Promise.resolve({ data: [], error: null }),
    );
    const user = userEvent.setup();
    await ready();
    await user.type(screen.getByLabelText("Amount"), "2");
    await user.type(screen.getByLabelText("What was it?"), "Gum");
    await user.click(screen.getByRole("button", { name: /^Add \$2\.00/ }));

    const saving = screen.getByRole("button", { name: /Saving/ });
    expect(saving).toBeDisabled();
    await user.click(saving);
    expect(rpcMock.mock.calls.filter(([name]) => name === "record_expense")).toHaveLength(1);
  });
});
