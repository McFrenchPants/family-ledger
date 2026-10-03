import { describe, expect, it } from "vitest";

import css from "./tokens.css?raw";

/**
 * WCAG contrast contract for the colour tokens.
 *
 * Parses src/styles/tokens.css (the one source of truth) and recomputes the
 * contrast ratio of every pair the design relies on. Text pairs must reach
 * 4.5:1 (WCAG 1.4.3 AA); non-text UI pairs -- focus ring, progress fill --
 * must reach 3:1 (WCAG 1.4.11).
 */

type Rgb = readonly [number, number, number];
type Palette = Record<string, Rgb>;

function block(startMarker: RegExp): string {
  const start = css.search(startMarker);
  if (start < 0) throw new Error(`token block not found: ${String(startMarker)}`);
  const open = css.indexOf("{", start);
  // First closing brace that ends the declaration list we opened (none nest
  // except the @media wrapper, which we skip by matching the inner selector).
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

const DECL =
  /--([a-z-]+):\s*(\d{1,3})\s+(\d{1,3})\s+(\d{1,3});\s*\/\*\s*(#[0-9a-f]{6})\s*\*\//g;

function parse(body: string): Palette {
  const palette: Palette = {};
  for (const m of body.matchAll(DECL)) {
    const [, name, r, g, b, hex] = m;
    const rgb: Rgb = [Number(r), Number(g), Number(b)];
    const fromHex = parseInt(hex.slice(1), 16);
    // Keep the human-readable hex comment honest.
    expect(
      [fromHex >> 16, (fromHex >> 8) & 255, fromHex & 255],
      `--${name} hex comment`,
    ).toEqual(rgb);
    palette[name] = rgb;
  }
  return palette;
}

function luminance([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const lightBody = block(/^:root\s*\{/m);
const darkMediaBody = block(/:root:not\(\[data-theme="light"\]\)\s*\{/);
const darkExplicitBody = block(/^:root\[data-theme="dark"\]\s*\{/m);

const themes: Record<string, Palette> = {
  light: parse(lightBody),
  dark: parse(darkExplicitBody),
};

const TEXT = 4.5;
const UI = 3;

/** [foreground, background, minimum] */
const PAIRS: ReadonlyArray<readonly [string, string, number]> = [
  // Body text tokens on every page-level surface.
  ...["ink", "muted", "subtle", "accent-text"].flatMap((fg) =>
    ["surface", "bg", "sunken"].map((bg) => [fg, bg, TEXT] as const),
  ),
  // Status chips / inline status (text on its soft tint).
  ["danger", "danger-soft", TEXT],
  ["warn", "warn-soft", TEXT],
  ["ok", "ok-soft", TEXT],
  ["accent-text", "accent-soft", TEXT],
  ["muted", "sunken", TEXT],
  // Selected segment of the Segmented control.
  ["ink", "raised", TEXT],
  // Coloured text directly on cards (amounts, errors, warnings).
  ["danger", "surface", TEXT],
  ["warn", "surface", TEXT],
  ["ok", "surface", TEXT],
  // Filled buttons.
  ["on-accent", "accent", TEXT],
  ["on-ok", "ok-btn", TEXT],
  ["on-danger", "danger", TEXT],
  // Focus ring (3px accent outline) and progress fills against their backdrop.
  ["accent", "bg", UI],
  ["accent", "surface", UI],
  ["accent", "sunken", UI],
  ["ok", "sunken", UI],
  ["danger", "sunken", UI],
  ["warn", "sunken", UI],
];

describe("token file structure", () => {
  it("declares the same token names in light and dark", () => {
    expect(Object.keys(themes.dark).sort()).toEqual(Object.keys(themes.light).sort());
    expect(Object.keys(themes.light).length).toBeGreaterThanOrEqual(21);
  });

  it("keeps the OS-dark and explicit-dark blocks identical", () => {
    const norm = (s: string) =>
      s
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .join("\n");
    expect(norm(darkMediaBody)).toBe(norm(darkExplicitBody));
  });

  it("does not let an explicit light choice pick up OS-dark tokens", () => {
    expect(css).toMatch(
      /@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)/,
    );
  });
});

describe.each(Object.keys(themes))("%s theme contrast", (themeName) => {
  const palette = themes[themeName];
  it.each(PAIRS)("%s on %s >= %s:1", (fg, bg, min) => {
    expect(palette[fg], `missing --${fg}`).toBeDefined();
    expect(palette[bg], `missing --${bg}`).toBeDefined();
    const ratio = contrast(palette[fg], palette[bg]);
    expect(
      ratio,
      `${themeName}: --${fg} on --${bg} is ${ratio.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(min);
  });
});

describe("selected segment fill", () => {
  it("stands out from the sunken track in dark at least as much as in light", () => {
    const { light, dark } = themes;
    const lightStep = contrast(light.raised, light.sunken);
    const darkStep = contrast(dark.raised, dark.sunken);
    expect(darkStep).toBeGreaterThanOrEqual(lightStep);
    // A card surface alone would not: that was the low-contrast bug.
    expect(contrast(dark.surface, dark.sunken)).toBeLessThan(lightStep);
  });
});

describe("contrast helper", () => {
  it("matches known WCAG values", () => {
    expect(contrast([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
    expect(contrast([255, 255, 255], [255, 255, 255])).toBeCloseTo(1, 5);
  });

  it("reproduces the spec's measured ratios", () => {
    const { light, dark } = themes;
    expect(contrast(light.ink, light.surface)).toBeCloseTo(17.8, 0);
    expect(contrast(light.subtle, light.surface)).toBeCloseTo(5.9, 0);
    expect(contrast(light["on-accent"], light.accent)).toBeCloseTo(6.8, 0);
    expect(contrast(dark.ink, dark.surface)).toBeCloseTo(15.4, 0);
    expect(contrast(dark["on-accent"], dark.accent)).toBeCloseTo(7.3, 0);
  });
});
