import { defineConfig } from "vitest/config";

/**
 * Vitest is configured separately from vite.config.ts so that the app build
 * config stays free of test-only settings.
 *
 * Note there is deliberately NO `TZ` pinned here. The date tests are written to
 * assert the same results regardless of the machine's local zone, which is the
 * whole point of src/lib/dates.ts — pinning TZ would hide a host-local
 * implementation bug rather than expose it. Run the suite under any TZ and it
 * must pass.
 */
export default defineConfig({
  test: {
    // These are pure-logic modules; no DOM is needed. UI tests, when they
    // arrive, should add their own environment via a per-file docblock.
    environment: "node",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // Explicit imports from "vitest" rather than ambient globals, so the test
    // files typecheck under the app tsconfig with no extra `types` entry.
    globals: false,
    // Registers @testing-library/jest-dom's matchers against vitest's
    // `expect` and resets jsdom between tests. Runs for every test file
    // (jsdom-environment ones as well as the pure-logic "node" ones) but is a
    // no-op for the latter since they never render anything.
    setupFiles: ["src/test/setup.ts"],
  },
});
