import { Navigate } from "react-router-dom";
import type { ReactNode } from "react";

import { useMembership } from "./membership-context";
import type { MembershipRole } from "./membership-context";

/**
 * Route guard: renders `children` only when the signed-in caller's own
 * `household_members` row (from MembershipProvider) has the given role.
 *
 * This is routing convenience, not a security control -- a Child who
 * tampers with the client and lands on `/parent` anyway gains nothing,
 * because every balance-affecting read/write is independently checked by
 * Postgres RLS / security-definer functions regardless of which route
 * rendered. This component only decides which placeholder page a browser
 * shows.
 */
export function RequireRole({ role, children }: { role: MembershipRole; children: ReactNode }) {
  const membership = useMembership();

  switch (membership.status) {
    case "loading":
      return (
        <p role="status" className="text-label text-ink-subtle">
          Loading your account…
        </p>
      );

    case "signed-out":
      return <Navigate to="/sign-in" replace />;

    case "error":
      return (
        <div role="alert" className="flex flex-col items-start gap-2">
          <p className="text-label text-owed">
            Could not load your account: {membership.message}
          </p>
          <button
            type="button"
            onClick={membership.retry}
            className="min-h-touch rounded-card border border-surface-border px-3 text-label text-ink-muted"
          >
            Retry
          </button>
        </div>
      );

    case "no-membership":
      return (
        <p role="alert" className="text-label text-owed">
          Your account is not linked to a household yet. Ask a parent in your household to invite
          you.
        </p>
      );

    case "loaded":
      if (membership.membership.role !== role) {
        return <Navigate to={membership.membership.role === "parent" ? "/parent" : "/child"} replace />;
      }

      return <>{children}</>;
  }
}
