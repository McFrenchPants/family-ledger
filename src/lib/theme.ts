/**
 * Per-device light/dark preference.
 *
 * "auto" (the default) means: no `data-theme` attribute on <html>, so the CSS
 * in src/styles/tokens.css follows the OS `prefers-color-scheme`. "light" and
 * "dark" set `data-theme`, which wins over the OS in either direction.
 *
 * The same storage key is read by the inline pre-paint script in index.html
 * so the stored choice applies before React mounts (no flash). A test checks
 * that index.html still uses this key.
 *
 * The browser/status bar colour (the two `<meta name="theme-color">` tags in
 * index.html, one per OS scheme) follows the same rule: an explicit choice
 * points both tags at that theme's page background, "auto" restores each
 * tag to its own scheme's colour. The pre-paint script mirrors this too.
 *
 * Storage can throw (private mode, blocked site data, quota). Every access is
 * wrapped: a failed read means "auto"; a failed write still applies the
 * choice for this page load, it just is not remembered.
 */

export type ThemePreference = "auto" | "light" | "dark";

export const THEME_STORAGE_KEY = "family-ledger.theme";

const THEME_ATTRIBUTE = "data-theme";

/**
 * Page background (--bg in src/styles/tokens.css) per theme, used as the
 * browser bar colour. index.html repeats these; a test keeps them in step.
 */
export const THEME_BAR_COLORS = { light: "#f5f6f8", dark: "#0d1015" } as const;

/** Point the theme-color metas at the chosen theme, or back at their own scheme for auto. */
function applyBarColor(preference: ThemePreference, doc: Document): void {
  doc.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => {
    const scheme = isExplicit(preference)
      ? preference
      : (meta.media ?? "").includes("dark")
        ? "dark"
        : "light";
    meta.content = THEME_BAR_COLORS[scheme];
  });
}

/** Minimal storage surface, so tests can pass a throwing fake. */
export type ThemeStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): ThemeStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function isExplicit(value: unknown): value is "light" | "dark" {
  return value === "light" || value === "dark";
}

/** Read the stored preference. Missing, unknown, or unreadable -> "auto". */
export function getStoredTheme(
  storage: ThemeStorage | null = defaultStorage(),
): ThemePreference {
  if (!storage) return "auto";
  try {
    const value = storage.getItem(THEME_STORAGE_KEY);
    return isExplicit(value) ? value : "auto";
  } catch {
    return "auto";
  }
}

/**
 * Put the preference on <html> (explicit choices set data-theme, auto
 * removes it) and match the browser bar colour to it.
 */
export function applyTheme(
  preference: ThemePreference,
  root: HTMLElement = document.documentElement,
): void {
  if (isExplicit(preference)) {
    root.setAttribute(THEME_ATTRIBUTE, preference);
  } else {
    root.removeAttribute(THEME_ATTRIBUTE);
  }
  applyBarColor(preference, root.ownerDocument);
}

/**
 * Remember and apply a preference. Returns whether it was persisted; the
 * attribute is applied either way.
 */
export function setStoredTheme(
  preference: ThemePreference,
  storage: ThemeStorage | null = defaultStorage(),
  root: HTMLElement = document.documentElement,
): boolean {
  applyTheme(preference, root);
  if (!storage) return false;
  try {
    if (isExplicit(preference)) {
      storage.setItem(THEME_STORAGE_KEY, preference);
    } else {
      storage.removeItem(THEME_STORAGE_KEY);
    }
    return true;
  } catch {
    return false;
  }
}
