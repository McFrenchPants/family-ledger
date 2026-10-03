import { Navigate } from "react-router-dom";
import type { ReactNode } from "react";

import { LoadError } from "../../components/ui/LoadError";
import { useMembership } from "./membership-context";
import type { MembershipRole } from "./membership-context";

/**
 * Route guard: renders `children` only when the signed-in caller's own
 * `household_members` row (from MembershipProvider) has the given role.
 *
 * This is routing convenience, not a security control -- a Child who
 * tampers with the client and lands on a Parent route anyway gains nothing,
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
        <p role="status" className="text-label text-subtle">
          Loading your account…
        </p>
      );

    case "signed-out":
      return <Navigate to="/sign-in" replace />;

    case "error":
      return (
        <LoadError
          message={`Could not load your account: ${membership.message}`}
          onRetry={membership.retry}
        />
      );

    case "no-membership":
      return (
        <p role="alert" className="text-label text-danger">
          Your account is not linked to a household yet. Ask a parent in your household to invite
          you.
        </p>
      );

    case "loaded":
      if (membership.membership.role !== role) {
        return <Navigate to="/home" replace />;
      }

      return <>{children}</>;
  }
}
