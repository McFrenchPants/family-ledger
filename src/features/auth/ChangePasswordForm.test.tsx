// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChangePasswordForm } from "./ChangePasswordForm";

const { signInWithPasswordMock, updateUserMock } = vi.hoisted(() => ({
  signInWithPasswordMock: vi.fn(),
  updateUserMock: vi.fn(),
}));

vi.mock("../../lib/supabase", () => ({
  supabase: {
    auth: { signInWithPassword: signInWithPasswordMock, updateUser: updateUserMock },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

async function fill(
  user: ReturnType<typeof userEvent.setup>,
  {
    current = "old-password",
    next = "new-password-1",
    confirm = undefined as string | undefined,
  } = {},
) {
  await user.type(screen.getByLabelText("Current password"), current);
  await user.type(screen.getByLabelText("New password"), next);
  await user.type(screen.getByLabelText("Confirm new password"), confirm ?? next);
  await user.click(screen.getByRole("button", { name: "Change password" }));
}

describe("ChangePasswordForm", () => {
  it("warns before submit that other devices will be signed out", () => {
    render(<ChangePasswordForm email="a@example.com" />);

    expect(
      screen.getByText("Changing your password signs you out on your other devices."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Current password")).toHaveAttribute(
      "autocomplete",
      "current-password",
    );
    expect(screen.getByLabelText("New password")).toHaveAttribute(
      "autocomplete",
      "new-password",
    );
  });

  it("re-authenticates with the session email, then updates the password, then clears the fields", async () => {
    const user = userEvent.setup();
    signInWithPasswordMock.mockResolvedValue({ error: null });
    updateUserMock.mockResolvedValue({ error: null });
    render(<ChangePasswordForm email="a@example.com" />);

    await fill(user);

    expect(signInWithPasswordMock).toHaveBeenCalledWith({
      email: "a@example.com",
      password: "old-password",
    });
    expect(updateUserMock).toHaveBeenCalledWith({ password: "new-password-1" });
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Your password was changed.",
    );
    expect(screen.getByLabelText("Current password")).toHaveValue("");
    expect(screen.getByLabelText("New password")).toHaveValue("");
    expect(screen.getByLabelText("Confirm new password")).toHaveValue("");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("says the current password is incorrect and does not change anything", async () => {
    const user = userEvent.setup();
    signInWithPasswordMock.mockResolvedValue({
      error: { code: "invalid_credentials", status: 400 },
    });
    render(<ChangePasswordForm email="a@example.com" />);

    await fill(user);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Current password is incorrect",
    );
    expect(updateUserMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("does not call a network outage an incorrect password", async () => {
    const user = userEvent.setup();
    signInWithPasswordMock.mockResolvedValue({
      error: { name: "AuthRetryableFetchError", status: 0 },
    });
    render(<ChangePasswordForm email="a@example.com" />);

    await fill(user);

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not reach/i);
  });

  it("asks for a different password on same_password", async () => {
    const user = userEvent.setup();
    signInWithPasswordMock.mockResolvedValue({ error: null });
    updateUserMock.mockResolvedValue({ error: { code: "same_password", status: 422 } });
    render(<ChangePasswordForm email="a@example.com" />);

    await fill(user);

    expect(await screen.findByRole("alert")).toHaveTextContent(/different password/i);
  });

  it("maps weak_password to the minimum-length message", async () => {
    const user = userEvent.setup();
    signInWithPasswordMock.mockResolvedValue({ error: null });
    updateUserMock.mockResolvedValue({ error: { code: "weak_password", status: 422 } });
    render(<ChangePasswordForm email="a@example.com" />);

    await fill(user);

    expect(await screen.findByRole("alert")).toHaveTextContent("at least 8 characters");
  });

  it("checks length and matching locally without calling the server", async () => {
    const user = userEvent.setup();
    render(<ChangePasswordForm email="a@example.com" />);

    await fill(user, { next: "short" });
    expect(await screen.findByRole("alert")).toHaveTextContent("at least 8 characters");

    await user.clear(screen.getByLabelText("New password"));
    await user.clear(screen.getByLabelText("Confirm new password"));
    await user.type(screen.getByLabelText("New password"), "long-enough-1");
    await user.type(screen.getByLabelText("Confirm new password"), "long-enough-2");
    await user.click(screen.getByRole("button", { name: "Change password" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("don't match"),
    );

    expect(signInWithPasswordMock).not.toHaveBeenCalled();
  });
});
