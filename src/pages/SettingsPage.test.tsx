// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import type { Session } from "@supabase/supabase-js";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { SettingsPage } from "./SettingsPage";
import { MembershipContext } from "../features/auth/membership-context";
import type { MembershipState } from "../features/auth/membership-context";
import { SessionContext } from "../features/auth/session-context";
import type { SessionState } from "../features/auth/session-context";

vi.mock("../lib/supabase", () => ({
  supabase: { auth: { signOut: vi.fn() } },
}));

// The real controls are covered by their own tests; stubs keep this focused
// on what Settings shows to whom.
vi.mock("../features/push/PushSubscribeButton", () => ({
  PushSubscribeButton: () => <p>reminders control</p>,
}));
vi.mock("../features/push/PushTestSendButton", () => ({
  PushTestSendButton: () => <p>test push control</p>,
}));

const signedIn: SessionState = {
  session: { user: { email: "sam@example.com" } } as Session,
  loading: false,
};

const member = (role: "parent" | "child"): MembershipState => ({
  status: "loaded",
  membership: { memberId: "m1", householdId: "h1", role, name: "X", status: "active" },
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

describe("SettingsPage", () => {
  it("shows device, reminders, account and the advanced test control to a parent", () => {
    renderSettings(signedIn, member("parent"));

    expect(screen.getByRole("heading", { name: "This device" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Install Family Ledger" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Payment reminders" })).toBeInTheDocument();
    expect(screen.getByText("reminders control")).toBeInTheDocument();
    expect(screen.getByText(/sam@example.com/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Change my password" })).toHaveAttribute(
      "href",
      "/settings/account",
    );
    expect(screen.getByRole("heading", { name: "Advanced" })).toBeInTheDocument();
    expect(screen.getByText("test push control")).toBeInTheDocument();
  });

  it("gives a child everything except the Advanced test control", () => {
    renderSettings(signedIn, member("child"));

    expect(screen.getByRole("heading", { name: "Payment reminders" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Advanced" })).not.toBeInTheDocument();
    expect(screen.queryByText("test push control")).not.toBeInTheDocument();
  });

  it("does not show Advanced while membership is still loading", () => {
    renderSettings(signedIn, { status: "loading" });
    expect(screen.queryByText("test push control")).not.toBeInTheDocument();
  });

  it("redirects a signed-out visitor to /sign-in", () => {
    renderSettings({ session: null, loading: false }, { status: "signed-out" });
    expect(screen.getByText("sign-in page")).toBeInTheDocument();
  });
});
