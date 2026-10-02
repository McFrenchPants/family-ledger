// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { RootLayout } from "./RootLayout";
import { MembershipContext } from "../features/auth/membership-context";
import type { MembershipState } from "../features/auth/membership-context";

function renderLayout(state: MembershipState) {
  return render(
    <MembershipContext.Provider value={state}>
      <MemoryRouter initialEntries={["/x"]}>
        <Routes>
          <Route element={<RootLayout />}>
            <Route path="/x" element={<p>page content</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </MembershipContext.Provider>,
  );
}

const member = (role: "parent" | "child"): MembershipState => ({
  status: "loaded",
  membership: { memberId: "m1", householdId: "h1", role, name: "X", status: "active" },
});

function expectNoOldLinks() {
  for (const name of ["Parent", "Child", "Sign in", "Change my password"]) {
    expect(screen.queryByRole("link", { name })).not.toBeInTheDocument();
  }
}

describe("RootLayout", () => {
  it("shows Home (to /parent) and Settings to a parent", () => {
    renderLayout(member("parent"));
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/parent");
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
    expectNoOldLinks();
  });

  it("shows Home (to /child) and Settings to a child", () => {
    renderLayout(member("child"));
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/child");
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
    expectNoOldLinks();
  });

  it.each([
    ["signed-out", { status: "signed-out" } as MembershipState],
    ["loading", { status: "loading" } as MembershipState],
  ])("shows no nav links when %s", (_label, state) => {
    renderLayout(state);
    expect(screen.getByRole("navigation", { name: "Main" })).toBeInTheDocument();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("renders no install, notification or test controls above page content", () => {
    renderLayout(member("parent"));
    expect(screen.getByText("page content")).toBeInTheDocument();
    expect(screen.queryByText(/Install Family Ledger/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /notifications/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/test push/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Signed in as/)).not.toBeInTheDocument();
  });
});
