// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import html from "../../index.html?raw";

import {
  THEME_STORAGE_KEY,
  applyTheme,
  getStoredTheme,
  setStoredTheme,
  type ThemeStorage,
} from "./theme";

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

const root = () => document.documentElement;

beforeEach(() => {
  window.localStorage.clear();
  root().removeAttribute("data-theme");
});
afterEach(() => {
  root().removeAttribute("data-theme");
});

describe("getStoredTheme", () => {
  it("defaults to auto when nothing is stored", () => {
    expect(getStoredTheme()).toBe("auto");
  });

  it("returns a stored explicit choice", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    expect(getStoredTheme()).toBe("dark");
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    expect(getStoredTheme()).toBe("light");
  });

  it("treats an unknown stored value as auto", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "sepia");
    expect(getStoredTheme()).toBe("auto");
  });

  it("falls back to auto when storage throws or is missing", () => {
    expect(getStoredTheme(throwingStorage)).toBe("auto");
    expect(getStoredTheme(null)).toBe("auto");
  });
});

describe("setStoredTheme", () => {
  it("persists and applies light and dark", () => {
    expect(setStoredTheme("dark")).toBe(true);
    expect(root().getAttribute("data-theme")).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");

    expect(setStoredTheme("light")).toBe(true);
    expect(root().getAttribute("data-theme")).toBe("light");
    expect(getStoredTheme()).toBe("light");
  });

  it("auto removes both the attribute and the stored value", () => {
    setStoredTheme("dark");
    expect(setStoredTheme("auto")).toBe(true);
    expect(root().hasAttribute("data-theme")).toBe(false);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(getStoredTheme()).toBe("auto");
  });

  it("still applies the choice for this page when storage throws", () => {
    expect(setStoredTheme("dark", throwingStorage)).toBe(false);
    expect(root().getAttribute("data-theme")).toBe("dark");
    expect(setStoredTheme("auto", throwingStorage)).toBe(false);
    expect(root().hasAttribute("data-theme")).toBe(false);
  });
});

describe("applyTheme", () => {
  it("sets and clears data-theme on the given element", () => {
    const el = document.createElement("html");
    applyTheme("light", el);
    expect(el.getAttribute("data-theme")).toBe("light");
    applyTheme("auto", el);
    expect(el.hasAttribute("data-theme")).toBe(false);
  });
});

describe("index.html pre-paint script", () => {
  const inline = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";

  const run = () => {
    new Function(inline)();
  };

  it("uses the same storage key as the theme helper", () => {
    expect(inline).toContain(`"${THEME_STORAGE_KEY}"`);
  });

  it("applies a stored explicit choice before React mounts", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    run();
    expect(root().getAttribute("data-theme")).toBe("dark");
  });

  it("leaves the attribute off for auto or junk values", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "sepia");
    run();
    expect(root().hasAttribute("data-theme")).toBe(false);
  });

  it("declares both colour schemes", () => {
    expect(html).toMatch(/<meta name="color-scheme" content="light dark"/);
  });
});
