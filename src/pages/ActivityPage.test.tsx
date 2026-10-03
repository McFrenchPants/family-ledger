// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ActivityPage } from "./ActivityPage";
import { HomePage } from "./HomePage";
import { MembershipContext } from "../features/auth/membership-context";
import type { MembershipState } from "../features/auth/membership-context";
import type { ActivityTransactionRow } from "../features/ledger/history";
import type { HouseholdBalancesState } from "../features/ledger/useHouseholdBalances";
import type { HouseholdCategoriesState } from "../features/ledger/useHouseholdCategories";
import type { HouseholdMembersState } from "../features/members/useHouseholdMembers";

const { fromMock, rpcMock } = vi.hoisted(() => ({ fromMock: vi.fn(), rpcMock: vi.fn() }));
vi.mock("../lib/supabase", () => ({ supabase: { from: fromMock, rpc: rpcMock } }));
vi.mock("./ParentDashboardPage", () => ({ ParentDashboardPage: () => <p>parent dashboard</p> }));
vi.mock("./ChildDashboardPage", () => ({ ChildDashboardPage: () => <p>child dashboard</p> }));

let balances: HouseholdBalancesState = { status: "loading" };
vi.mock("../features/ledger/useHouseholdBalances", () => ({
  useHouseholdBalances: () => balances,
}));
let householdMembers: HouseholdMembersState = { status: "loading" };
vi.mock("../features/members/useHouseholdMembers", () => ({
  useHouseholdMembers: () => householdMembers,
}));
vi.mock("../features/ledger/useHouseholdTimezone", () => ({
  useHouseholdTimezone: () => ({ status: "loaded", timezone: "America/Los_Angeles" }),
}));
const categories: HouseholdCategoriesState = {
  status: "loaded",
  categories: [{ id: "cat-gas", name: "Gas", sortOrder: 1 }],
  refetch: () => {},
};
vi.mock("../features/ledger/useHouseholdCategories", () => ({
  useHouseholdCategories: () => categories,
}));

/* ---------------- supabase query-builder stand-in ---------------- */

type Call = { method: string; args: unknown[] };
type Response = { data: ActivityTransactionRow[] | null; error: { message: string } | null };

/** Every ledger query the page made, as its chained calls. */
let queries: Call[][] = [];
/** The rows the "server" holds; each query gets its `.range()` slice. */
let dataset: ActivityTransactionRow[] = [];
/** Override for one-off failures. */
let respond: ((calls: Call[]) => Response | Promise<Response>) | null = null;

function rangeOf(calls: Call[]): [number, number] {
  const range = calls.find((call) => call.method === "range");
  return range ? (range.args as [number, number]) : [0, Number.MAX_SAFE_INTEGER];
}

function builder() {
  const calls: Call[] = [];
  queries.push(calls);
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "not", "gte", "lte", "order", "range", "returns"]) {
    chain[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return chain;
    };
  }
  chain.then = (resolve: (value: Response) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve()
      .then(() => {
        if (respond) return respond(calls);
        const [first, last] = rangeOf(calls);
        return { data: dataset.slice(first, last + 1), error: null };
      })
      .then(resolve, reject);
  return chain;
}

const lastQuery = () => queries[queries.length - 1]!;
const hasCall = (calls: Call[], method: string, ...args: unknown[]) =>
  calls.some((call) => call.method === method && JSON.stringify(call.args) === JSON.stringify(args));

function row(index: number, overrides: Partial<ActivityTransactionRow> = {}): ActivityTransactionRow {
  return {
    id: `tx-${index}`,
    member_id: "c1",
    description: `Item ${index}`,
    note: null,
    amount_cents: 1000 + index,
    type: "expense",
    occurred_on: "2026-09-20",
    created_at: "2026-09-20T16:14:00Z",
    voided_at: null,
    void_reason: null,
    category: { name: "Gas" },
    created_by_member: { name: "Dana" },
    voided_by_member: null,
    ...overrides,
  };
}

/* ---------------- rendering ---------------- */

const member = (role: "parent" | "child", memberId = "me"): MembershipState => ({
  status: "loaded",
  membership: { memberId, householdId: "h1", role, name: "X", status: "active" },
});

function LocationProbe() {
  const location = useLocation();
  return <p data-testid="location">{location.pathname + location.search}</p>;
}

