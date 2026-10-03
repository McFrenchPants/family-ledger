// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import type { Session } from "@supabase/supabase-js";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { SignInPage } from "./SignInPage";
import { SessionContext } from "../features/auth/session-context";
import type { SessionState } from "../features/auth/session-context";

function renderAt(state: SessionState) {
  return render(
    <SessionContext.Provider value={state}>
      <MemoryRouter initialEntries={["/sign-in"]}>
        <Routes>
          <Route path="/sign-in" element={<SignInPage />} />
          <Route path="/" element={<p>root page</p>} />
        </Routes>
      </MemoryRouter>
    </SessionContext.Provider>,
  );
}

describe("SignInPage", () => {
  it("sends a signed-in visitor on to / instead of stranding them", () => {
    renderAt({ session: { user: { email: "a@b.c" } } as Session, loading: false });
    expect(screen.getByText("root page")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign in" })).not.toBeInTheDocument();
  });

  it("shows the form when nobody is signed in", () => {
    renderAt({ session: null, loading: false });
    expect(screen.getByRole("heading", { level: 1, name: "Family Ledger" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });
});
