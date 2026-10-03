import { Navigate } from "react-router-dom";

import { Card } from "../components/ui/Card";
import { ChangePasswordForm } from "../features/auth/ChangePasswordForm";
import { useSession } from "../features/auth/session-context";
import { SubPageHeader } from "../features/settings/SettingsParts";

/** `/settings/account` -- any signed-in member (Parent or Child) can change their own password. */
export function AccountPage() {
  const { session, loading } = useSession();

  if (loading) {
    return (
      <p role="status" className="text-label text-subtle">
        Checking session…
      </p>
    );
  }

  const email = session?.user.email;
  if (!session || !email) {
    return <Navigate to="/sign-in" replace />;
  }

  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-col gap-4">
      <SubPageHeader title="Change password" intro={`Signed in as ${email}.`} />
      <Card>
        <ChangePasswordForm email={email} />
      </Card>
    </div>
  );
}
