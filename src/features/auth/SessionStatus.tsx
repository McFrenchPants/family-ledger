import { useState } from "react";

import { supabase } from "../../lib/supabase";
import { useSession } from "./session-context";

/**
 * Shows who the browser currently believes is signed in. Phase 0 evidence that
 * a session exists and survives a reload -- it grants no access by itself.
 */
export function SessionStatus() {
  const { session, loading } = useSession();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  if (loading) {
    return (
      <p data-testid="session-status" className="text-label text-ink-subtle">
        Checking session…
      </p>
    );
  }

  if (!session) {
    return (
      <p data-testid="session-status" className="text-label text-ink-subtle">
        Signed out
      </p>
    );
  }

  async function handleSignOut() {
    setSigningOut(true);
    setSignOutError(null);

    try {
      // Same reasoning as the sign-in path: supabase-js reports failures in the
      // result, and a network fault throws. Either one, unhandled, would leave
      // the button stuck disabled with nothing on screen to explain why.
      const { error } = await supabase.auth.signOut();

      if (error) {
        setSignOutError(error.message);
      }
    } catch (caught) {
      setSignOutError(
        caught instanceof Error
          ? `Could not sign out: ${caught.message}`
          : "Could not sign out.",
      );
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <p
      data-testid="session-status"
      className="flex items-center gap-2 text-label text-ink-muted"
    >
      <span>
        Signed in as <span className="font-medium text-ink">{session.user.email}</span>
      </span>
      <button
        type="button"
        onClick={() => void handleSignOut()}
        disabled={signingOut}
        className="rounded-card border border-surface-border px-2 py-1 text-label text-ink-muted disabled:opacity-50"
      >
        Sign out
      </button>
      {signOutError ? (
        <span role="alert" className="text-owed">
          {signOutError}
        </span>
      ) : null}
    </p>
  );
}
