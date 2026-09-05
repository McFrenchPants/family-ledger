// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { RequireRole } from "./RequireRole";
import { MembershipContext } from "./membership-context";
import type { MembershipState } from "./membership-context";

/**
 * Renders RequireRole at "/protected" inside a MemoryRouter with routes for
 * every place it can redirect to, so a <Navigate> resolves to visible text
 * instead of an unmatched-route blank page.
 */
function renderGuarded(state: MembershipState, role: "parent" | "child" = "parent") {
  return render(
    <MembershipContext.Provider value={state}>
      <MemoryRouter initialEntries={["/protected"]}>
        <Routes>
          <Route
            path="/protected"
            element={<RequireRole role={role}>protected content</RequireRole>}
          />
          <Route path="/sign-in" element={<p>sign-in page</p>} />
          <Route path="/parent" element={<p>parent page</p>} />
          <Route path="/child" element={<p>child page</p>} />
        </Routes>
      </MemoryRouter>
    </MembershipContext.Provider>,
  );
}

describe("RequireRole", () => {
  it("shows loading text while status is loading", () => {
    renderGuarded({ status: "loading" });

    expect(screen.getByRole("status")).toHaveTextContent("Loading your account…");
  });

  it("redirects to /sign-in when signed out", () => {
    renderGuarded({ status: "signed-out" });

    expect(screen.getByText("sign-in page")).toBeInTheDocument();
  });

  it("shows the error message and a working retry button", () => {
    const retry = vi.fn();
    renderGuarded({ status: "error", message: "network down", retry });

    expect(screen.getByRole("alert")).toHaveTextContent("Could not load your account: network down");

    const retryButton = screen.getByRole("button", { name: "Retry" });
    retryButton.click();

    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("shows the no-membership message", () => {
    renderGuarded({ status: "no-membership" });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Your account is not linked to a household yet.",
    );
  });

  it("renders children when loaded with a matching role", () => {
    renderGuarded(
      {
        status: "loaded",
        membership: {
          memberId: "m1",
          householdId: "h1",
          role: "parent",
          name: "Alex",
          status: "active",
        },
      },
      "parent",
    );

    expect(screen.getByText("protected content")).toBeInTheDocument();
  });

  it("redirects a child away from a parent-only route", () => {
    renderGuarded(
      {
        status: "loaded",
        membership: {
          memberId: "m1",
          householdId: "h1",
          role: "child",
          name: "Sam",
          status: "active",
        },
      },
      "parent",
    );

    expect(screen.getByText("child page")).toBeInTheDocument();
  });

  it("redirects a parent away from a child-only route", () => {
    renderGuarded(
      {
        status: "loaded",
        membership: {
          memberId: "m1",
          householdId: "h1",
          role: "parent",
          name: "Alex",
          status: "active",
        },
      },
      "child",
    );

    expect(screen.getByText("parent page")).toBeInTheDocument();
  });
});
