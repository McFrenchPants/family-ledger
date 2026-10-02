// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ActivityPage } from "./ActivityPage";
import { HomePage } from "./HomePage";
import { MembershipContext } from "../features/auth/membership-context";
import type { MembershipState } from "../features/auth/membership-context";
import type { HouseholdBalancesState } from "../features/ledger/useHouseholdBalances";

vi.mock("../lib/supabase", () => ({ supabase: {} }));
vi.mock("./HistoryPage", () => ({
  HistoryPage: ({ memberId }: { memberId: string }) => <p>history for {memberId}</p>,
}));
vi.mock("./ParentDashboardPage", () => ({ ParentDashboardPage: () => <p>parent dashboard</p> }));
vi.mock("./ChildDashboardPage", () => ({ ChildDashboardPage: () => <p>child dashboard</p> }));

let balances: HouseholdBalancesState = { status: "loading" };
vi.mock("../features/ledger/useHouseholdBalances", () => ({
  useHouseholdBalances: () => balances,
}));

const member = (role: "parent" | "child"): MembershipState => ({
  status: "loaded",
  membership: { memberId: "me", householdId: "h1", role, name: "X", status: "active" },
});

function renderAt(path: string, state: MembershipState, element = <ActivityPage />) {
  return render(
    <MembershipContext.Provider value={state}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/activity" element={element} />
          <Route path="/home" element={element} />
          <Route path="/sign-in" element={<p>sign-in page</p>} />
        </Routes>
      </MemoryRouter>
    </MembershipContext.Provider>,
  );
}

beforeEach(() => {
  balances = { status: "loading" };
});

describe("ActivityPage", () => {
  it("shows a child their own history", () => {
    renderAt("/activity", member("child"));
    expect(screen.getByText("history for me")).toBeInTheDocument();
  });

  it("ignores ?child= for a child", () => {
    renderAt("/activity?child=sibling", member("child"));
    expect(screen.getByText("history for me")).toBeInTheDocument();
    expect(screen.queryByText(/sibling/)).not.toBeInTheDocument();
  });

  it("shows a parent the chosen child's history", () => {
    renderAt("/activity?child=c1", member("parent"));
    expect(screen.getByText("history for c1")).toBeInTheDocument();
  });

  it("shows a parent with no child chosen a list of children", () => {
    balances = {
      status: "loaded",
      children: [
        { memberId: "c1", name: "Alex", balanceCents: 100 },
        { memberId: "c2", name: "Sam", balanceCents: 0 },
      ],
    };
    renderAt("/activity", member("parent"));
    expect(screen.getByRole("link", { name: "Alex" })).toHaveAttribute("href", "/activity?child=c1");
    expect(screen.getByRole("link", { name: "Sam" })).toHaveAttribute("href", "/activity?child=c2");
  });

  it("shows loading, then an empty state, for the chooser", () => {
    const { unmount } = renderAt("/activity", member("parent"));
    expect(screen.getByRole("status")).toHaveTextContent("Loading children…");
    unmount();

    balances = { status: "loaded", children: [] };
    renderAt("/activity", member("parent"));
    expect(screen.getByText("No children yet")).toBeInTheDocument();
  });

  it("shows the chooser error with a working retry", async () => {
    const retry = vi.fn();
    balances = { status: "error", message: "network down", retry };
    renderAt("/activity", member("parent"));
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load children: network down");
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

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
