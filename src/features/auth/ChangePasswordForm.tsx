import { useId, useState } from "react";
import type { FormEvent } from "react";

import { supabase } from "../../lib/supabase";
import {
  describeUpdatePasswordError,
  isNetworkAuthError,
  MIN_LENGTH_MESSAGE,
  MIN_PASSWORD_LENGTH,
  NETWORK_ERROR_MESSAGE,
  PASSWORD_MISMATCH_MESSAGE,
} from "./password-errors";

const fieldClass =
  "min-h-touch rounded-card border border-surface-border bg-surface px-3 text-body text-ink outline-none focus:border-accent";

/**
 * Change-own-password form for any signed-in member. It re-checks the current
 * password by signing in again (so a borrowed, already-open session cannot
 * silently change it), then updates. Supabase Auth enforces the real rules
 * server-side; the checks here only save a round trip.
 */
export function ChangePasswordForm({ email }: { email: string }) {
  const currentId = useId();
  const newId = useId();
  const confirmId = useId();
  const errorId = useId();

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(false);

    if (current.length === 0) {
      setError("Enter your current password.");
      return;
    }
    if (next.length < MIN_PASSWORD_LENGTH) {
      setError(MIN_LENGTH_MESSAGE);
      return;
    }
    if (next !== confirm) {
      setError(PASSWORD_MISMATCH_MESSAGE);
      return;
    }

    setSubmitting(true);

    try {
      const { error: reauthError } = await supabase.auth.signInWithPassword({
        email,
        password: current,
      });

      if (reauthError) {
        setError(
          isNetworkAuthError(reauthError) ? NETWORK_ERROR_MESSAGE : "Current password is incorrect.",
        );
        return;
      }

      const { error: updateError } = await supabase.auth.updateUser({ password: next });

      if (updateError) {
        setError(describeUpdatePasswordError(updateError));
        return;
      }

      setCurrent("");
      setNext("");
      setConfirm("");
      setSuccess(true);
    } catch {
      setError(NETWORK_ERROR_MESSAGE);
    } finally {
      setSubmitting(false);
    }
  }

  const describedBy = error ? errorId : undefined;

  return (
    <form className="flex flex-col gap-3" onSubmit={(event) => void handleSubmit(event)} noValidate>
      <p className="text-label text-ink-muted">
        Changing your password signs you out on your other devices.
      </p>

      <div className="flex flex-col gap-1">
        <label htmlFor={currentId} className="text-label font-medium text-ink">
          Current password
        </label>
        <input
          id={currentId}
          type="password"
          autoComplete="current-password"
          required
          value={current}
          onChange={(event) => setCurrent(event.target.value)}
          aria-describedby={describedBy}
          className={fieldClass}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={newId} className="text-label font-medium text-ink">
          New password
        </label>
        <input
          id={newId}
          type="password"
          autoComplete="new-password"
          required
          value={next}
          onChange={(event) => setNext(event.target.value)}
          aria-describedby={describedBy}
          className={fieldClass}
        />
        <span className="text-label text-ink-subtle">At least {MIN_PASSWORD_LENGTH} characters.</span>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={confirmId} className="text-label font-medium text-ink">
          Confirm new password
        </label>
        <input
          id={confirmId}
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          aria-describedby={describedBy}
          className={fieldClass}
        />
      </div>

      {error ? (
        <p id={errorId} role="alert" className="text-label text-owed">
          {error}
        </p>
      ) : null}

      {success ? (
        <p role="status" className="text-label text-settled">
          Your password was changed.
        </p>
      ) : null}

      <button
        type="submit"
        disabled={submitting}
        className="min-h-touch rounded-card bg-accent px-3 text-body font-medium text-on-accent disabled:opacity-50"
      >
        {submitting ? "Changing…" : "Change password"}
      </button>
    </form>
  );
}
