import { Navigate } from "react-router-dom";
import type { ReactNode } from "react";

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
      return <>{children(membership.membership)}</>;
  }
}
