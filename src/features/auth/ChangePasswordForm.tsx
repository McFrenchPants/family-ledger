import { useId, useState } from "react";
import type { FormEvent } from "react";

import { Button } from "../../components/ui/Button";
import { Icon } from "../../components/ui/Icon";
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
  "min-h-touch-lg rounded-control border border-border-strong bg-surface px-3 text-body text-ink";

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
    <form className="flex flex-col gap-4" onSubmit={(event) => void handleSubmit(event)} noValidate>
      <p className="text-label text-muted">
        Changing your password signs you out on your other devices.
      </p>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={currentId} className="text-label font-semibold text-ink">
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

      <div className="flex flex-col gap-1.5">
        <label htmlFor={newId} className="text-label font-semibold text-ink">
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
        <span className="text-label text-muted">At least {MIN_PASSWORD_LENGTH} characters.</span>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={confirmId} className="text-label font-semibold text-ink">
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
        <p id={errorId} role="alert" className="text-label font-semibold text-danger">
          {error}
        </p>
      ) : null}

      {success ? (
        <p role="status" className="flex items-center gap-2 rounded-control bg-ok-soft px-3 py-2.5 text-label font-semibold text-ok">
          <Icon name="checkc" size={18} />
          Your password was changed.
        </p>
      ) : null}

      <Button type="submit" variant="primary" fullWidth disabled={submitting}>
        {submitting ? "Changing…" : "Change password"}
      </Button>
    </form>
  );
}
