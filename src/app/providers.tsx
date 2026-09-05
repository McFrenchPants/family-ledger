import type { ReactNode } from "react";

import { MembershipProvider } from "../features/auth/MembershipProvider";
import { SessionProvider } from "../features/auth/SessionProvider";

/**
 * Single place to hang app-wide providers (auth session, household time zone,
 * query client) so adding one is a one-file change rather than a refactor of
 * main.tsx.
 *
 * MembershipProvider nests inside SessionProvider because it reads
 * `useSession()` to know when to (re)fetch the caller's household_members row.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <MembershipProvider>{children}</MembershipProvider>
    </SessionProvider>
  );
}
