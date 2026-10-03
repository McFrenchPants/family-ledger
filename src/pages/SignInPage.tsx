import { Navigate } from "react-router-dom";

import { Icon } from "../components/ui/Icon";
import { SignInForm } from "../features/auth/SignInForm";
import { useSession } from "../features/auth/session-context";

export function SignInPage() {
  const { session, loading } = useSession();

  return (
    <section className="mx-auto mt-4 flex w-full max-w-[560px] flex-col gap-4 min-[900px]:mt-12">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent text-on-accent">
          <Icon name="dollar" />
        </span>
        <h1 className="text-title">Family Ledger</h1>
      </div>

      {loading ? (
        <p role="status" className="text-label text-subtle">
          Checking session…
        </p>
      ) : session ? (
        // This page has no app chrome, so a signed-in visitor (including one
        // who just signed in) is sent on to their home rather than stranded.
        <Navigate to="/" replace />
      ) : (
        <>
          <p className="text-body text-muted">
            Sign in to see what’s owed and what’s coming up.
          </p>
          <SignInForm />
          <p className="text-label text-subtle">
            Forgot your password? Ask a parent for a new set-password link. Accounts are
            created by a parent; there is no self-service sign-up.
          </p>
        </>
      )}
    </section>
  );
}
