// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { routes } from "./router";
import { MembershipContext } from "../features/auth/membership-context";
import type { MembershipState } from "../features/auth/membership-context";

// The real route table, with every page swapped for a labelled stub so these
// tests exercise routing, guards and redirects -- not page data loading.
vi.mock("../lib/supabase", () => ({ supabase: {} }));
vi.mock("../pages/HomePage", () => ({ HomePage: () => <p>stub: home</p> }));
vi.mock("../pages/ActivityPage", () => ({ ActivityPage: () => <p>stub: activity</p> }));
vi.mock("../pages/AddExpensePage", () => ({ AddExpensePage: () => <p>stub: add expense</p> }));
vi.mock("../pages/RecordPaymentPage", () => ({
  RecordPaymentPage: () => <p>stub: record payment</p>,
}));
vi.mock("../pages/FamilyPage", () => ({ FamilyPage: () => <p>stub: family</p> }));
vi.mock("../pages/FamilyMemberPage", () => ({
  FamilyMemberPage: () => <p>stub: family member</p>,
}));
vi.mock("../pages/SettingsPage", () => ({ SettingsPage: () => <p>stub: settings</p> }));
vi.mock("../pages/AccountPage", () => ({ AccountPage: () => <p>stub: account</p> }));
vi.mock("../pages/ExportPage", () => ({ ExportPage: () => <p>stub: export</p> }));
vi.mock("../pages/ManageCategoriesPage", () => ({
  ManageCategoriesPage: () => <p>stub: categories</p>,
}));
vi.mock("../pages/ManagePresetsPage", () => ({ ManagePresetsPage: () => <p>stub: presets</p> }));
vi.mock("../pages/SignInPage", () => ({ SignInPage: () => <p>stub: sign in</p> }));
vi.mock("../pages/SetPasswordPage", () => ({ SetPasswordPage: () => <p>stub: set password</p> }));

const member = (role: "parent" | "child"): MembershipState => ({
  status: "loaded",
  membership: { memberId: "m1", householdId: "h1", role, name: "X", status: "active" },
});
const PARENT = member("parent");
const CHILD = member("child");

function renderAt(path: string, state: MembershipState) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <MembershipContext.Provider value={state}>
      <RouterProvider router={router} />
    </MembershipContext.Provider>,
  );
  return router;
}

describe("route map: new addresses", () => {
  it.each([
    ["/home", "stub: home"],
    ["/activity", "stub: activity"],
    ["/new/expense", "stub: add expense"],
    ["/new/payment", "stub: record payment"],
    ["/family", "stub: family"],
    ["/family/c1", "stub: family member"],
    ["/settings", "stub: settings"],
    ["/settings/account", "stub: account"],
    ["/settings/export", "stub: export"],
    ["/settings/categories", "stub: categories"],
    ["/settings/presets", "stub: presets"],
  ])("a parent reaches %s", (path, text) => {
    const router = renderAt(path, PARENT);
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(path);
  });

  it.each([
    ["/home", "stub: home"],
    ["/activity", "stub: activity"],
    ["/new/expense", "stub: add expense"],
    ["/settings", "stub: settings"],
    ["/settings/account", "stub: account"],
  ])("a child reaches %s", (path, text) => {
    const router = renderAt(path, CHILD);
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(path);
  });

  it.each([
    "/new/payment",
    "/family",
    "/family/c1",
    "/settings/export",
    "/settings/categories",
    "/settings/presets",
  ])("a child typing %s is sent to /home", (path) => {
    const router = renderAt(path, CHILD);
    expect(router.state.location.pathname).toBe("/home");
    expect(screen.getByText("stub: home")).toBeInTheDocument();
  });

  it.each([
    ["parent", PARENT],
    ["child", CHILD],
  ])("/ sends a %s to /home", (_label, state) => {
    const router = renderAt("/", state);
    expect(router.state.location.pathname).toBe("/home");
  });

  it("/ sends a signed-out visitor to /sign-in", () => {
    const router = renderAt("/", { status: "signed-out" });
    expect(router.state.location.pathname).toBe("/sign-in");
  });

  it("shows Page not found, linking home, for an unknown address", () => {
    renderAt("/nope", PARENT);
    expect(screen.getByRole("heading", { name: "Page not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to dashboard" })).toHaveAttribute("href", "/home");
  });

  it("keeps the app frame around signed-in pages", () => {
    renderAt("/home", PARENT);
    expect(screen.getByRole("link", { name: "Skip to content" })).toBeInTheDocument();
    expect(screen.getAllByRole("navigation", { name: "Main" }).length).toBeGreaterThan(0);
  });
});

