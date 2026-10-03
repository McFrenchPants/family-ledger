import { forwardRef, useId, type InputHTMLAttributes } from "react";

import { cx } from "./cx";
import { INPUT_BASE_CLASS, LABEL_CLASS } from "./styles";

type FieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "id"> & {
  label: string;
  hint?: string;
  /** Error text; marks the input invalid and is announced via aria-describedby. */
  error?: string;
  id?: string;
};

/** Labelled text input. Font is 16px so iOS does not zoom on focus. */
export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { label, hint, error, id, className, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <label htmlFor={inputId} className={LABEL_CLASS}>
        {label}
      </label>
      <input
        ref={ref}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={cx(INPUT_BASE_CLASS, error ? "border-danger" : "border-border-strong")}
        {...rest}
      />
      {hint ? (
        <p id={hintId} className="text-label text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-label font-semibold text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
});
