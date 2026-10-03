import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { Card } from "../../components/ui/Card";
import { Icon } from "../../components/ui/Icon";
import type { IconName } from "../../components/ui/icon-paths";

/** Small presentational pieces shared by Settings and its sub-pages. */

/** Text inputs and selects that don't go through `Field` (selects, inline rename). */
export const INPUT_CLASS =
  "min-h-touch-lg rounded-control border border-border-strong bg-surface px-3 text-body text-ink placeholder:text-subtle disabled:opacity-60";

/** Labels for the inputs above, matching `Field`'s label. */
export const LABEL_CLASS = "text-label font-semibold text-ink";

/** One row of a settings card: 56px tall, divided from the row above. */
export const ROW_CLASS =
  "flex min-h-14 items-center gap-3 border-t border-border py-2 first:border-t-0";

/** The divider alone, for a row whose tappable part sits inside it. */
export const ROW_DIVIDER_CLASS = "border-t border-border first:border-t-0";

/** A whole-row tap target inside a divider: hover tint bleeds a little past the text. */
export const ROW_TAP_CLASS =
  "-mx-2 flex min-h-14 w-[calc(100%+1rem)] items-center gap-3 rounded-control px-2 py-2 text-left hover:bg-sunken";

/** The square icon tile at the start of a row. */
export function RowIcon({ name }: { name: IconName }) {
  return (
    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-control bg-sunken text-muted">
      <Icon name={name} />
    </span>
  );
}

/** A card with its own h2. */
export function SettingsSection({
  id,
  title,
  intro,
  children,
}: {
  id: string;
  title: string;
  intro?: string;
  children: ReactNode;
}) {
  const headingId = `${id}-heading`;
  return (
    <Card as="section" aria-labelledby={headingId} className="flex flex-col">
      <h2 id={headingId} className="text-head">
        {title}
      </h2>
      {intro && <p className="mb-1 mt-0.5 text-label text-muted">{intro}</p>}
      <div className="flex flex-col">{children}</div>
    </Card>
  );
}

/** A whole-row link to another page, with a chevron. */
export function SettingsLinkRow({
  to,
  icon,
  children,
}: {
  to: string;
  icon: IconName;
  children: ReactNode;
}) {
  return (
    <div className={ROW_DIVIDER_CLASS}>
      <Link to={to} className={ROW_TAP_CLASS}>
        <RowIcon name={icon} />
        <span className="min-w-0 grow">{children}</span>
        <Icon name="chev" className="text-subtle" />
      </Link>
    </div>
  );
}

/**
 * Header for a page under Settings: a back arrow to `/settings` above the
 * page's one h1, with an optional line under the title.
 */
export function SubPageHeader({ title, intro }: { title: string; intro?: ReactNode }) {
  return (
    <header className="flex flex-col gap-1">
      <Link
        to="/settings"
        aria-label="Back to Settings"
        className="-ml-2 inline-flex min-h-touch w-fit items-center gap-1 rounded-control px-2 text-label font-semibold text-accent-text"
      >
        <Icon name="back" />
        Settings
      </Link>
      <h1 className="text-title">{title}</h1>
      {intro && <p className="text-body text-muted">{intro}</p>}
    </header>
  );
}

/**
 * Active / Inactive as a tag with an icon and a word -- never colour alone.
 */
export function ActiveTag({ active }: { active: boolean }) {
  return active ? (
    <span className="inline-flex w-fit items-center gap-1 rounded-full bg-ok-soft px-2 py-0.5 text-caption font-semibold text-ok">
      <Icon name="checkc" size={14} />
      Active
    </span>
  ) : (
    <span className="inline-flex w-fit items-center gap-1 rounded-full bg-sunken px-2 py-0.5 text-caption font-semibold text-muted">
      <Icon name="ban" size={14} />
      Inactive
    </span>
  );
}
