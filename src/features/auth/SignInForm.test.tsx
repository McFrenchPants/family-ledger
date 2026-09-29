// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SignInForm } from "./SignInForm";

const { signInWithPasswordMock } = vi.hoisted(() => ({
  signInWithPasswordMock: vi.fn(),
}));

vi.mock("../../lib/supabase", () => ({
  supabase: {
    auth: {
      signInWithPassword: signInWithPasswordMock,
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SignInForm", () => {
  it("updates email and password as the user types", async () => {
    const user = userEvent.setup();
    signInWithPasswordMock.mockResolvedValue({ error: null });
    render(<SignInForm />);

    const email = screen.getByLabelText("Email");
    const password = screen.getByLabelText("Password");

    await user.type(email, "parent@example.com");
    await user.type(password, "hunter2");

    expect(email).toHaveValue("parent@example.com");
    expect(password).toHaveValue("hunter2");
  });

  it("submits the typed email and password to signInWithPassword", async () => {
    const user = userEvent.setup();
    signInWithPasswordMock.mockResolvedValue({ error: null });
    render(<SignInForm />);

    await user.type(screen.getByLabelText("Email"), "parent@example.com");
    await user.type(screen.getByLabelText("Password"), "hunter2");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(signInWithPasswordMock).toHaveBeenCalledWith({
      email: "parent@example.com",
      password: "hunter2",
    });
  });

  it("clears the password field and shows no error on success", async () => {
    const user = userEvent.setup();
    signInWithPasswordMock.mockResolvedValue({ error: null });
    render(<SignInForm />);

    const password = screen.getByLabelText("Password");
    await user.type(screen.getByLabelText("Email"), "parent@example.com");
    await user.type(password, "hunter2");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(password).toHaveValue(""));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders the signInError message in the alert element", async () => {
    const user = userEvent.setup();
    signInWithPasswordMock.mockResolvedValue({ error: { message: "Invalid credentials" } });
    render(<SignInForm />);

    await user.type(screen.getByLabelText("Email"), "parent@example.com");
    await user.type(screen.getByLabelText("Password"), "wrong");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid credentials");
  });

  it("renders the fallback message when the call throws", async () => {
    const user = userEvent.setup();
    signInWithPasswordMock.mockRejectedValue(new Error("network down"));
    render(<SignInForm />);

    await user.type(screen.getByLabelText("Email"), "parent@example.com");
    await user.type(screen.getByLabelText("Password"), "hunter2");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not reach the sign-in service: network down",
    );
  });

  it("disables the submit button while submitting and re-enables after", async () => {
    const user = userEvent.setup();
    let resolveSignIn: (value: { error: null }) => void = () => {};
    signInWithPasswordMock.mockReturnValue(
      new Promise((resolve) => {
        resolveSignIn = resolve;
      }),
    );
    render(<SignInForm />);

    await user.type(screen.getByLabelText("Email"), "parent@example.com");
    await user.type(screen.getByLabelText("Password"), "hunter2");

    const submitButton = screen.getByRole("button", { name: "Sign in" });
    await user.click(submitButton);

    expect(screen.getByRole("button", { name: "Signing in…" })).toBeDisabled();

    resolveSignIn({ error: null });

    await waitFor(() => expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled());
  });
});
