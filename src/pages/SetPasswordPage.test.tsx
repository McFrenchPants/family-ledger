// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SetPasswordPage } from "./SetPasswordPage";

const { verifyOtpMock, updateUserMock } = vi.hoisted(() => ({
  verifyOtpMock: vi.fn(),
  updateUserMock: vi.fn(),
}));

vi.mock("../lib/supabase", () => ({
  supabase: {
    auth: { verifyOtp: verifyOtpMock, updateUser: updateUserMock },
  },
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/set-password"]}>
      <Routes>
        <Route path="/set-password" element={<SetPasswordPage />} />
        <Route path="/" element={<p>Dashboard home</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function fillAndSubmit(
  user: ReturnType<typeof userEvent.setup>,
  password = "correct-horse",
  confirm = password,
) {
  await user.type(screen.getByLabelText("New password"), password);
  await user.type(screen.getByLabelText("Confirm new password"), confirm);
  await user.click(screen.getByRole("button", { name: "Set password" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/set-password#token_hash=abc123&type=recovery");
});

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("SetPasswordPage", () => {
  it("strips the fragment from the address bar on load, without consuming the token", async () => {
    renderPage();

    await screen.findByLabelText("New password");
    expect(window.location.hash).toBe("");
    expect(window.location.pathname).toBe("/set-password");
    // Loading the page must not spend the one-time token.
    expect(verifyOtpMock).not.toHaveBeenCalled();
  });

  it("verifies the token then sets the password, then goes to the dashboard", async () => {
    const user = userEvent.setup();
    verifyOtpMock.mockResolvedValue({ error: null });
    updateUserMock.mockResolvedValue({ error: null });
    renderPage();

    await fillAndSubmit(user);

    expect(verifyOtpMock).toHaveBeenCalledWith({
      token_hash: "abc123",
      type: "recovery",
    });
    expect(updateUserMock).toHaveBeenCalledWith({ password: "correct-horse" });
    expect(verifyOtpMock.mock.invocationCallOrder[0]).toBeLessThan(
      updateUserMock.mock.invocationCallOrder[0],
    );
    expect(await screen.findByRole("status")).toHaveTextContent(/password is set/i);
    expect(
      await screen.findByText("Dashboard home", undefined, { timeout: 4000 }),
    ).toBeInTheDocument();
  });

  it("shows the invalid-link state when the token is missing", () => {
    window.history.replaceState(null, "", "/set-password");
    renderPage();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "This link isn't valid. Ask a Parent for a new one.",
    );
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
  });

  it("ignores a token passed in the query string", () => {
    window.history.replaceState(
      null,
      "",
      "/set-password?token_hash=abc123&type=recovery",
    );
    renderPage();

    expect(screen.getByRole("alert")).toHaveTextContent("This link isn't valid.");
  });

  it("treats a wrong link type as invalid", () => {
    window.history.replaceState(null, "", "/set-password#token_hash=abc123&type=signup");
    renderPage();

    expect(screen.getByRole("alert")).toHaveTextContent("This link isn't valid.");
  });

  it("explains an expired or already-used link", async () => {
    const user = userEvent.setup();
    verifyOtpMock.mockResolvedValue({ error: { code: "otp_expired", status: 403 } });
    renderPage();

    await fillAndSubmit(user);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This link has expired or was already used. Ask a Parent for a new one.",
    );
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it("says so when the account is not active", async () => {
    const user = userEvent.setup();
    verifyOtpMock.mockResolvedValue({ error: { code: "user_banned", status: 403 } });
    renderPage();

    await fillAndSubmit(user);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This account is not active.",
    );
  });

  it("does not spend the link on a network failure, so retrying calls verifyOtp again", async () => {
    const user = userEvent.setup();
    verifyOtpMock.mockResolvedValueOnce({
      error: { name: "AuthRetryableFetchError", status: 0 },
    });
    verifyOtpMock.mockResolvedValueOnce({ error: null });
    updateUserMock.mockResolvedValue({ error: null });
    renderPage();

    await fillAndSubmit(user);
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not reach/i);

    await user.click(screen.getByRole("button", { name: "Set password" }));
    await waitFor(() => expect(updateUserMock).toHaveBeenCalledTimes(1));
    expect(verifyOtpMock).toHaveBeenCalledTimes(2);
  });

  it("after verify succeeds but updateUser fails, retry skips verifyOtp", async () => {
    const user = userEvent.setup();
    verifyOtpMock.mockResolvedValue({ error: null });
    updateUserMock.mockResolvedValueOnce({
      error: { code: "same_password", status: 422 },
    });
    updateUserMock.mockResolvedValueOnce({ error: null });
    renderPage();

    await fillAndSubmit(user);
    expect(await screen.findByRole("alert")).toHaveTextContent(/different password/i);
    // The form is still there so a different password can be tried.
    expect(screen.getByLabelText("New password")).toBeInTheDocument();

    await user.clear(screen.getByLabelText("New password"));
    await user.clear(screen.getByLabelText("Confirm new password"));
    await user.type(screen.getByLabelText("New password"), "another-secret");
    await user.type(screen.getByLabelText("Confirm new password"), "another-secret");
    await user.click(screen.getByRole("button", { name: "Set password" }));

    await waitFor(() => expect(updateUserMock).toHaveBeenCalledTimes(2));
    expect(updateUserMock).toHaveBeenLastCalledWith({ password: "another-secret" });
    expect(verifyOtpMock).toHaveBeenCalledTimes(1);
  });

  it("maps a weak_password rejection to the minimum-length message", async () => {
    const user = userEvent.setup();
    verifyOtpMock.mockResolvedValue({ error: null });
    updateUserMock.mockResolvedValue({ error: { code: "weak_password", status: 422 } });
    renderPage();

    await fillAndSubmit(user);

    expect(await screen.findByRole("alert")).toHaveTextContent("at least 8 characters");
  });

  it("checks length and matching locally before touching the token", async () => {
    const user = userEvent.setup();
    renderPage();

    await fillAndSubmit(user, "short");
    expect(await screen.findByRole("alert")).toHaveTextContent("at least 8 characters");

    await user.clear(screen.getByLabelText("New password"));
    await user.clear(screen.getByLabelText("Confirm new password"));
    await fillAndSubmit(user, "long-enough-1", "long-enough-2");
    expect(await screen.findByRole("alert")).toHaveTextContent("don't match");

    expect(verifyOtpMock).not.toHaveBeenCalled();
  });

  it("uses new-password autocomplete on both fields", () => {
    renderPage();

    expect(screen.getByLabelText("New password")).toHaveAttribute(
      "autocomplete",
      "new-password",
    );
    expect(screen.getByLabelText("Confirm new password")).toHaveAttribute(
      "autocomplete",
      "new-password",
    );
  });

  it("never writes the token or password to web storage or the console", async () => {
    const user = userEvent.setup();
    verifyOtpMock.mockResolvedValue({ error: null });
    updateUserMock.mockResolvedValue({ error: null });
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const log = vi.spyOn(console, "log");
    const error = vi.spyOn(console, "error");
    renderPage();

    await fillAndSubmit(user);
    await screen.findByRole("status");

    expect(setItem).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    setItem.mockRestore();
    log.mockRestore();
    error.mockRestore();
  });
});
