import type { ReactNode } from "react";

import { Icon } from "./Icon";
import type { IconName } from "./icon-paths";

type EmptyStateProps = {
  icon?: IconName;
  title: string;
  children?: ReactNode;
  /** Optional call to action (e.g. a <Button>). */
  action?: ReactNode;
};

export function EmptyState({ icon = "file", title, children, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-sunken text-muted">
        <Icon name={icon} size={24} />
      </span>
      <p className="text-head text-ink">{title}</p>
      {children ? <div className="max-w-sm text-body text-muted">{children}</div> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
