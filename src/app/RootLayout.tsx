import { NavLink, Outlet } from "react-router-dom";

import { useMembership } from "../features/auth/membership-context";

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  [
    "inline-flex min-h-touch items-center rounded-card px-3 text-label font-medium",
    isActive
      ? "bg-accent-soft text-accent"
      : "text-ink-muted hover:bg-surface-sunken hover:text-ink",
  ].join(" ");

export function RootLayout() {
  const membership = useMembership();

  // Links appear only once we know who is signed in, so nobody sees the
  // wrong ones flash by while loading. Routing convenience, not security.
  const homePath =
    membership.status === "loaded"
      ? membership.membership.role === "parent"
        ? "/parent"
        : "/child"
      : null;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-screen-sm flex-col bg-surface">
      <header className="border-b border-surface-border px-gutter py-3">
        <h1 className="text-title font-semibold">Family Ledger</h1>
        <nav aria-label="Main" className="mt-2 flex flex-wrap gap-2">
          {homePath && (
            <>
              <NavLink to={homePath} className={navLinkClass}>
                Home
              </NavLink>
              <NavLink to="/settings" className={navLinkClass}>
                Settings
              </NavLink>
            </>
          )}
        </nav>
      </header>

      <main className="flex-1 px-gutter py-4">
        <Outlet />
      </main>
    </div>
  );
}