function renderAt(path: string, state: MembershipState, element = <ActivityPage />) {
  return render(
    <MembershipContext.Provider value={state}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/activity"
            element={
              <>
                {element}
                <LocationProbe />
              </>
            }
          />
          <Route path="/home" element={element} />
          <Route path="/sign-in" element={<p>sign-in page</p>} />
        </Routes>
      </MemoryRouter>
    </MembershipContext.Provider>,
  );
}

const roster: HouseholdBalancesState = {
  status: "loaded",
  children: [
    { memberId: "c1", name: "Alex", balanceCents: 100 },
    { memberId: "c2", name: "Sam", balanceCents: 0 },
  ],
};

beforeEach(() => {
  fromMock.mockReset();
  fromMock.mockImplementation(() => builder());
  rpcMock.mockReset();
  queries = [];
  dataset = [];
  respond = null;
  balances = roster;
  householdMembers = { status: "loading" };
});


describe("ActivityPage as a Child", () => {
  it("reads only their own rows, with no child chips, export or void", async () => {
    dataset = [row(1, { member_id: "me", description: "Gas on the way to work" })];
    renderAt("/activity", member("child"));

    await userEvent.click(await screen.findByRole("button", { name: /Gas on the way to work/ }));

    expect(screen.getByRole("heading", { level: 1, name: "Activity" })).toBeInTheDocument();
    expect(hasCall(lastQuery(), "eq", "member_id", "me")).toBe(true);
    expect(screen.queryByRole("radiogroup", { name: "Child" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Export/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Void this entry/ })).not.toBeInTheDocument();
    // A single person's view does not repeat their name on each row.
    expect(screen.getByText("Gas · added by Dana")).toBeInTheDocument();
  });

  it("ignores ?child= for a child", async () => {
    renderAt("/activity?child=sibling", member("child"));
    await screen.findByText("No activity yet");
    expect(queries.every((calls) => hasCall(calls, "eq", "member_id", "me"))).toBe(true);
    expect(queries.some((calls) => hasCall(calls, "eq", "member_id", "sibling"))).toBe(false);
  });

  it("shows the teaching empty state", async () => {
    renderAt("/activity", member("child"));
    expect(await screen.findByText("No activity yet")).toBeInTheDocument();
    expect(screen.getByText(/add it as an expense/)).toBeInTheDocument();
  });
});

