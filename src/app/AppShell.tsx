import { useEffect, useRef } from "react";
import type { MouseEvent } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigationType } from "react-router-dom";

import { Avatar } from "../components/ui/Avatar";
import { Button } from "../components/ui/Button";
import { cx } from "../components/ui/cx";
import { Icon } from "../components/ui/Icon";
import type { IconName } from "../components/ui/icon-paths";
import { Sheet, SheetClose } from "../components/ui/Sheet";
import { buttonClass } from "../components/ui/styles";
import { useMembership } from "../features/auth/membership-context";
import type { Membership, MembershipRole } from "../features/auth/membership-context";

/**
 * The app frame around every signed-in page: a bottom tab bar with a centre
 * "+" under 900px, a left sidebar from 900px up.
 *
 * Which destinations appear is decoration, not a control. A Child who types
 * a Parent address still meets `RequireRole` on the route, the page's own
 * role check, and -- what actually matters -- RLS and security-definer
 * functions in Postgres.
 */

type Destination = { to: string; label: string; icon: IconName };

const HOME: Destination = { to: "/home", label: "Home", icon: "home" };
const ACTIVITY: Destination = { to: "/activity", label: "Activity", icon: "list" };
const FAMILY: Destination = { to: "/family", label: "Family", icon: "users" };
const SETTINGS: Destination = { to: "/settings", label: "Settings", icon: "sliders" };

function destinationsFor(role: MembershipRole): Destination[] {
  return role === "parent" ? [HOME, ACTIVITY, FAMILY, SETTINGS] : [HOME, ACTIVITY, SETTINGS];
}

/** Pages for entering something: no tab bar, a close link back home instead. */
function isTaskPath(pathname: string): boolean {
  return pathname.startsWith("/new/");
}