describe("route map: old addresses redirect with the query string kept", () => {
  it.each([
    ["/parent", "/home"],
    ["/child", "/home"],
    ["/add-expense", "/new/expense"],
    ["/record-payment", "/new/payment"],
    ["/members", "/family"],
    ["/account", "/settings/account"],
    ["/export", "/settings/export"],
    ["/parent/categories", "/settings/categories"],
    ["/parent/presets", "/settings/presets"],
  ])("%s -> %s", (from, to) => {
    const router = renderAt(`${from}?ref=bookmark&x=1`, PARENT);
    expect(router.state.location.pathname).toBe(to);
    expect(router.state.location.search).toBe("?ref=bookmark&x=1");
    // Replaced, not pushed: Back does not bounce through the old address.
    expect(router.state.historyAction).toBe("REPLACE");
  });

  it("/child (old Child home) also lands a child on /home", () => {
    const router = renderAt("/child?x=1", CHILD);
    expect(router.state.location.pathname).toBe("/home");
    expect(router.state.location.search).toBe("?x=1");
    expect(screen.getByText("stub: home")).toBeInTheDocument();
  });

  it("/child/:memberId/history -> /activity?child=:memberId, other query kept", () => {
    const router = renderAt("/child/c7/history?x=1", PARENT);
    expect(router.state.location.pathname).toBe("/activity");
    const params = new URLSearchParams(router.state.location.search);
    expect(params.get("child")).toBe("c7");
    expect(params.get("x")).toBe("1");
    expect(router.state.historyAction).toBe("REPLACE");
  });

  it("/child/:memberId/payment-plan sends a parent to /family/:memberId", () => {
    const router = renderAt("/child/c7/payment-plan?x=1", PARENT);
    expect(router.state.location.pathname).toBe("/family/c7");
    expect(router.state.location.search).toBe("?x=1");
    expect(router.state.historyAction).toBe("REPLACE");
    expect(screen.getByText("stub: family member")).toBeInTheDocument();
  });

  it("/child/:memberId/payment-plan sends a child to /home", () => {
    const router = renderAt("/child/m1/payment-plan", CHILD);
    expect(router.state.location.pathname).toBe("/home");
    expect(router.state.historyAction).toBe("REPLACE");
    expect(screen.getByText("stub: home")).toBeInTheDocument();
  });

  it("/child/:memberId/payment-plan waits while the account is still loading", () => {
    const router = renderAt("/child/c7/payment-plan", { status: "loading" });
    expect(router.state.location.pathname).toBe("/child/c7/payment-plan");
    expect(screen.getByRole("status")).toHaveTextContent("Loading your account…");
  });

  it("an old Parent-only address still ends at /home for a child", () => {
    const router = renderAt("/record-payment", CHILD);
    expect(router.state.location.pathname).toBe("/home");
  });
});

describe("route map: signed-out pages", () => {
  it.each([
    ["signed-out", { status: "signed-out" } as MembershipState],
    ["signed-in parent", PARENT],
  ])("/sign-in renders with no app chrome (%s)", (_label, state) => {
    const router = renderAt("/sign-in", state);
    expect(router.state.location.pathname).toBe("/sign-in");
    expect(screen.getByText("stub: sign in")).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Skip to content" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("tab-bar")).not.toBeInTheDocument();
  });

  it("/set-password renders with no chrome and keeps its URL fragment", () => {
    const router = renderAt("/set-password#access_token=abc&type=recovery", {
      status: "signed-out",
    });
    expect(screen.getByText("stub: set password")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/set-password");
    expect(router.state.location.hash).toBe("#access_token=abc&type=recovery");
    expect(router.state.historyAction).toBe("POP"); // never redirected
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });

  it("/set-password keeps its fragment while membership is still loading", () => {
    const router = renderAt("/set-password#token_hash=abc&type=recovery", { status: "loading" });
    expect(router.state.location.hash).toBe("#token_hash=abc&type=recovery");
    expect(router.state.location.pathname).toBe("/set-password");
  });
});
