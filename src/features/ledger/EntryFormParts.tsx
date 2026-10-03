import { useRef, useState } from "react";
import type { ReactNode } from "react";

import { ChoiceChips } from "../../components/ui/ChoiceChips";
import { cx } from "../../components/ui/cx";
import { Icon } from "../../components/ui/Icon";
import type { CalendarDate } from "../../lib/dates";
import { dateChoiceFor, dateForChoice } from "./entry-preview";
import type { DateChoice } from "./entry-preview";

/**
 * Pieces shared by the Add expense and Record payment screens. Layout only:
 * parsing, validation and submission stay in each page and in
 * `add-expense.ts` / `record-transaction.ts`.
 */

export function FieldError({ id, children }: { id: string; children?: string }) {
  if (!children) return null;
  return (
    <p id={id} className="flex items-center gap-1.5 text-label font-semibold text-danger">
      <Icon name="alert" size={16} />
      {children}
    </p>
  );
}

export function GroupLabel({ id, children }: { id: string; children: ReactNode }) {
  return (
    <span id={id} className="text-label font-semibold text-muted">
      {children}
    </span>
  );
}

/** The big "$ 42.17" amount field. 48px digits; `inputmode="decimal"` for the number pad. */
export function AmountEntry({
  id,
  label,
  value,
  onChange,
  error,
  placeholder = "0.00",
}: {
  id: string;
  /** Accessible label (visually hidden; the "$" and size make the purpose obvious). */
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  placeholder?: string;
}) {
  const errorId = `${id}-error`;
  return (
    <div className="flex flex-col items-center gap-1">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <div className="flex items-baseline justify-center gap-1 pb-1 pt-4">
        <span aria-hidden="true" className="text-amount text-subtle">
          $
        </span>
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          // Grows with what is typed so "$" and the digits stay centred together.
          style={{ width: `${Math.min(Math.max((value || placeholder).length, 4), 12) + 0.5}ch` }}
          className={cx(
            "tabular max-w-full min-w-0 rounded-control border-0 bg-transparent p-0 text-[3rem] font-bold leading-tight text-ink tabular-nums",
            "placeholder:text-border-strong focus-visible:outline-none",
            "focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
          )}
        />
      </div>
      <FieldError id={errorId}>{error}</FieldError>
    </div>
  );
}

const DATE_OPTIONS: ReadonlyArray<{ value: DateChoice; label: string }> = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "pick", label: "Pick date" },
];

/**
 * Today / Yesterday / Pick date. `today` is the household-zone date
 * (`todayInZone`), never the browser's clock; Yesterday is calendar
 * arithmetic on it. "Pick date" reveals a native date input.
 */
export function DateChips({
  idPrefix,
  today,
  value,
  onChange,
  error,
}: {
  idPrefix: string;
  today: CalendarDate;
  value: string;
  onChange: (value: string) => void;
  error?: string;
}) {
  const [picking, setPicking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const choice: DateChoice = picking ? "pick" : dateChoiceFor(value, today);
  const labelId = `${idPrefix}-date-label`;
  const inputId = `${idPrefix}-date`;
  const errorId = `${inputId}-error`;

  return (
    <div className="flex flex-col gap-1.5">
      <GroupLabel id={labelId}>Date</GroupLabel>
      <ChoiceChips
        label="Date"
        labelledBy={labelId}
        value={choice}
        onValueChange={(next) => {
          if (next === "") return;
          if (next === "pick") {
            setPicking(true);
            // Let the input render, then move focus to it.
            setTimeout(() => inputRef.current?.focus(), 0);
            return;
          }
          setPicking(false);
          onChange(dateForChoice(next, today, value));
        }}
        options={DATE_OPTIONS.map((option) => ({
          ...option,
          content:
            option.value === "pick" ? (
              <>
                <Icon name="cal" size={18} />
                {option.label}
              </>
            ) : undefined,
        }))}
      />
      {choice === "pick" && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={inputId} className="sr-only">
            Pick a date
          </label>
          <input
            ref={inputRef}
            id={inputId}
            type="date"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            className={cx(
              "min-h-touch-lg rounded-control border bg-surface px-3 text-body text-ink",
              error ? "border-danger" : "border-border-strong",
            )}
          />
        </div>
      )}
      <FieldError id={errorId}>{error}</FieldError>
    </div>
  );
}

/** "Add a note (optional)" link that reveals the note field (and anything else passed). */
export function OptionalDetails({
  label,
  defaultOpen = false,
  children,
}: {
  label: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (open) return <div className="flex flex-col gap-4">{children}</div>;
  return (
    <button
      type="button"
      aria-expanded={false}
      onClick={() => setOpen(true)}
      className="inline-flex min-h-touch items-center gap-2 self-start rounded-control text-label font-semibold text-accent-text"
    >
      <Icon name="plus" size={18} />
      {label}
    </button>
  );
}

/** Plain labelled text input in the new visual system (16px text, 48px tall). */
export function TextInput({
  id,
  label,
  value,
  onChange,
  error,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  placeholder?: string;
}) {
  const errorId = `${id}-error`;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-label font-semibold text-muted">
        {label}
      </label>
      <input
        id={id}
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={cx(
          "min-h-touch-lg w-full rounded-control border bg-surface px-3.5 text-body text-ink placeholder:text-subtle",
          error ? "border-danger" : "border-border-strong",
        )}
      />
      <FieldError id={errorId}>{error}</FieldError>
    </div>
  );
}

/** Announced list of what to fix, shown after a submit attempt fails validation. */
export function ErrorSummary({ messages }: { messages: readonly string[] }) {
  if (messages.length === 0) return null;
  return (
    <div
      role="alert"
      className="flex flex-col gap-1 rounded-control bg-danger-soft px-3 py-2.5 text-label font-medium text-danger"
    >
      <p className="flex items-center gap-2 font-semibold">
        <Icon name="alert" size={18} />
        Please fix {messages.length === 1 ? "this" : "these"} to continue:
      </p>
      <ul className="list-disc pl-8">
        {messages.map((message) => (
          <li key={message}>{message}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A failed save: says so and offers to try again (a fresh submit, never a
 * queued replay -- ADR-007).
 */
export function SaveError({ message, disabled }: { message: string; disabled: boolean }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-2 rounded-control bg-danger-soft px-3 py-2.5 text-label font-medium text-danger"
    >
      <p className="flex items-start gap-2">
        <Icon name="alert" size={18} className="mt-px" />
        <span>{message}</span>
      </p>
      <button
        type="submit"
        disabled={disabled}
        className="inline-flex min-h-touch items-center gap-2 rounded-control border border-danger bg-surface px-3.5 font-semibold text-danger disabled:opacity-60"
      >
        <Icon name="undo" size={18} />
        Try again
      </button>
    </div>
  );
}
