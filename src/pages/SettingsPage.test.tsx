// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Session } from "@supabase/supabase-js";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SettingsPage } from "./SettingsPage";
import { MembershipContext } from "../features/auth/membership-context";
import type { MembershipState } from "../features/auth/membership-context";
import { SessionContext } from "../features/auth/session-context";
import type { SessionState } from "../features/auth/session-context";
import { supabase } from "../lib/supabase";

vi.mock("../lib/supabase", () => ({
  supabase: { auth: { signOut: vi.fn() } },
}));

// The real controls are covered by their own tests; stubs keep this focused
// on what Settings shows to whom.
vi.mock("../features/push/PushSubscribeButton", () => ({
  PushSubscribeButton: () => <p>reminders control</p>,
}));
vi.mock("../features/push/PushTestSendButton", () => ({
  // Renders the hint Settings passes, as the real control does when this
  // member has no subscription to test.
  PushTestSendButton: ({ emptyHint }: { emptyHint?: ReactNode }) => (
    <div>
      <p>test push control</p>
      {emptyHint}
    </div>
  ),
}));

const signOutMock = vi.mocked(supabase.auth.signOut);

const signedIn: SessionState = {
  session: { user: { email: "sam@example.com" } } as Session,
  loading: false,
};

const member = (role: "parent" | "child"): MembershipState => ({
  status: "loaded",
  membership: { memberId: "m1", householdId: "h1", role, name: "Sam", status: "active" },
});

function renderSettings(session: SessionState, membership: MembershipState) {
  return render(
    <SessionContext.Provider value={session}>
      <MembershipContext.Provider value={membership}>
        <MemoryRouter initialEntries={["/settings"]}>
          <Routes>
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/sign-in" element={<p>sign-in page</p>} />
          </Routes>
        </MemoryRouter>
      </MembershipContext.Provider>
    </SessionContext.Provider>,
  );
}

function section(name: string) {
  return screen.getByRole("region", { name });
}

beforeEach(() => {
  signOutMock.mockReset();
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});
afterEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

describe("SettingsPage", () => {
  it("shows a parent every section, under one page heading", () => {
    renderSettings(signedIn, member("parent"));

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();

    // Account: who you are, password, appearance, sign out.
    const account = section("Account");
    expect(within(account).getByText("Sam")).toBeInTheDocument();
    expect(within(account).getByText("sam@example.com · Parent")).toBeInTheDocument();
    expect(within(account).getByRole("link", { name: "Change password" })).toHaveAttribute(
      "href",
      "/settings/account",
    );
    expect(within(account).getByRole("radiogroup", { name: "Appearance" })).toBeInTheDocument();
    expect(within(account).getByRole("button", { name: "Sign out" })).toBeInTheDocument();

    // This device: install and reminders.
    const device = section("This device");
    expect(within(device).getByRole("heading", { name: "Install Family Ledger" })).toBeInTheDocument();
    expect(within(device).getByRole("heading", { name: "Payment reminders" })).toBeInTheDocument();
    expect(within(device).getByText("reminders control")).toBeInTheDocument();

    // Household links.
    const household = section("Household");
    expect(within(household).getByRole("link", { name: "Members & roles" })).toHaveAttribute(
      "href",
      "/family",
    );
    expect(within(household).getByRole("link", { name: "Categories" })).toHaveAttribute(
      "href",
      "/settings/categories",
    );
    expect(within(household).getByRole("link", { name: "Quick-add presets" })).toHaveAttribute(
      "href",
      "/settings/presets",
    );

    // Export and backup: one row, since the export page offers both formats.
    const exportSection = section("Export & backup");
    const exportLinks = within(exportSection).getAllByRole("link");
    expect(exportLinks).toHaveLength(1);
    expect(exportLinks[0]).toHaveAccessibleName("Spreadsheet (CSV) or full backup (JSON)");
    expect(exportLinks[0]).toHaveAttribute("href", "/settings/export");

    // Advanced: collapsed by default, holding the test-push control.
    const advanced = screen.getByText("Advanced").closest("details");
    expect(advanced).not.toBeNull();
    expect(advanced).not.toHaveAttribute("open");
    expect(within(advanced!).getByText("test push control")).toBeInTheDocument();
  });

  it("explains an otherwise empty Advanced section on a device without reminders", () => {
    renderSettings(signedIn, member("parent"));
    const advanced = screen.getByText("Advanced").closest("details")!;
    expect(
      within(advanced).getByText("Turn on reminders on this device to send a test notification."),
    ).toBeInTheDocument();
  });

  it("opens Advanced on request", async () => {
    const user = userEvent.setup();
    renderSettings(signedIn, member("parent"));
    const advanced = screen.getByText("Advanced").closest("details")!;
    await user.click(screen.getByText("Advanced"));
    expect(advanced).toHaveAttribute("open");
  });

  it("gives a child only Account and This device", () => {
    renderSettings(signedIn, member("child"));

    expect(section("Account")).toBeInTheDocument();
    expect(screen.getByText("sam@example.com · Child")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Change password" })).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Appearance" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
    expect(section("This device")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Payment reminders" })).toBeInTheDocument();

    expect(screen.getAllByRole("region").map((region) => region.getAttribute("aria-labelledby")))
      .toEqual(["account-heading", "device-heading"]);
    expect(screen.queryByRole("heading", { name: "Household" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Export & backup" })).not.toBeInTheDocument();
    expect(screen.queryByText("Advanced")).not.toBeInTheDocument();
    expect(screen.queryByText("test push control")).not.toBeInTheDocument();
    expect(screen.queryByText(/send a test notification/)).not.toBeInTheDocument();
    for (const href of ["/family", "/settings/categories", "/settings/presets", "/settings/export"]) {
      expect(document.querySelector(`a[href="${href}"]`)).toBeNull();
    }
  });

  it("does not show parent sections while membership is still loading", () => {
    renderSettings(signedIn, { status: "loading" });
    expect(section("Account")).toBeInTheDocument();
    expect(screen.getByText("sam@example.com")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Household" })).not.toBeInTheDocument();
    expect(screen.queryByText("test push control")).not.toBeInTheDocument();
  });

  it("redirects a signed-out visitor to /sign-in", () => {
    renderSettings({ session: null, loading: false }, { status: "signed-out" });
    expect(screen.getByText("sign-in page")).toBeInTheDocument();
  });

  it("signs out when asked", async () => {
    const user = userEvent.setup();
    signOutMock.mockResolvedValue({ error: null });
    renderSettings(signedIn, member("child"));

    await user.click(screen.getByRole("button", { name: "Sign out" }));
    expect(signOutMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows why sign-out failed and lets you try again", async () => {
    const user = userEvent.setup();
    signOutMock.mockResolvedValueOnce({
      error: { message: "Auth session missing" },
    } as Awaited<ReturnType<typeof supabase.auth.signOut>>);
    signOutMock.mockRejectedValueOnce(new Error("Failed to fetch"));
    renderSettings(signedIn, member("parent"));

    await user.click(screen.getByRole("button", { name: "Sign out" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Auth session missing");
    await waitFor(() => expect(screen.getByRole("button", { name: "Sign out" })).toBeEnabled());

    await user.click(screen.getByRole("button", { name: "Sign out" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not sign out: Failed to fetch");
  });

  it("switches the theme from the Appearance control", async () => {
    const user = userEvent.setup();
    renderSettings(signedIn, member("child"));

    await user.click(screen.getByRole("radio", { name: "Dark" }));
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(screen.getByRole("radio", { name: "Dark" })).toHaveAttribute("aria-checked", "true");
  });
});
