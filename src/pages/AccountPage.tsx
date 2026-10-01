import { Navigate } from "react-router-dom";

import { ChangePasswordForm } from "../features/auth/ChangePasswordForm";
import { useSession } from "../features/auth/session-context";

/** `/account` -- any signed-in member (Parent or Child) can change their own password. */
export function AccountPage() {
  const { session, loading } = useSession();

  if (loading) {
    return (
      <p role="status" className="text-label text-ink-subtle">
        Checking session…
      </p>
    );
  }

  const email = session?.user.email;
  if (!session || !email) {
    return <Navigate to="/sign-in" replace />;
  }

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-title font-semibold">Change my password</h2>
        <p className="mt-1 text-body text-ink-muted">Signed in as {email}.</p>
      </div>
      <ChangePasswordForm email={email} />
    </section>
  );
}
