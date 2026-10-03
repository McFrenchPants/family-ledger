import { Navigate } from "react-router-dom";
import type { ReactNode } from "react";

import { LoadError } from "../../components/ui/LoadError";
import { useMembership } from "./membership-context";
import type { Membership } from "./membership-context";

/**
 * Renders the same loading / signed-out / error-retry / no-membership states
 * as `RequireRole` and `RoleHomeRedirect`, and calls `children` with the
 * caller's own membership once it has loaded. For routes that serve both
 * roles (and pick what to show by role) rather than requiring one.
 *
 * Routing convenience only: what any role can read or write is enforced by
 * Postgres RLS and security-definer functions, not by which component renders.
 */
export function MembershipGate({ children }: { children: (membership: Membership) => ReactNode }) {
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
      return <>{children(membership.membership)}</>;
  }
}
