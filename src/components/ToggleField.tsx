import * as Switch from "@radix-ui/react-switch";
import { useId } from "react";

type ToggleFieldProps = {
  label: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
};

/**
 * Example of the project's component pattern: a Radix primitive supplies the
 * behavior (keyboard interaction, focus management, ARIA role/state), and
 * Tailwind classes supply the (deliberately plain) appearance.
 *
 * Nothing here overrides Radix's own event handling — no onKeyDown, no
 * tabIndex, no role — so the switch stays reachable with Tab and operable
 * with Enter and Space as Radix implements it.
 */
export function ToggleField({
  label,
  description,
  checked,
  onCheckedChange,
  disabled = false,
}: ToggleFieldProps) {
  const labelId = useId();
  const descriptionId = useId();

  return (
    <div className="flex min-h-touch items-center justify-between gap-4 rounded-card border border-surface-border bg-surface px-3 py-2">
      <span className="flex flex-col">
        <span id={labelId} className="text-body font-medium text-ink">
          {label}
        </span>
        {description ? (
          <span id={descriptionId} className="text-label text-ink-muted">
            {description}
          </span>
        ) : null}
      </span>

      <Switch.Root
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        aria-labelledby={labelId}
        aria-describedby={description ? descriptionId : undefined}
        className="relative h-6 w-11 shrink-0 rounded-full border border-surface-border bg-surface-sunken transition-colors motion-reduce:transition-none data-[state=checked]:border-accent data-[state=checked]:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Switch.Thumb className="block h-5 w-5 translate-x-0.5 rounded-full bg-surface shadow transition-transform will-change-transform motion-reduce:transition-none data-[state=checked]:translate-x-[1.375rem]" />
      </Switch.Root>
    </div>
  );
}
