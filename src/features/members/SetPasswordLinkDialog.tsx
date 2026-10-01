import { useEffect, useId, useRef, useState } from "react";

export type SetPasswordLink = {
  /** The one-time link. Held only in the open dialog's state; never persisted. */
  url: string;
  heading: string;
  intro: string;
};

/**
 * Shows a one-time set-password link. The repo has no modal library, so this
 * is an inline `role="dialog"` panel: focus moves to its heading on open,
 * Escape closes it, and focus returns to where it was. The parent owns the
 * link in state and drops it on close, so the URL lives nowhere else.
 */
export function SetPasswordLinkDialog({
  link,
  onClose,
}: {
  link: SetPasswordLink;
  onClose: () => void;
}) {
  const headingId = useId();
  const fieldId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [copyNote, setCopyNote] = useState<string | null>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    headingRef.current?.focus();
    return () => {
      if (previous && previous.isConnected) {
        previous.focus();
      }
    };
  }, []);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(link.url);
      setCopyNote("Copied.");
    } catch {
      inputRef.current?.focus();
      inputRef.current?.select();
      setCopyNote(
        "Could not copy automatically. The link is selected; press Ctrl+C (or long-press) to copy it.",
      );
    }
  }

  return (
    <div
      role="dialog"
      aria-labelledby={headingId}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          onClose();
        }
      }}
      className="flex flex-col gap-3 rounded-card border border-accent/40 bg-accent-soft p-4"
    >
      <h3 id={headingId} ref={headingRef} tabIndex={-1} className="text-body font-semibold">
        {link.heading}
      </h3>
      <p className="text-label text-ink">{link.intro}</p>

      <div className="flex flex-col gap-1">
        <label htmlFor={fieldId} className="text-label font-medium text-ink">
          Set-password link
        </label>
        <input
          id={fieldId}
          ref={inputRef}
          type="text"
          readOnly
          value={link.url}
          onFocus={(event) => event.currentTarget.select()}
          className="min-h-touch rounded-card border border-surface-border bg-surface px-3 font-mono text-label text-ink"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="min-h-touch rounded-card bg-accent px-3 text-label font-medium text-white"
        >
          Copy link
        </button>
        <button
          type="button"
          onClick={onClose}
          className="min-h-touch rounded-card border border-surface-border px-3 text-label text-ink-muted"
        >
          Close
        </button>
      </div>
      <p role="status" className="text-label text-ink-muted">
        {copyNote}
      </p>

      <ul className="list-disc space-y-1 pl-5 text-label text-ink-muted">
        <li>The link is valid for 24 hours and works only once.</li>
        <li>
          Anyone who has this link can set that person&apos;s password, so send it to them
          privately.
        </li>
        <li>Creating a new link cancels any older link for the same person.</li>
        <li>This link is not saved. Once you close this box you can only make a new one.</li>
      </ul>
    </div>
  );
}
