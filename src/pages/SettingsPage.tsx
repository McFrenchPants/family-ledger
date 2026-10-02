import { Link, Navigate } from "react-router-dom";
import type { ReactNode } from "react";

import { SessionStatus } from "../features/auth/SessionStatus";
import { useMembership } from "../features/auth/membership-context";
import { useSession } from "../features/auth/session-context";
import { PushSubscribeButton } from "../features/push/PushSubscribeButton";
import { PushTestSendButton } from "../features/push/PushTestSendButton";
import { InstallRow } from "../features/pwa/InstallRow";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-body font-semibold">{title}</h3>
      {children}
    </section>
  );
}

/**
 * `/settings` -- any signed-in member. The Advanced section is hidden from
 * children as decoration only; the push-test function rejects them server-side.
 */
export function SettingsPage() {
  const { session, loading } = useSession();
  const membership = useMembership();

  if (loading) {
    return (
      <p role="status" className="text-label text-ink-subtle">
        Checking session…
      </p>
    );
  }

  if (!session) {
    return <Navigate to="/sign-in" replace />;
  }

  const isParent = membership.status === "loaded" && membership.membership.role === "parent";

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-title font-semibold">Settings</h2>

      <Section title="This device">
        <InstallRow />
        <div className="flex flex-col gap-2">
          <h4 className="text-label font-semibold text-ink">Payment reminders</h4>
          <PushSubscribeButton />
        </div>
      </Section>

      <Section title="Account">
        <SessionStatus />
        <Link
          to="/account"
          className="inline-flex min-h-touch items-center self-start text-label text-accent underline"
        >
          Change my password
        </Link>
      </Section>

      {isParent && (
        <Section title="Advanced">
          <PushTestSendButton />
        </Section>
      )}
    </div>
  );
}
