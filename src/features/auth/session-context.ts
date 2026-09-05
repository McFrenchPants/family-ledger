import { createContext, useContext } from "react";
import type { Session } from "@supabase/supabase-js";

export type SessionState = {
  /** The current Supabase session, or null when nobody is signed in. */
  session: Session | null;
  /** True until the initial `getSession()` call settles on page load. */
  loading: boolean;
};

/**
 * Kept in its own module (no components) so the provider file can stay a pure
 * component module -- Vite's fast refresh only preserves state for modules
 * that export components exclusively.
 */
export const SessionContext = createContext<SessionState | null>(null);

export function useSession(): SessionState {
  const value = useContext(SessionContext);

  if (!value) {
    throw new Error("useSession must be used inside <SessionProvider>.");
  }

  return value;
}
