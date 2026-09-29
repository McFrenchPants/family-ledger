// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ManageCategoriesPage } from "./ManageCategoriesPage";
import { MembershipContext } from "../features/auth/membership-context";
import type { MembershipState } from "../features/auth/membership-context";

type QueryResult<T> = { data: T | null; error: { message: string; code?: string } | null };

/**
 * A minimal chainable stand-in for supabase-js's `PostgrestFilterBuilder`,
 * mirroring `ManageMembersPage.test.tsx`'s convention exactly: every
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

const categoriesResult: QueryResult<
  { id: string; name: string; sort_order: number | null; active: boolean }[]
> = {
  data: [
    { id: "c1", name: "Groceries", sort_order: 1, active: true },
    { id: "c2", name: "Toys", sort_order: 2, active: true },
    { id: "c3", name: "Old Category", sort_order: null, active: false },
  ],
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

let tableMock: {
  select: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
  updateResultRef.current = { error: null };
  insertResultRef.current = { error: null };
  tableMock = {
    select: vi.fn(() => makeSelectBuilder(categoriesResult)),
    update: vi.fn(() => makeUpdateBuilder(updateResultRef)),
    insert: vi.fn(() => makeInsertBuilder(insertResultRef)),
  };
  fromMock.mockReturnValue(tableMock);
});

const loadedParent: MembershipState = {
  status: "loaded",
  membership: { memberId: "m1", householdId: "h1", role: "parent", name: "Alex", status: "active" },
};

function renderPage() {
  return render(
    <MembershipContext.Provider value={loadedParent}>
      <ManageCategoriesPage />
    </MembershipContext.Provider>,
  );
}

describe("ManageCategoriesPage", () => {
  it("renders the category list with active/inactive state, never relying on color alone", async () => {
    renderPage();

    expect(await screen.findByText("Groceries")).toBeInTheDocument();
    expect(screen.getByText("Toys")).toBeInTheDocument();
    expect(screen.getByText("Old Category")).toBeInTheDocument();

    const groceriesRow = screen.getByText("Groceries").closest("li")!;
    expect(within(groceriesRow).getByText("Active")).toBeInTheDocument();

    const oldRow = screen.getByText("Old Category").closest("li")!;
    expect(within(oldRow).getByText("Inactive")).toBeInTheDocument();
  });

  it("adds a category, omitting sort_order when it is left blank", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Groceries");

    await user.type(screen.getByLabelText("Name"), "Clothes");
    await user.click(screen.getByRole("button", { name: "Add category" }));

    await waitFor(() => {
      expect(tableMock.insert).toHaveBeenCalledWith({ household_id: "h1", name: "Clothes" });
    });
  });

  it("adds a category with an explicit sort_order when provided", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Groceries");

    await user.type(screen.getByLabelText("Name"), "Clothes");
    await user.type(screen.getByLabelText("Sort order (optional)"), "5");
    await user.click(screen.getByRole("button", { name: "Add category" }));

    await waitFor(() => {
      expect(tableMock.insert).toHaveBeenCalledWith({
        household_id: "h1",
        name: "Clothes",
        sort_order: 5,
      });
    });
  });

  it("renames a category", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Groceries");
    const groceriesRow = screen.getByText("Groceries").closest("li")!;

    await user.click(within(groceriesRow).getByRole("button", { name: "Rename" }));
    const input = within(groceriesRow).getByLabelText("Name");
    await user.clear(input);
    await user.type(input, "Food");
    await user.click(within(groceriesRow).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(tableMock.update).toHaveBeenCalledWith({ name: "Food" });
    });
  });

  it("deactivates an active category and reactivates an inactive one", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Groceries");
    const groceriesRow = screen.getByText("Groceries").closest("li")!;
    await user.click(within(groceriesRow).getByRole("button", { name: "Deactivate" }));

    await waitFor(() => {
      expect(tableMock.update).toHaveBeenCalledWith({ active: false });
    });

    const oldRow = screen.getByText("Old Category").closest("li")!;
    await user.click(within(oldRow).getByRole("button", { name: "Reactivate" }));

    await waitFor(() => {
      expect(tableMock.update).toHaveBeenCalledWith({ active: true });
    });
  });
});
