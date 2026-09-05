import type { ReactNode } from "react";

import { SessionProvider } from "../features/auth/SessionProvider";

/**
 * Single place to hang app-wide providers (auth session, household time zone,
 * query client) so adding one is a one-file change rather than a refactor of
 * main.tsx.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
