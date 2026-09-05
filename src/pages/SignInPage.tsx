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
        <p data-testid="signed-in-panel" className="text-body text-settled">
          Signed in as {session.user.email}.
        </p>
      ) : (
        <SignInForm />
      )}
    </section>
  );
}
