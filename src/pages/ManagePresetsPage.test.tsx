// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ManagePresetsPage } from "./ManagePresetsPage";
import { MembershipContext } from "../features/auth/membership-context";
import type { MembershipState } from "../features/auth/membership-context";

type QueryResult<T> = { data: T | null; error: { message: string; code?: string } | null };

/**
 * A minimal chainable stand-in for supabase-js's `PostgrestFilterBuilder`,
 * mirroring `ManageCategoriesPage.test.tsx`'s convention exactly: every
 * filter/order method returns the same object, and it resolves via `.then`
 * the way the real (thenable) builder does when `await`ed.
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

function makeUpdateBuilder(resultRef: { current: { error: { message: string; code?: string } | null } }) {
  const builder: Record<string, unknown> = {};
  builder.eq = vi.fn(() => builder);
  builder.then = (
    resolve: (value: { error: { message: string; code?: string } | null }) => unknown,
    reject?: (reason: unknown) => unknown,
  ) => Promise.resolve(resultRef.current).then(resolve, reject);
  return builder;
}

function makeInsertBuilder(resultRef: { current: { error: { message: string; code?: string } | null } }) {
  const builder: Record<string, unknown> = {};
  builder.then = (
    resolve: (value: { error: { message: string; code?: string } | null }) => unknown,
    reject?: (reason: unknown) => unknown,
  ) => Promise.resolve(resultRef.current).then(resolve, reject);
  return builder;
}

type PresetRowFixture = {
  id: string;
  label: string;
  amount_cents: number;
  category_id: string | null;
  category: { name: string } | null;
  description: string | null;
  sort_order: number | null;
  active: boolean;
};

const presetsResult: QueryResult<PresetRowFixture[]> = {
  data: [
    {
      id: "p1",
      label: "School lunch",
      amount_cents: 500,
      category_id: "cat1",
      category: { name: "Food" },
      description: "Weekday lunch money",
      sort_order: 1,
      active: true,
    },
    {
      id: "p2",
      label: "Movie night",
      amount_cents: 1200,
      category_id: null,
      category: null,
      sort_order: null,
      description: null,
      active: false,
    },
  ],
  error: null,
};

const categoriesResult: QueryResult<{ id: string; name: string; sort_order: number }[]> = {
  data: [{ id: "cat1", name: "Food", sort_order: 1 }],
  error: null,
};

const updateResultRef: { current: { error: { message: string; code?: string } | null } } = {
  current: { error: null },
};

const insertResultRef: { current: { error: { message: string; code?: string } | null } } = {
  current: { error: null },
};

const { fromMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
}));

vi.mock("../lib/supabase", () => ({
  supabase: {
    from: fromMock,
  },
}));

let presetsTableMock: {
  select: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
};

let categoriesTableMock: {
  select: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
  updateResultRef.current = { error: null };
  insertResultRef.current = { error: null };

  presetsTableMock = {
    select: vi.fn(() => makeSelectBuilder(presetsResult)),
    update: vi.fn(() => makeUpdateBuilder(updateResultRef)),
    insert: vi.fn(() => makeInsertBuilder(insertResultRef)),
  };
  categoriesTableMock = {
    select: vi.fn(() => makeSelectBuilder(categoriesResult)),
  };

  fromMock.mockImplementation((table: string) => {
    if (table === "expense_presets") {
      return presetsTableMock;
    }
    if (table === "categories") {
      return categoriesTableMock;
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
    <MembershipContext.Provider value={loadedParent}>
      <ManagePresetsPage />
    </MembershipContext.Provider>,
  );
}

describe("ManagePresetsPage", () => {
  it("renders the preset list with formatted amount, category, and active state", async () => {
    renderPage();

    expect(await screen.findByText("School lunch")).toBeInTheDocument();
    expect(screen.getByText("Movie night")).toBeInTheDocument();

    const lunchRow = screen.getByText("School lunch").closest("li")!;
    expect(within(lunchRow).getByText("$5.00 · Food")).toBeInTheDocument();
    expect(within(lunchRow).getByText("Active")).toBeInTheDocument();

    const movieRow = screen.getByText("Movie night").closest("li")!;
    expect(within(movieRow).getByText("$12.00 · No category")).toBeInTheDocument();
    expect(within(movieRow).getByText("Inactive")).toBeInTheDocument();
  });

  it("adds a preset with a parsed amount and selected category", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("School lunch");

    await user.type(screen.getByLabelText("Label"), "Movie ticket");
    await user.type(screen.getByLabelText("Amount"), "8.50");
    await user.selectOptions(screen.getByLabelText("Category (optional)"), "cat1");
    await user.click(screen.getByRole("button", { name: "Add preset" }));

    await waitFor(() => {
      expect(presetsTableMock.insert).toHaveBeenCalledWith({
        household_id: "h1",
        label: "Movie ticket",
        amount_cents: 850,
        category_id: "cat1",
        description: null,
      });
    });
  });

  it("rejects an empty label without calling insert", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("School lunch");

    await user.type(screen.getByLabelText("Amount"), "5.00");
    await user.click(screen.getByRole("button", { name: "Add preset" }));

    expect(await screen.findByText("Label is required.")).toBeInTheDocument();
    expect(presetsTableMock.insert).not.toHaveBeenCalled();
  });

  it("edits an existing preset's label, amount, category, and description", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("School lunch");
    const lunchRow = screen.getByText("School lunch").closest("li")!;

    await user.click(within(lunchRow).getByRole("button", { name: "Edit" }));

    const labelInput = within(lunchRow).getByLabelText("Label");
    await user.clear(labelInput);
    await user.type(labelInput, "School lunch money");

    const amountInput = within(lunchRow).getByLabelText("Amount");
    await user.clear(amountInput);
    await user.type(amountInput, "6.25");

    await user.click(within(lunchRow).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(presetsTableMock.update).toHaveBeenCalledWith({
        label: "School lunch money",
        amount_cents: 625,
        category_id: "cat1",
        description: "Weekday lunch money",
      });
    });
  });

  it("deactivates an active preset and reactivates an inactive one", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("School lunch");
    const lunchRow = screen.getByText("School lunch").closest("li")!;
    await user.click(within(lunchRow).getByRole("button", { name: "Deactivate" }));

    await waitFor(() => {
      expect(presetsTableMock.update).toHaveBeenCalledWith({ active: false });
    });

    const movieRow = screen.getByText("Movie night").closest("li")!;
    await user.click(within(movieRow).getByRole("button", { name: "Reactivate" }));

    await waitFor(() => {
      expect(presetsTableMock.update).toHaveBeenCalledWith({ active: true });
    });
  });
});
