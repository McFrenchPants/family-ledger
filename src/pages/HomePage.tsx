import { MembershipGate } from "../features/auth/MembershipGate";
import { ChildDashboardPage } from "./ChildDashboardPage";
import { ParentDashboardPage } from "./ParentDashboardPage";

/**
 * `/home`: one address for both roles, showing each person their own
 * dashboard. Which dashboard renders is presentation only -- every read
 * behind either dashboard is scoped by RLS to what the caller may see.
 */
export function HomePage() {
  return (
    <MembershipGate>
      {(membership) =>
        membership.role === "parent" ? <ParentDashboardPage /> : <ChildDashboardPage />
      }
    </MembershipGate>
  );
}
