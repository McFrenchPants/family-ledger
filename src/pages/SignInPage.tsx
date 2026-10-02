import { Navigate } from "react-router-dom";

import { SignInForm } from "../features/auth/SignInForm";
import { useSession } from "../features/auth/session-context";

export function SignInPage() {
  const { session, loading } = useSession();

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-title font-semibold">Sign in</h2>
        <p className="mt-1 text-body text-ink-muted">
          Accounts are created by a Parent — there is no self-service sign-up.
        </p>
      </div>

      {loading ? (
        <p className="text-body text-ink-subtle">Checking session…</p>
      ) : session ? (
        // This page has no app chrome, so a signed-in visitor (including one
        // who just signed in) is sent on to their home rather than stranded.
        <Navigate to="/" replace />
      ) : (
        <SignInForm />
      )}
    </section>
  );
}
