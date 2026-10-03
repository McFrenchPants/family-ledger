import * as Dialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";

import { Icon } from "./Icon";

type SheetProps = {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Element that opens the sheet (rendered via Radix `asChild`). */
  trigger?: ReactNode;
  title: string;
  description?: string;
  children?: ReactNode;
};

/**
 * Modal built on Radix Dialog (focus trap, Escape, scroll lock, labelling).
 * A bottom sheet that slides up on phones; a centred dialog at >= 900px.
 */
export function Sheet({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  children,
}: SheetProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger ? <Dialog.Trigger asChild>{trigger}</Dialog.Trigger> : null}
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 animate-fade-in bg-[var(--scrim)] motion-reduce:animate-none" />
        <Dialog.Content
          className={[
            "fixed z-50 flex max-h-[90dvh] flex-col gap-4 overflow-y-auto border border-border bg-surface text-ink shadow-card",
            "inset-x-0 bottom-0 animate-sheet-in rounded-t-panel p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]",
            "min-[900px]:inset-x-auto min-[900px]:bottom-auto min-[900px]:left-1/2 min-[900px]:top-1/2 min-[900px]:w-full min-[900px]:max-w-lg",
            "min-[900px]:-translate-x-1/2 min-[900px]:-translate-y-1/2 min-[900px]:animate-dialog-in min-[900px]:rounded-panel min-[900px]:p-6",
            "motion-reduce:animate-none min-[900px]:motion-reduce:animate-none",
          ].join(" ")}
          {...(description ? {} : { "aria-describedby": undefined })}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <Dialog.Title className="text-title text-ink">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="text-body text-muted">
                  {description}
                </Dialog.Description>
              ) : null}
            </div>
            <Dialog.Close
              aria-label="Close"
              className="-mr-2 -mt-1 grid min-h-touch min-w-touch place-items-center rounded-control text-muted transition-colors hover:bg-sunken hover:text-ink motion-reduce:transition-none"
            >
              <Icon name="x" />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Wrap a button inside a sheet to close it when clicked. */
export const SheetClose = Dialog.Close;
