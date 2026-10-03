// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import type { Session } from "@supabase/supabase-js";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { AccountPage } from "./AccountPage";
import { SessionContext } from "../features/auth/session-context";
import type { SessionState } from "../features/auth/session-context";

vi.mock("../lib/supabase", () => ({
  supabase: { auth: { signInWithPassword: vi.fn(), updateUser: vi.fn() } },
}));

function renderPage(session: SessionState) {
  return render(
    <SessionContext.Provider value={session}>
      <MemoryRouter initialEntries={["/settings/account"]}>
        <Routes>
          <Route path="/settings/account" element={<AccountPage />} />
          <Route path="/sign-in" element={<p>sign-in page</p>} />
        </Routes>
      </MemoryRouter>
    </SessionContext.Provider>,
  );
}

describe("AccountPage", () => {
  it("shows the password form under one heading with a back arrow to Settings", () => {
    renderPage({ session: { user: { email: "sam@example.com" } } as Session, loading: false });

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: "Change password" })).toBeInTheDocument();
    expect(screen.getByText("Signed in as sam@example.com.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Settings" })).toHaveAttribute(
      "href",
      "/settings",
    );
    expect(screen.getByLabelText("Current password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change password" })).toBeInTheDocument();
  });

  it("redirects a signed-out visitor to /sign-in", () => {
    renderPage({ session: null, loading: false });
    expect(screen.getByText("sign-in page")).toBeInTheDocument();
  });
});
