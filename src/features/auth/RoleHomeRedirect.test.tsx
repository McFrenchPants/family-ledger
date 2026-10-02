// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { RoleHomeRedirect } from "./RoleHomeRedirect";
import { MembershipContext } from "./membership-context";
import type { MembershipState } from "./membership-context";

function renderHome(state: MembershipState) {
  return render(
    <MembershipContext.Provider value={state}>
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<RoleHomeRedirect />} />
          <Route path="/sign-in" element={<p>sign-in page</p>} />
          <Route path="/home" element={<p>home page</p>} />
        </Routes>
      </MemoryRouter>
    </MembershipContext.Provider>,
  );
}

const member = (role: "parent" | "child"): MembershipState => ({
  status: "loaded",
  membership: { memberId: "m1", householdId: "h1", role, name: "X", status: "active" },
});

describe("RoleHomeRedirect", () => {
  it("sends a parent to /home", () => {
    renderHome(member("parent"));
    expect(screen.getByText("home page")).toBeInTheDocument();
  });

  it("sends a child to /home", () => {
    renderHome(member("child"));
    expect(screen.getByText("home page")).toBeInTheDocument();
  });

  it("sends a signed-out visitor to /sign-in", () => {
    renderHome({ status: "signed-out" });
    expect(screen.getByText("sign-in page")).toBeInTheDocument();
  });

  it("shows a loading status while loading", () => {
    renderHome({ status: "loading" });
    expect(screen.getByRole("status")).toHaveTextContent("Loading your account…");
  });

  it("shows the error and a working retry", () => {
    const retry = vi.fn();
    renderHome({ status: "error", message: "network down", retry });
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load your account: network down");
    screen.getByRole("button", { name: "Retry" }).click();
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("shows the no-membership message", () => {
    renderHome({ status: "no-membership" });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Your account is not linked to a household yet.",
    );
  });
});