describe("ActivityPage as a Parent", () => {
  it("shows everyone by default, naming each row's child, with an Export link", async () => {
    dataset = [
      row(1, { description: "Gas on the way to work" }),
      row(2, {
        member_id: "c2",
        description: "Payment",
        type: "payment",
        amount_cents: -2000,
        category: null,
      }),
    ];
    renderAt("/activity", member("parent"));

    await screen.findByText("Gas on the way to work");
    expect(hasCall(lastQuery(), "eq", "household_id", "h1")).toBe(true);
    expect(lastQuery().some((call) => call.method === "eq" && call.args[0] === "member_id")).toBe(false);
    expect(screen.getByRole("radio", { name: "Everyone" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("Alex · Gas · added by Dana")).toBeInTheDocument();
    expect(screen.getByText("Sam · Payment · recorded by Dana")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Export/ })).toHaveAttribute("href", "/settings/export");
    // Payments: a true minus and the ok colour; expenses: a plus in ink.
    expect(screen.getByText("−$20.00").closest("[data-kind]")).toHaveClass("text-ok");
    expect(screen.getByText("+$10.01").closest("[data-kind]")).toHaveClass("text-ink");
  });

  it("names an archived child's rows in the Everyone view, without giving them a chip", async () => {
    householdMembers = {
      status: "loaded",
      refetch: () => {},
      members: [
        { id: "p1", name: "Dana", role: "parent", status: "active", createdAt: "2026-01-01", archivedAt: null },
        { id: "c1", name: "Alex", role: "child", status: "active", createdAt: "2026-01-01", archivedAt: null },
        { id: "c2", name: "Sam", role: "child", status: "active", createdAt: "2026-01-01", archivedAt: null },
        {
          id: "c9",
          name: "Jordan",
          role: "child",
          status: "archived",
          createdAt: "2026-01-01",
          archivedAt: "2026-06-01T00:00:00Z",
        },
      ],
    };
    dataset = [row(1, { member_id: "c9", description: "Old phone bill" })];
    renderAt("/activity", member("parent"));

    await screen.findByText("Old phone bill");
    expect(screen.getByText("Jordan · Gas · added by Dana")).toBeInTheDocument();
    const chips = screen.getByRole("radiogroup", { name: "Child" });
    expect(within(chips).getAllByRole("radio").map((chip) => chip.textContent)).toEqual([
      "Everyone",
      "Alex",
      "Sam",
    ]);
  });

  it("still names active children's rows when the member list fails", async () => {
    householdMembers = { status: "error", message: "db down", retry: () => {} };
    dataset = [row(1, { description: "Gas on the way to work" })];
    renderAt("/activity", member("parent"));

    expect(await screen.findByText("Alex · Gas · added by Dana")).toBeInTheDocument();
  });

  it("orders newest first with an id tiebreak and fetches 50 at a time", async () => {
    renderAt("/activity", member("parent"));
    await screen.findByText("No activity yet");
    const calls = lastQuery();
    expect(hasCall(calls, "order", "occurred_on", { ascending: false })).toBe(true);
    expect(hasCall(calls, "order", "created_at", { ascending: false })).toBe(true);
    expect(hasCall(calls, "order", "id", { ascending: false })).toBe(true);
    expect(hasCall(calls, "range", 0, 49)).toBe(true);
  });

  it("preselects ?child= and keeps the address in step with the chips", async () => {
    dataset = [row(1)];
    renderAt("/activity?child=c1", member("parent"));

    await screen.findByText("Item 1");
    expect(screen.getByRole("radio", { name: "Alex" })).toHaveAttribute("aria-checked", "true");
    expect(hasCall(lastQuery(), "eq", "member_id", "c1")).toBe(true);
    expect(screen.getByText("Gas · added by Dana")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Payment plan/ })).toHaveAttribute("href", "/family/c1");

    await userEvent.click(screen.getByRole("radio", { name: "Sam" }));
    expect(screen.getByTestId("location")).toHaveTextContent("/activity?child=c2");
    await waitFor(() => expect(hasCall(lastQuery(), "eq", "member_id", "c2")).toBe(true));

    await userEvent.click(screen.getByRole("radio", { name: "Everyone" }));
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/activity$/);
    expect(screen.queryByRole("link", { name: /Payment plan/ })).not.toBeInTheDocument();
  });

  it("shows an empty state, not a crash, for an unknown child", async () => {
    renderAt("/activity?child=nobody", member("parent"));
    expect(await screen.findByText("No activity yet")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Show everyone" }));
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/activity$/);
  });

  it("expands a row to show when it was entered, its note and the void control", async () => {
    dataset = [row(1, { description: "Phone bill", note: "October plan share." })];
    renderAt("/activity", member("parent"));

    const button = await screen.findByRole("button", { name: /Phone bill/ });
    expect(button).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    // 16:14 UTC is 9:14 AM in the household's zone, not the test machine's.
    expect(screen.getByText("Entered Sep 20, 2026, 9:14 AM")).toBeInTheDocument();
    expect(screen.getByText("Note: October plan share.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Void this entry/ })).toBeInTheDocument();

    await userEvent.click(button);
    expect(screen.queryByText("Note: October plan share.")).not.toBeInTheDocument();
  });

  it("keeps voided rows visible, struck through, chipped, with their reason and no void control", async () => {
    dataset = [
      row(1, {
        description: "Movie tickets",
        voided_at: "2026-09-21T10:00:00Z",
        void_reason: "Entered twice",
        voided_by_member: { name: "Dad" },
      }),
    ];
    renderAt("/activity", member("parent"));

    const button = await screen.findByRole("button", { name: /Movie tickets/ });
    expect(screen.getByText("Movie tickets")).toHaveClass("line-through");
    expect(within(button).getByText("Voided")).toBeInTheDocument();
    expect(screen.getByText("+$10.01").closest("[data-kind]")).toHaveClass("line-through");

    await userEvent.click(button);
    expect(screen.getByText("Voided by Dad · Reason: Entered twice")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Void this entry/ })).not.toBeInTheDocument();
  });

  it("voids with a reason, then reloads the list", async () => {
    dataset = [row(1, { description: "Phone bill" })];
    rpcMock.mockResolvedValue({ error: null });
    renderAt("/activity", member("parent"));

    await userEvent.click(await screen.findByRole("button", { name: /Phone bill/ }));
    await userEvent.click(screen.getByRole("button", { name: /Void this entry/ }));
    expect(screen.getByRole("button", { name: "Confirm void" })).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Reason for voiding (required)"), "Duplicate");

    const before = queries.length;
    dataset = [
      row(1, {
        description: "Phone bill",
        voided_at: "2026-09-21T10:00:00Z",
        void_reason: "Duplicate",
        voided_by_member: { name: "X" },
      }),
    ];
    await userEvent.click(screen.getByRole("button", { name: "Confirm void" }));

    expect(rpcMock).toHaveBeenCalledWith("void_ledger_transaction", {
      p_transaction_id: "tx-1",
      p_void_reason: "Duplicate",
    });
    await waitFor(() => expect(queries.length).toBe(before + 1));
    await waitFor(() =>
      expect(within(screen.getByRole("button", { name: /Phone bill/ })).getByText("Voided")).toBeInTheDocument(),
    );
  });

  it("shows the void RPC's own error and lets the parent try again", async () => {
    dataset = [row(1, { description: "Phone bill" })];
    rpcMock.mockResolvedValueOnce({ error: { message: "already voided" } });
    renderAt("/activity", member("parent"));

    await userEvent.click(await screen.findByRole("button", { name: /Phone bill/ }));
    await userEvent.click(screen.getByRole("button", { name: /Void this entry/ }));
    await userEvent.type(screen.getByLabelText("Reason for voiding (required)"), "Dup");
    await userEvent.click(screen.getByRole("button", { name: "Confirm void" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not void this transaction: already voided",
    );
    expect(screen.getByRole("button", { name: "Confirm void" })).toBeEnabled();
  });
});

