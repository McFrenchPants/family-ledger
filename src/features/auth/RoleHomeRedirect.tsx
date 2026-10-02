import { Navigate } from "react-router-dom";

import { useMembership } from "./membership-context";

/**
 * The `/` route: sends each visitor to their own home. Routing convenience
 * only -- the destination pages and the database enforce access themselves.
 */
export function RoleHomeRedirect() {
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
      return (
        <Navigate to={membership.membership.role === "parent" ? "/parent" : "/child"} replace />
      );
  }
}
