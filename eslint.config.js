import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: ["dist", "node_modules", "supabase", "docs", "analysis", "scripts"],
  },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "no-restricted-globals": [
        "error",
        {
          name: "parseFloat",
          message:
            "Money is integer cents. Use decimal-safe parsing, never binary floating point.",
        },
      ],
      // `no-restricted-globals` only catches the bare global, so Number.parseFloat
      // would slip through the guard above. Note this pair is a signal, not a real
      // control: the actual protection is src/lib/currency.ts plus its tests, since
      // no lint rule can catch every float hazard (unary +, Number(), arithmetic).
      "no-restricted-properties": [
        "error",
        {
          object: "Number",
          property: "parseFloat",
          message:
            "Money is integer cents. Use decimal-safe parsing, never binary floating point.",
        },
      ],
    },
  },
  {
    // Node-side config files.
    files: ["*.config.{js,ts}", "vite.config.ts"],
    languageOptions: {
      globals: globals.node,
    },
  },
  prettier,
);
