import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { Button } from "../../components/ui/Button";
import { cx } from "../../components/ui/cx";
import { Icon } from "../../components/ui/Icon";
import type { IconName } from "../../components/ui/icon-paths";
import type { MembershipRole } from "../auth/membership-context";
import { ROLE_LABELS, remindersLabel } from "./family-view";

/** Small presentational pieces shared by the Family list and a member's page. */

/** The member's role as a quiet tag. A role is not a status, so no status colour. */
export function RoleTag({ role }: { role: MembershipRole }) {
  return (
    <span className="inline-flex items-center rounded-full bg-sunken px-2 py-0.5 text-caption font-semibold text-muted">
      {ROLE_LABELS[role]}
    </span>
  );
}

/** "Archived" always as a word with an icon, never colour alone. */
export function ArchivedTag() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-sunken px-2 py-0.5 text-caption font-semibold text-muted">
      <Icon name="ban" size={14} />
      Archived
    </span>
  );
}

/**
 * Bell (on) or a crossed circle (off) with an accessible name. Callers
 * render nothing at all while reminder state is unknown -- never a guess.
 */
export function ReminderIcon({ on }: { on: boolean }) {
  return (
    <Icon
      name={on ? "bell" : "ban"}
      label={remindersLabel(on)}
      data-reminders={on ? "on" : "off"}
      className="text-subtle"
    />
  );
}

export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-2">
      <p className="text-label text-danger">{message}</p>
      <Button size="sm" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

/** A link styled like a small Button (Button itself renders a <button>). */
export function LinkButton({
  to,
  icon,
  variant = "secondary",
  className,
  children,
}: {
  to: string;
  icon: IconName;
  variant?: "secondary" | "ok";
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      className={cx(
        "inline-flex min-h-touch items-center justify-center gap-2 whitespace-nowrap rounded-control border px-3.5 text-label font-semibold",
        "transition-colors duration-toggle motion-reduce:transition-none",
        variant === "ok"
          ? "border-ok-btn bg-ok-btn text-on-ok"
          : "border-border-strong bg-surface text-ink hover:bg-sunken",
        className,
      )}
    >
      <Icon name={icon} />
      {children}
    </Link>
  );
}

/** A text link with a 44px touch target, for "See all" / "Back" style links. */
export function TextLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="inline-flex min-h-touch items-center rounded-control px-1 text-label font-semibold text-accent-text"
    >
      {children}
    </Link>
  );
}
