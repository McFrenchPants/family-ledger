import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";

import { supabase } from "../../lib/supabase";
import { SessionContext } from "./session-context";

/**
 * Holds the browser's view of "who is signed in" so components do not each
 * poll Supabase for it.
 *
 * This is display state, not a security boundary. Anything the session is used
 * to show is still fetched under the anon key and still authorized by Postgres
 * RLS; a tampered client can set this to anything it likes and gain nothing.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    // Read the persisted session first so a reload does not flash the signed-out
    // UI, then let the auth listener take over for sign-in/out/token refresh.
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) {
        return;
      }

      setSession(data.session);
      setLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setLoading(false);
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo(() => ({ session, loading }), [session, loading]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
