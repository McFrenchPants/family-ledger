// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ManageCategoriesPage } from "./ManageCategoriesPage";
import { MembershipContext } from "../features/auth/membership-context";
import type { MembershipState } from "../features/auth/membership-context";

type QueryResult<T> = { data: T | null; error: { message: string; code?: string } | null };

/**
 * A minimal chainable stand-in for supabase-js's `PostgrestFilterBuilder`,
 * mirroring `FamilyPage.test.tsx`'s convention exactly: every
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
  {
    id: string;
    name: string;
    sort_order: number | null;
    active: boolean;
    tracked_balance_id: string | null;
  }[]
> = {
  data: [
    { id: "c1", name: "Groceries", sort_order: 1, active: true, tracked_balance_id: null },
    { id: "c2", name: "Toys", sort_order: 2, active: true, tracked_balance_id: "b-car" },
    { id: "c3", name: "Old Category", sort_order: null, active: false, tracked_balance_id: null },
  ],
  error: null,
};

const balancesResult: QueryResult<
  { id: string; name: string; sort_order: number | null; active: boolean; is_everyday: boolean }[]
> = {
  data: [
    { id: "b-car", name: "Car", sort_order: 1, active: true, is_everyday: false },
    { id: "b-college", name: "College", sort_order: 2, active: true, is_everyday: false },
    { id: "b-every", name: "Everyday", sort_order: null, active: true, is_everyday: true },
  ],
  error: null,
};

const updateResultRef: { current: { error: { message: string; code?: string } | null } } = {
  current: { error: null },
};

const insertResultRef: { current: { error: { message: string; code?: string } | null } } = {
  current: { error: null },
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
  const balancesTable = { select: vi.fn(() => makeSelectBuilder(balancesResult)) };
  fromMock.mockImplementation((table: string) =>
    table === "tracked_balances" ? balancesTable : tableMock,
  );
  rpcMock.mockResolvedValue({ error: null });
});

const loadedParent: MembershipState = {
  status: "loaded",
  membership: { memberId: "m1", householdId: "h1", role: "parent", name: "Alex", status: "active" },
};

function renderPage() {
  return render(
    <MembershipContext.Provider value={loadedParent}>
      <MemoryRouter>
        <ManageCategoriesPage />
      </MemoryRouter>
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

  it("lists balances with Everyday first and never archivable", async () => {
    renderPage();

    await screen.findByText("Groceries");
    const balances = screen.getByRole("region", { name: "Balances" });
    const rows = within(balances).getAllByRole("listitem");
    expect(rows.map((row) => within(row).getByText(/^(Everyday|Car|College)$/).textContent)).toEqual([
      "Everyday",
      "Car",
      "College",
    ]);

    expect(within(rows[0]).getByText("Default balance")).toBeInTheDocument();
    expect(within(rows[0]).getByRole("button", { name: "Rename" })).toBeInTheDocument();
    expect(within(rows[0]).queryByRole("button", { name: "Archive" })).not.toBeInTheDocument();
    expect(within(rows[1]).getByRole("button", { name: "Archive" })).toBeInTheDocument();
  });

  it("adds a balance for the household and shows a rejected archive", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Groceries");
    await user.type(screen.getByLabelText("Balance name"), "Vacation");
    await user.click(screen.getByRole("button", { name: "Add balance" }));

    await waitFor(() => {
      expect(rpcMock).toHaveBeenCalledWith("create_tracked_balance", {
        p_household_id: "h1",
        p_name: "Vacation",
      });
    });

    rpcMock.mockResolvedValueOnce({ error: { message: "Move its categories first." } });
    const carRow = screen.getByText("Car", { selector: "span" }).closest("li")!;
    await user.click(within(carRow).getByRole("button", { name: "Archive" }));

    expect(await within(carRow).findByRole("alert")).toHaveTextContent("Move its categories first.");
  });

  it("changes where a category counts, using null for Everyday", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Groceries");
    const groceriesRow = screen.getByText("Groceries").closest("li")!;
    await user.selectOptions(within(groceriesRow).getByLabelText("Counts toward"), "Car");

    await waitFor(() => {
      expect(rpcMock).toHaveBeenCalledWith("set_category_balance", {
        p_category_id: "c1",
        p_tracked_balance_id: "b-car",
      });
    });

    const toysRow = screen.getByText("Toys").closest("li")!;
    const picker = within(toysRow).getByLabelText("Counts toward");
    expect(picker).toHaveValue("b-car");
    await user.selectOptions(picker, "Everyday");

    await waitFor(() => {
      expect(rpcMock).toHaveBeenCalledWith("set_category_balance", {
        p_category_id: "c2",
        p_tracked_balance_id: null,
      });
    });
  });

  it("has one page heading and a back arrow to Settings", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { level: 1, name: "Categories" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Back to Settings" })).toHaveAttribute(
      "href",
      "/settings",
    );
  });
});
