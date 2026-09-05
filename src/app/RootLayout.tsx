import { NavLink, Outlet } from "react-router-dom";

import { SessionStatus } from "../features/auth/SessionStatus";

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  [
    "inline-flex min-h-touch items-center rounded-card px-3 text-label font-medium",
    isActive
      ? "bg-accent-soft text-accent"
      : "text-ink-muted hover:bg-surface-sunken hover:text-ink",
  ].join(" ");

export function RootLayout() {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-screen-sm flex-col bg-surface">
      <header className="border-b border-surface-border px-gutter py-3">
        <h1 className="text-title font-semibold">Family Ledger</h1>
        <nav aria-label="Main" className="mt-2 flex gap-2">
          <NavLink to="/parent" className={navLinkClass}>
            Parent
          </NavLink>
          <NavLink to="/child" className={navLinkClass}>
            Child
          </NavLink>
          <NavLink to="/sign-in" className={navLinkClass}>
            Sign in
          </NavLink>
        </nav>

        <div className="mt-2">
          <SessionStatus />
        </div>
      </header>

      <main className="flex-1 px-gutter py-4">
        <Outlet />
      </main>
    </div>
  );
}
