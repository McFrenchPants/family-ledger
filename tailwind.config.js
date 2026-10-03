/**
 * Colours come from CSS variables declared in src/styles/tokens.css (the one
 * source of truth, light + dark). Each variable holds space-separated RGB
 * channels, so `rgb(var(--x) / <alpha-value>)` keeps opacity modifiers
 * (`bg-accent/50`) working.
 */
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Token names from design spec 6.2.
        bg: token("bg"),
        surface: token("surface"),
        sunken: token("sunken"),
        raised: token("raised"),
        border: {
          DEFAULT: token("border"),
          strong: token("border-strong"),
        },
        ink: token("ink"),
        muted: token("muted"),
        subtle: token("subtle"),
        accent: {
          DEFAULT: token("accent"),
          soft: token("accent-soft"),
          text: token("accent-text"),
        },
        danger: {
          DEFAULT: token("danger"),
          soft: token("danger-soft"),
        },
        warn: {
          DEFAULT: token("warn"),
          soft: token("warn-soft"),
        },
        ok: {
          DEFAULT: token("ok"),
          soft: token("ok-soft"),
          btn: token("ok-btn"),
        },
        on: {
          accent: token("on-accent"),
          ok: token("on-ok"),
          danger: token("on-danger"),
        },
      },
      // A bare `border` (no colour class) would otherwise use Tailwind's
      // fixed light grey, which glares in dark mode.
      borderColor: {
        DEFAULT: token("border"),
      },
      fontFamily: {
        sans: [
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      fontSize: {
        // Type scale (design spec). Weights are defaults; an explicit
        // font-* utility still wins because fontWeight is emitted later.
        display: ["2.5rem", { lineHeight: "2.625rem", fontWeight: "700" }],
        amount: ["1.75rem", { lineHeight: "2rem", fontWeight: "650" }],
        title: ["1.375rem", { lineHeight: "1.75rem", fontWeight: "650" }],
        head: ["1.0625rem", { lineHeight: "1.5rem", fontWeight: "600" }],
        body: ["1rem", { lineHeight: "1.5rem" }],
        label: ["0.875rem", { lineHeight: "1.25rem" }],
        caption: ["0.75rem", { lineHeight: "1rem", letterSpacing: "0.02em" }],
      },
      spacing: {
        // Phone-first 4px grid plus touch-target minimums.
        gutter: "1rem",
        touch: "2.75rem", // 44px: any tappable thing
        "touch-lg": "3rem", // 48px: main buttons
        "touch-xl": "3.5rem", // 56px: the screen's main action
      },
      borderRadius: {
        // Shape scale: cards/sheets 16px, buttons/inputs 12px.
        panel: "1rem",
        control: "0.75rem",
      },
      boxShadow: {
        card: "var(--shadow)",
      },
      transitionDuration: {
        toggle: "150ms",
        sheet: "200ms",
        progress: "300ms",
      },
      keyframes: {
        "sheet-in": {
          from: { transform: "translateY(100%)" },
          to: { transform: "translateY(0)" },
        },
        "dialog-in": {
          from: { opacity: "0", transform: "translate(-50%, -48%) scale(0.98)" },
          to: { opacity: "1", transform: "translate(-50%, -50%) scale(1)" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
      },
      animation: {
        "sheet-in": "sheet-in 200ms ease-out",
        "dialog-in": "dialog-in 200ms ease-out",
        "fade-in": "fade-in 200ms ease-out",
      },
    },
  },
  plugins: [],
};
