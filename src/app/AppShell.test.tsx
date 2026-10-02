// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { AppShell } from "./AppShell";
import { MembershipContext } from "../features/auth/membership-context";
import type { MembershipState } from "../features/auth/membership-context";

function renderShell(state: MembershipState, path = "/home") {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: <AppShell />,
        children: [{ path: "*", element: <p>page content</p> }],
      },
    ],
    { initialEntries: [path] },
  );
  render(
    <MembershipContext.Provider value={state}>
      <RouterProvider router={router} />
    </MembershipContext.Provider>,
  );
  return router;
}

const member = (role: "parent" | "child"): MembershipState => ({
  status: "loaded",
  membership: {
    memberId: "m1",
    householdId: "h1",
    role,
    name: role === "parent" ? "Dana" : "Alex",
    status: "active",
  },
});

const tabBar = () => within(screen.getByTestId("tab-bar"));
const sidebar = () => within(screen.getByTestId("sidebar"));

function linkNames(scope: ReturnType<typeof within>) {
  return scope.queryAllByRole("link").map((link: HTMLElement) => link.textContent);
}

describe("AppShell tab bar (mobile)", () => {
  it("gives a parent Home, Activity, New entry, Family, Settings in that order", () => {
    renderShell(member("parent"));
    const bar = tabBar();
    expect(linkNames(bar)).toEqual(["Home", "Activity", "Family", "Settings"]);
    expect(bar.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/home");
    expect(bar.getByRole("link", { name: "Activity" })).toHaveAttribute("href", "/activity");
    expect(bar.getByRole("link", { name: "Family" })).toHaveAttribute("href", "/family");
    expect(bar.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");

    // The "+" sits in the middle of the five slots.
    const items = bar.getAllByRole("listitem");
    expect(items).toHaveLength(5);
    expect(within(items[2]).getByRole("button", { name: "New entry" })).toBeInTheDocument();
  });

  it("gives a child Home, Activity, Add expense, Settings and no Family tab", () => {
    renderShell(member("child"));
    const bar = tabBar();
    expect(bar.getAllByRole("listitem")).toHaveLength(4);
    expect(bar.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/home");
    expect(bar.getByRole("link", { name: "Activity" })).toHaveAttribute("href", "/activity");
    expect(bar.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
    expect(bar.queryByRole("link", { name: "Family" })).not.toBeInTheDocument();
  });

  it("marks the current page with aria-current", () => {
    renderShell(member("parent"), "/family/c1");
    expect(tabBar().getByRole("link", { name: "Family" })).toHaveAttribute("aria-current", "page");
    expect(tabBar().getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
  });

  it("is replaced by a close link on task pages", () => {
    renderShell(member("parent"), "/new/expense");
    expect(screen.queryByTestId("tab-bar")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Close" })).toHaveAttribute("href", "/home");
  });

  it("shows no close link on ordinary pages", () => {
    renderShell(member("parent"), "/home");
    expect(screen.queryByRole("link", { name: "Close" })).not.toBeInTheDocument();
  });
});

describe("AppShell sidebar (desktop)", () => {
  it("gives a parent New entry, the four destinations and their own name", () => {
    renderShell(member("parent"));
    const side = sidebar();
    expect(side.getByRole("button", { name: "New entry" })).toBeInTheDocument();
    expect(linkNames(side)).toEqual(["Home", "Activity", "Family", "Settings"]);
    expect(side.getByText("Dana")).toBeInTheDocument();
    expect(side.getByText("Parent")).toBeInTheDocument();
  });

  it("gives a child an Add expense link and no Family destination", () => {
    renderShell(member("child"));
    const side = sidebar();
    expect(side.getByRole("link", { name: "Add expense" })).toHaveAttribute("href", "/new/expense");
    expect(side.queryByRole("button", { name: "New entry" })).not.toBeInTheDocument();
    expect(linkNames(side)).toEqual(["Add expense", "Home", "Activity", "Settings"]);
    expect(side.getByText("Alex")).toBeInTheDocument();
    expect(side.getByText("Child")).toBeInTheDocument();
  });

  it("stays on task pages", () => {
    renderShell(member("parent"), "/new/payment");
    expect(sidebar().getByRole("link", { name: "Home" })).toBeInTheDocument();
  });
});

describe('AppShell "+" / New entry', () => {
  it("opens a sheet with both entry types for a parent", async () => {
    const user = userEvent.setup();
    const router = renderShell(member("parent"));

    await user.click(tabBar().getByRole("button", { name: "New entry" }));

    const sheet = screen.getByRole("dialog", { name: "What happened?" });
    expect(within(sheet).getByRole("link", { name: /Add an expense/ })).toHaveAttribute(
      "href",
      "/new/expense",
    );
    expect(within(sheet).getByRole("link", { name: /Record a payment/ })).toHaveAttribute(
      "href",
      "/new/payment",
    );

    await user.click(within(sheet).getByRole("link", { name: /Record a payment/ }));
    expect(router.state.location.pathname).toBe("/new/payment");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens the same sheet from the sidebar button", async () => {
    const user = userEvent.setup();
    renderShell(member("parent"));
    await user.click(sidebar().getByRole("button", { name: "New entry" }));
    expect(screen.getByRole("dialog", { name: "What happened?" })).toBeInTheDocument();
  });

  it("is a plain link to the expense form for a child, with no sheet or payment option", async () => {
    const user = userEvent.setup();
    const router = renderShell(member("child"));

    const plus = tabBar().getByRole("link", { name: "Add expense" });
    expect(plus).toHaveAttribute("href", "/new/expense");
    expect(tabBar().queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText(/Record a payment/)).not.toBeInTheDocument();

    await user.click(plus);
    expect(router.state.location.pathname).toBe("/new/expense");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText(/Record a payment/)).not.toBeInTheDocument();
  });
});

describe("AppShell before membership is known", () => {
  it.each([
    ["signed-out", { status: "signed-out" } as MembershipState],
    ["loading", { status: "loading" } as MembershipState],
    ["no-membership", { status: "no-membership" } as MembershipState],
    ["error", { status: "error", message: "x", retry: () => {} } as MembershipState],
  ])("shows no destinations or entry buttons when %s", (_label, state) => {
    renderShell(state);
    const navs = screen.getAllByRole("navigation", { name: "Main" });
    expect(navs).toHaveLength(2); // one per breakpoint; CSS shows only one
    for (const nav of navs) {
      expect(within(nav).queryAllByRole("link")).toHaveLength(0);
    }
    expect(linkNames(tabBar())).toEqual([]);
    expect(linkNames(sidebar())).toEqual([]);
    expect(screen.queryByRole("button", { name: "New entry" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Add expense" })).not.toBeInTheDocument();
    expect(screen.getByText("page content")).toBeInTheDocument();
  });
});

describe("AppShell landmarks and focus", () => {
  it("puts a Skip to content link first, targeting main#main", async () => {
    const user = userEvent.setup();
    renderShell(member("parent"));

    const skip = screen.getByRole("link", { name: "Skip to content" });
    expect(skip).toHaveAttribute("href", "#main");
    // First focusable element in the document.
    const firstFocusable = document.querySelector("a[href], button, input, select, textarea");
    expect(firstFocusable).toBe(skip);

    const main = screen.getByRole("main");
    expect(main).toHaveAttribute("id", "main");
    expect(main).toHaveAttribute("tabindex", "-1");

    await user.tab();
    expect(skip).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(main).toHaveFocus();
  });

  it("moves focus to main on a client-side page change, not on first load", async () => {
    const user = userEvent.setup();
    renderShell(member("parent"));
    const main = screen.getByRole("main");
    expect(main).not.toHaveFocus();

    await user.click(tabBar().getByRole("link", { name: "Activity" }));
    expect(main).toHaveFocus();
  });

  it("renders no install, notification or test controls above page content", () => {
    renderShell(member("parent"));
    expect(screen.getByText("page content")).toBeInTheDocument();
    expect(screen.queryByText(/Install Family Ledger/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /notifications/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/test push/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Signed in as/)).not.toBeInTheDocument();
  });
});
