import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
// This subpath both registers @testing-library/jest-dom's matchers
// (toBeInTheDocument(), toBeDisabled(), etc) against vitest's `expect` and
// augments the `vitest` module's `Assertion`/`AsymmetricMatchersContaining`
// types so they typecheck -- it targets the `vitest` module directly rather
// than a global, so it works the same whether or not `test.globals` is on.
import "@testing-library/jest-dom/vitest";

// jsdom's DOM is not reset between tests on its own; without this, a
// component rendered in one test is still mounted (and can still match
// queries) in the next.
afterEach(() => {
  cleanup();
});
