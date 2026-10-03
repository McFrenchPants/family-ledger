import { Navigate, useLocation, useParams } from "react-router-dom";

import { RequireRole } from "../features/auth/RequireRole";

/**
 * Old-address redirects (pre-redesign bookmarks and installed-app links).
 * Every one replaces the history entry and keeps the query string and hash,
 * so `/add-expense?x=1` lands on `/new/expense?x=1`. Internal links all use
 * the new addresses; these exist only for links saved before the change.
 */
export function LegacyRedirect({ to }: { to: string }) {
  const { search, hash } = useLocation();
  return <Navigate to={{ pathname: to, search, hash }} replace />;
}

/** `/child/:memberId/history` -> `/activity?child=:memberId` (other query kept). */
export function LegacyChildHistoryRedirect() {
  const { memberId = "" } = useParams<{ memberId: string }>();
  const { search, hash } = useLocation();
  const params = new URLSearchParams(search);
  params.set("child", memberId);
  return <Navigate to={{ pathname: "/activity", search: `?${params.toString()}`, hash }} replace />;
}

/**
 * `/child/:memberId/payment-plan`: a Parent moves to `/family/:memberId`,
 * where plan editing now lives. Anyone else is sent to `/home` (replace) by
 * `RequireRole` -- a Child's plan status already shows on their Home --
 * which also handles the loading, signed-out and error states. The plan
 * functions reject a non-Parent server-side either way.
 */
export function LegacyPaymentPlanRoute() {
  const { memberId = "" } = useParams<{ memberId: string }>();
  const { search, hash } = useLocation();

  return (
    <RequireRole role="parent">
      <Navigate
        to={{ pathname: `/family/${encodeURIComponent(memberId)}`, search, hash }}
        replace
      />
    </RequireRole>
  );
}