describe("ActivityPage pagination and filters", () => {
  const many = (count: number) => Array.from({ length: count }, (_, index) => row(index + 1));

  it("loads 50, appends 50 more on Load more, and stops when a short page comes back", async () => {
    dataset = many(120);
    renderAt("/activity", member("parent"));

    expect(await screen.findByTestId("activity-count")).toHaveTextContent(
      "Showing 50 — load more for older entries",
    );
    expect(screen.getAllByRole("button", { name: /^Item / })).toHaveLength(50);

    await userEvent.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() => expect(screen.getAllByRole("button", { name: /^Item / })).toHaveLength(100));
    expect(hasCall(lastQuery(), "range", 50, 99)).toBe(true);
    // Appended, in order, after the first page.
    const items = screen.getAllByRole("button", { name: /^Item / });
    expect(items[50]).toHaveAccessibleName(/^Item 51\b/);

    await userEvent.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() => expect(screen.getAllByRole("button", { name: /^Item / })).toHaveLength(120));
    expect(hasCall(lastQuery(), "range", 100, 149)).toBe(true);
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
    expect(screen.getByTestId("activity-count")).toHaveTextContent(/^Showing 120$/);
  });

  it("has no Load more when the first page is short", async () => {
    dataset = many(3);
    renderAt("/activity", member("parent"));
    expect(await screen.findByTestId("activity-count")).toHaveTextContent(/^Showing 3$/);
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("goes back to page one when a filter changes", async () => {
    dataset = many(120);
    renderAt("/activity", member("parent"));

    await userEvent.click(await screen.findByRole("button", { name: "Load more" }));
    await waitFor(() => expect(screen.getAllByRole("button", { name: /^Item / })).toHaveLength(100));

    await userEvent.click(screen.getByRole("radio", { name: "Payments" }));
    await waitFor(() => expect(hasCall(lastQuery(), "eq", "type", "payment")).toBe(true));
    expect(hasCall(lastQuery(), "range", 0, 49)).toBe(true);
    await waitFor(() => expect(screen.getAllByRole("button", { name: /^Item / })).toHaveLength(50));

    await userEvent.click(screen.getByRole("radio", { name: "Voided" }));
    await waitFor(() => expect(hasCall(lastQuery(), "not", "voided_at", "is", null)).toBe(true));
    expect(lastQuery().some((call) => call.method === "eq" && call.args[0] === "type")).toBe(false);
    expect(hasCall(lastQuery(), "range", 0, 49)).toBe(true);
  });

  it("applies category, dates and adjustments from the Filters sheet, with a count badge", async () => {
    renderAt("/activity", member("parent"));
    await screen.findByText("No activity yet");

    await userEvent.click(screen.getByRole("button", { name: /^Filters/ }));
    const sheet = screen.getByRole("dialog", { name: "Filters" });
    await userEvent.selectOptions(within(sheet).getByLabelText("Category"), "cat-gas");
    await waitFor(() => expect(hasCall(lastQuery(), "eq", "category_id", "cat-gas")).toBe(true));

    await userEvent.type(within(sheet).getByLabelText("From"), "2026-09-01");
    await waitFor(() => expect(hasCall(lastQuery(), "gte", "occurred_on", "2026-09-01")).toBe(true));

    await userEvent.click(within(sheet).getByLabelText("Only adjustments"));
    await waitFor(() => expect(hasCall(lastQuery(), "eq", "type", "adjustment")).toBe(true));

    await userEvent.click(within(sheet).getByRole("button", { name: "Done" }));
    expect(screen.getByRole("button", { name: /^Filters/ })).toHaveAccessibleName("Filters 3 active");

    expect(await screen.findByText("Nothing matches these filters")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    await waitFor(() => {
      const calls = lastQuery();
      expect(calls.some((call) => ["gte", "lte", "not"].includes(call.method))).toBe(false);
      expect(calls.some((call) => call.method === "eq" && ["type", "category_id"].includes(call.args[0] as string))).toBe(false);
    });
    expect(screen.getByRole("button", { name: /^Filters/ })).toHaveAccessibleName("Filters");
  });

  it("shows a load error with a working retry", async () => {
    respond = () => ({ data: null, error: { message: "network down" } });
    renderAt("/activity", member("parent"));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load activity: network down");
    respond = null;
    dataset = [row(1)];
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Item 1")).toBeInTheDocument();
  });

  it("keeps loaded rows when Load more fails, and retries", async () => {
    dataset = many(60);
    renderAt("/activity", member("parent"));
    await screen.findByRole("button", { name: "Load more" });

    respond = () => ({ data: null, error: { message: "timeout" } });
    await userEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load more: timeout");
    expect(screen.getAllByRole("button", { name: /^Item / })).toHaveLength(50);

    respond = null;
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getAllByRole("button", { name: /^Item / })).toHaveLength(60));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the child-chip error with a working retry", async () => {
    const retry = vi.fn();
    balances = { status: "error", message: "network down", retry };
    renderAt("/activity", member("parent"));
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load children: network down");
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});

describe("ActivityPage account states", () => {
  it("sends a signed-out visitor to /sign-in", () => {
    renderAt("/activity", { status: "signed-out" });
    expect(screen.getByText("sign-in page")).toBeInTheDocument();
  });

  it("shows the account loading status", () => {
    renderAt("/activity", { status: "loading" });
    expect(screen.getByRole("status")).toHaveTextContent("Loading your account…");
  });
});

describe("HomePage", () => {
  it("shows a parent the parent dashboard", () => {
    renderAt("/home", member("parent"), <HomePage />);
    expect(screen.getByText("parent dashboard")).toBeInTheDocument();
    expect(screen.queryByText("child dashboard")).not.toBeInTheDocument();
  });

  it("shows a child the child dashboard", () => {
    renderAt("/home", member("child"), <HomePage />);
    expect(screen.getByText("child dashboard")).toBeInTheDocument();
    expect(screen.queryByText("parent dashboard")).not.toBeInTheDocument();
  });

  it("shows the error and a working retry", async () => {
    const retry = vi.fn();
    renderAt("/home", { status: "error", message: "network down", retry }, <HomePage />);
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load your account: network down");
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("shows the no-membership message", () => {
    renderAt("/home", { status: "no-membership" }, <HomePage />);
    expect(screen.getByRole("alert")).toHaveTextContent("not linked to a household yet");
  });

  it("sends a signed-out visitor to /sign-in", () => {
    renderAt("/home", { status: "signed-out" }, <HomePage />);
    expect(screen.getByText("sign-in page")).toBeInTheDocument();
  });
});
