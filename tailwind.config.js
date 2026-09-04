/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    // Deliberately small, muted token set. This is a household utility, not a
    // themed product: one neutral ramp, one accent, one positive, one negative.
    extend: {
      colors: {
        ink: {
          DEFAULT: "#1f2328",
          muted: "#5b6470",
          subtle: "#8b939e",
        },
        surface: {
          DEFAULT: "#ffffff",
          sunken: "#f4f5f7",
          border: "#dfe2e6",
        },
        accent: {
          DEFAULT: "#2f5d8a",
          soft: "#e5edf5",
        },
        owed: "#9a3d2f",
        settled: "#2f6b45",
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
        // Small type scale: label / body / title / amount.
        label: ["0.8125rem", { lineHeight: "1.125rem" }],
        body: ["1rem", { lineHeight: "1.5rem" }],
        title: ["1.25rem", { lineHeight: "1.75rem" }],
        amount: ["1.75rem", { lineHeight: "2rem" }],
      },
      spacing: {
        // Phone-first 4px grid plus a one-handed minimum touch target.
        gutter: "1rem",
        touch: "2.75rem",
      },
      borderRadius: {
        card: "0.5rem",
      },
    },
  },
  plugins: [],
};
