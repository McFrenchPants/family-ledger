import { useState } from "react";

import { supabase } from "../../lib/supabase";

/**
 * Sign-out with its failure states (moved out of the old SessionStatus line
 * so Settings can render it as a row). Signing out only drops this browser's
 * session; it grants or removes no access by itself.
 */
export function useSignOut() {
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signOut() {
    setSigningOut(true);
    setError(null);

    try {
      // Same reasoning as the sign-in path: supabase-js reports failures in the
      // result, and a network fault throws. Either one, unhandled, would leave
      // the button stuck disabled with nothing on screen to explain why.
      const { error: signOutError } = await supabase.auth.signOut();

      if (signOutError) {
        setError(signOutError.message);
      }
    } catch (caught) {
      setError(
        caught instanceof Error ? `Could not sign out: ${caught.message}` : "Could not sign out.",
      );
    } finally {
      setSigningOut(false);
    }
  }

  return { signOut, signingOut, error };
}
