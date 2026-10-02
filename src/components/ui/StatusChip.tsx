import { cx } from "./cx";
import { Icon } from "./Icon";
import { STATUS_KINDS, TONE_CLASSES, type StatusKind } from "./status";

type StatusChipProps = {
  kind: StatusKind;
  /** Visible text; required so status is never conveyed by colour alone. */
  label: string;
  className?: string;
};

export function StatusChip({ kind, label, className }: StatusChipProps) {
  const { icon, tone } = STATUS_KINDS[kind];
  return (
    <span
      data-status={kind}
      className={cx(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-label font-semibold",
        TONE_CLASSES[tone],
        className,
      )}
    >
      <Icon name={icon} size={16} />
      {label}
    </span>
  );
}
