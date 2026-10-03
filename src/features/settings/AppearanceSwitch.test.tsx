// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AppearanceSwitch } from "./AppearanceSwitch";
import { THEME_STORAGE_KEY, type ThemeStorage } from "../../lib/theme";

const root = () => document.documentElement;
const NOT_SAVED = "This device couldn't save your choice; it will reset next time.";

const throwingStorage: ThemeStorage = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
  removeItem: () => {
    throw new Error("SecurityError");
  },
};

beforeEach(() => {
  window.localStorage.clear();
  root().removeAttribute("data-theme");
});
afterEach(() => {
  window.localStorage.clear();
  root().removeAttribute("data-theme");
});

describe("AppearanceSwitch", () => {
  it("is a labelled Light / Dark / Auto choice that starts on Auto", () => {
    render(<AppearanceSwitch />);
    const group = screen.getByRole("radiogroup", { name: "Appearance" });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Auto" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Light" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("radio", { name: "Dark" })).toHaveAttribute("aria-checked", "false");
  });

  it("starts on the stored choice", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    render(<AppearanceSwitch />);
    expect(screen.getByRole("radio", { name: "Dark" })).toHaveAttribute("aria-checked", "true");
  });

  it("applies a choice at once and remembers it for the next load", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<AppearanceSwitch />);

    await user.click(screen.getByRole("radio", { name: "Dark" }));
    expect(root()).toHaveAttribute("data-theme", "dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(screen.queryByText(NOT_SAVED)).not.toBeInTheDocument();

    // A "reload": a fresh mount reads the stored choice back.
    unmount();
    render(<AppearanceSwitch />);
    expect(screen.getByRole("radio", { name: "Dark" })).toHaveAttribute("aria-checked", "true");

    await user.click(screen.getByRole("radio", { name: "Light" }));
    expect(root()).toHaveAttribute("data-theme", "light");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });

  it("Auto clears the override and the stored choice, so the OS decides", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    root().setAttribute("data-theme", "light");
    render(<AppearanceSwitch />);

    await user.click(screen.getByRole("radio", { name: "Auto" }));
    expect(root()).not.toHaveAttribute("data-theme");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it("still applies the choice when storage is blocked, and says it won't stick", async () => {
    const user = userEvent.setup();
    render(<AppearanceSwitch storage={throwingStorage} />);

    // A failed read falls back to Auto rather than breaking the page.
    expect(screen.getByRole("radio", { name: "Auto" })).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByText(NOT_SAVED)).not.toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Dark" }));
    expect(root()).toHaveAttribute("data-theme", "dark");
    expect(screen.getByRole("radio", { name: "Dark" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("status")).toHaveTextContent(NOT_SAVED);

    await user.click(screen.getByRole("radio", { name: "Auto" }));
    expect(root()).not.toHaveAttribute("data-theme");
    expect(screen.getByRole("status")).toHaveTextContent(NOT_SAVED);
  });

  it("shows the note after a choice when there is no storage at all", async () => {
    const user = userEvent.setup();
    render(<AppearanceSwitch storage={null} />);
    expect(screen.queryByText(NOT_SAVED)).not.toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Light" }));
    expect(root()).toHaveAttribute("data-theme", "light");
    expect(screen.getByText(NOT_SAVED)).toBeInTheDocument();
  });
});
