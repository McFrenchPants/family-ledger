import type { ReactNode } from "react";

/**
 * Single place to hang future app-wide providers (auth session, household
 * time zone, query client). Intentionally a pass-through for now so that
 * adding one later is a one-file change rather than a refactor of main.tsx.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
