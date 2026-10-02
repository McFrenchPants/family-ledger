import { Navigate, useLocation, useParams } from "react-router-dom";

import { useMembership } from "../features/auth/membership-context";
import { PaymentPlanPage } from "../pages/PaymentPlanPage";

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
 * `/child/:memberId/payment-plan`: a Parent moves to `/family/:memberId`.
 * Anyone else (a Child, or a visitor whose membership is still loading or
 * failed) stays on the old address and sees `PaymentPlanPage`, which handles
 * those states itself and shows a Child no plan controls. The plan RPCs
 * reject a non-Parent server-side either way.
 */
export function LegacyPaymentPlanRoute() {
  const membership = useMembership();
  const { memberId = "" } = useParams<{ memberId: string }>();
  const { search, hash } = useLocation();

  if (membership.status === "loaded" && membership.membership.role === "parent") {
    return (
      <Navigate
        to={{ pathname: `/family/${encodeURIComponent(memberId)}`, search, hash }}
        replace
      />
    );
  }

  return <PaymentPlanPage />;
}
