import { Navigate } from "react-router-dom";

import { LoadError } from "../../components/ui/LoadError";
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
      // Both roles share one home address; `/home` picks the dashboard.
      return <Navigate to="/home" replace />;
  }
}