export function AppShell() {
  const membership = useMembership();
  const location = useLocation();
  const navigationType = useNavigationType();
  const mainRef = useRef<HTMLElement>(null);

  // Links appear only once we know who is signed in, so nobody sees the
  // wrong ones flash by while loading.
  const member = membership.status === "loaded" ? membership.membership : null;
  const taskPage = isTaskPath(location.pathname);

  // On a client-side page change, move focus to the new page's content so
  // keyboard and screen-reader users start there. Not on first load (the
  // browser handles that), and not on redirects (REPLACE), which follow a
  // navigation that already moved focus or happen during start-up.
  const pageKey = location.pathname + location.search;
  const lastPageKey = useRef(pageKey);
  useEffect(() => {
    if (lastPageKey.current === pageKey) return;
    lastPageKey.current = pageKey;
    if (navigationType === "REPLACE") return;
    mainRef.current?.focus();
  }, [pageKey, navigationType]);

  function skipToContent(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    mainRef.current?.focus();
  }

  return (
    <div className="min-h-[100dvh] bg-bg text-ink min-[900px]:grid min-[900px]:grid-cols-[248px_minmax(0,1fr)]">
      <a
        href="#main"
        onClick={skipToContent}
        className={cx(
          "sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[70]",
          "focus:rounded-control focus:bg-surface focus:px-4 focus:py-3 focus:text-body focus:font-semibold focus:text-accent-text focus:shadow-card",
        )}
      >
        Skip to content
      </a>

      <Sidebar member={member} />

      <div className="min-w-0">
        {taskPage && (
          <div className="mx-auto flex w-full max-w-[640px] items-center px-gutter pt-3 min-[900px]:max-w-[1040px] min-[900px]:px-10 min-[900px]:pt-6">
            <Link
              to="/home"
              aria-label="Close"
              className="-ml-2 grid min-h-touch min-w-touch place-items-center rounded-control text-muted transition-colors hover:bg-sunken hover:text-ink motion-reduce:transition-none"
            >
              <Icon name="x" />
            </Link>
          </div>
        )}

        <main
          id="main"
          ref={mainRef}
          tabIndex={-1}
          className={cx(
            "mx-auto w-full max-w-[640px] px-gutter outline-none",
            "min-[900px]:max-w-[1040px] min-[900px]:px-10 min-[900px]:pb-16",
            taskPage
              ? "pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-2 min-[900px]:pt-2"
              : "pb-[calc(112px+env(safe-area-inset-bottom))] pt-6 min-[900px]:pt-8",
          )}
        >
          <Outlet />
        </main>
      </div>

      {!taskPage && <TabBar member={member} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Mobile: bottom tab bar (hidden from 900px, so only one "Main" nav   */
/* is ever displayed -- and exposed to assistive tech -- at a time).   */
/* ------------------------------------------------------------------ */

function TabBar({ member }: { member: Membership | null }) {
  const destinations = member ? destinationsFor(member.role) : [];

  return (
    <nav
      aria-label="Main"
      data-testid="tab-bar"
      className="fixed inset-x-0 bottom-0 z-30 min-h-[calc(65px+env(safe-area-inset-bottom))] border-t border-border bg-surface px-1 pb-[calc(6px+env(safe-area-inset-bottom))] pt-1.5 min-[900px]:hidden"
    >
      {member && (
        <ul
          className={cx(
            "mx-auto grid max-w-[640px] items-end",
            member.role === "parent" ? "grid-cols-5" : "grid-cols-4",
          )}
        >
          {destinations.slice(0, 2).map((d) => (
            <li key={d.to}>
              <TabLink destination={d} />
            </li>
          ))}
          <li className="flex justify-center">
            <NewEntry role={member.role} placement="fab" />
          </li>
          {destinations.slice(2).map((d) => (
            <li key={d.to}>
              <TabLink destination={d} />
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}

function TabLink({ destination }: { destination: Destination }) {
  return (
    <NavLink
      to={destination.to}
      className={({ isActive }) =>
        cx(
          "flex min-h-[52px] flex-col items-center justify-center gap-0.5 rounded-control text-caption",
          "transition-colors motion-reduce:transition-none",
          isActive ? "font-bold text-accent-text" : "font-semibold text-subtle hover:text-ink",
        )
      }
    >
      <Icon name={destination.icon} />
      {destination.label}
    </NavLink>
  );
}

/* ------------------------------------------------------------------ */
/* Desktop: left sidebar (displayed from 900px only).                  */
/* ------------------------------------------------------------------ */

function Sidebar({ member }: { member: Membership | null }) {
  const destinations = member ? destinationsFor(member.role) : [];

  return (
    <header
      data-testid="sidebar"
      className="sticky top-0 hidden h-[100dvh] flex-col gap-1 border-r border-border bg-surface px-4 py-5 min-[900px]:flex"
    >
      <div className="flex items-center gap-2.5 px-2 pb-4 pt-1 text-head font-bold text-ink">
        <span className="grid h-8 w-8 place-items-center rounded-[9px] bg-accent text-on-accent">
          <Icon name="dollar" />
        </span>
        Family Ledger
      </div>

      {member && (
        <div className="mb-3">
          <NewEntry role={member.role} placement="sidebar" />
        </div>
      )}

      <nav aria-label="Main">
        {member && (
          <ul className="flex flex-col gap-1">
            {destinations.map((d) => (
              <li key={d.to}>
                <NavLink
                  to={d.to}
                  className={({ isActive }) =>
                    cx(
                      "flex min-h-touch items-center gap-3 rounded-[10px] px-3 text-body",
                      "transition-colors motion-reduce:transition-none",
                      isActive
                        ? "bg-accent-soft font-bold text-accent-text"
                        : "font-semibold text-muted hover:bg-sunken hover:text-ink",
                    )
                  }
                >
                  <Icon name={d.icon} />
                  {d.label}
                </NavLink>
              </li>
            ))}
          </ul>
        )}
      </nav>

      {member && (
        <div className="mt-auto flex items-center gap-2.5 p-2">
          <Avatar name={member.name} size="sm" />
          <span className="flex min-w-0 flex-col text-label">
            <span className="truncate font-semibold text-ink">{member.name}</span>
            <span className="text-subtle">{member.role === "parent" ? "Parent" : "Child"}</span>
          </span>
        </div>
      )}
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* "+" / "New entry".                                                  */
/* ------------------------------------------------------------------ */

const FAB_CLASS = cx(
  "grid h-14 w-14 -translate-y-3.5 place-items-center rounded-full bg-accent text-on-accent hover:bg-accent/90",
  "shadow-[0_6px_16px_rgb(var(--accent)/0.35)]",
);

const SIDEBAR_LINK_BUTTON_CLASS = buttonClass({ variant: "primary", fullWidth: true });

/**
 * A Parent gets a sheet offering both entry types. A Child gets a plain link
 * to the expense form -- there is no payment option for a Child anywhere
 * (and `record_payment` rejects one server-side regardless).
 */
function NewEntry({ role, placement }: { role: MembershipRole; placement: "fab" | "sidebar" }) {
  if (role === "child") {
    return placement === "fab" ? (
      <Link to="/new/expense" aria-label="Add expense" className={FAB_CLASS}>
        <Icon name="plus" size={26} />
      </Link>
    ) : (
      <Link to="/new/expense" className={SIDEBAR_LINK_BUTTON_CLASS}>
        <Icon name="plus" />
        Add expense
      </Link>
    );
  }

  const trigger =
    placement === "fab" ? (
      <button type="button" aria-label="New entry" className={FAB_CLASS}>
        <Icon name="plus" size={26} />
      </button>
    ) : (
      <Button variant="primary" icon="plus" fullWidth>
        New entry
      </Button>
    );

  return (
    <Sheet trigger={trigger} title="What happened?">
      <div className="flex flex-col gap-2.5">
        <SheetEntry
          to="/new/expense"
          icon="plus"
          iconClass="bg-accent-soft text-accent-text"
          title="Add an expense"
          hint="Something a child owes for"
        />
        <SheetEntry
          to="/new/payment"
          icon="check"
          iconClass="bg-ok-soft text-ok"
          title="Record a payment"
          hint="Money a child paid back"
        />
      </div>
    </Sheet>
  );
}

function SheetEntry({
  to,
  icon,
  iconClass,
  title,
  hint,
}: {
  to: string;
  icon: IconName;
  iconClass: string;
  title: string;
  hint: string;
}) {
  return (
    <SheetClose asChild>
      <Link
        to={to}
        className="flex min-h-[68px] w-full items-center gap-3.5 rounded-[14px] border border-border bg-surface px-3.5 py-3 text-ink transition-colors hover:bg-sunken motion-reduce:transition-none"
      >
        <span className={cx("grid h-11 w-11 shrink-0 place-items-center rounded-control", iconClass)}>
          <Icon name={icon} />
        </span>
        <span className="flex flex-col">
          <span className="text-body font-semibold">{title}</span>
          <span className="text-label text-muted">{hint}</span>
        </span>
      </Link>
    </SheetClose>
  );
}
