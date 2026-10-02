import { useEffect, useId, useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import {
  describeUpdatePasswordError,
  describeVerifyError,
  MIN_LENGTH_MESSAGE,
  MIN_PASSWORD_LENGTH,
  NETWORK_ERROR_MESSAGE,
  PASSWORD_MISMATCH_MESSAGE,
} from "../features/auth/password-errors";
import { supabase } from "../lib/supabase";

const fieldClass =
  "min-h-touch rounded-card border border-surface-border bg-surface px-3 text-body text-ink outline-none focus:border-accent";

const INVALID_LINK_MESSAGE = "This link isn't valid. Ask a Parent for a new one.";
const REDIRECT_DELAY_MS = 1500;

/**
 * Reads the one-time token from the URL fragment only (never the query
 * string, which would reach server logs). Returns null when it is missing or
 * malformed. Pure: stripping the fragment is a separate effect.
 */
function readTokenFromHash(hash: string): string | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const token = params.get("token_hash");
  if (params.get("type") !== "recovery" || !token || token.length > 512 || /\s/.test(token)) {
    return null;
  }
  return token;
}

/**
 * `/set-password#token_hash=...&type=recovery` -- where a Parent-issued
 * one-time link lands. The token is consumed only when the person presses the
 * button (so chat-app link previews cannot burn it), is kept in component
 * state only, and is removed from the address bar immediately. Never logged.
 */
export function SetPasswordPage() {
  const navigate = useNavigate();
  const passwordId = useId();
  const confirmId = useId();
  const errorId = useId();

  // Read once; the fragment is removed in the effect below.
  const [token] = useState(() => readTokenFromHash(window.location.hash));
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // True once verifyOtp has succeeded: the token is spent but a session
  // exists, so a retry must go straight to updateUser.
  const [verified, setVerified] = useState(false);
  const [done, setDone] = useState(false);
  // verifyOtp itself failed in a way where the link can't work any more.
  const [linkDead, setLinkDead] = useState<string | null>(null);

  useEffect(() => {
    if (window.location.hash) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }, []);

  useEffect(() => {
    if (!done) {
      return;
    }
    const timer = window.setTimeout(() => navigate("/", { replace: true }), REDIRECT_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [done, navigate]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(MIN_LENGTH_MESSAGE);
      return;
    }
    if (password !== confirm) {
      setError(PASSWORD_MISMATCH_MESSAGE);
      return;
    }
    if (!token) {
      return;
    }

    setSubmitting(true);

    try {
      if (!verified) {
        const { error: verifyError } = await supabase.auth.verifyOtp({
          token_hash: token,
          type: "recovery",
        });

        if (verifyError) {
          const message = describeVerifyError(verifyError);
          if (message === NETWORK_ERROR_MESSAGE) {
            // The token was not consumed; the person can simply retry.
            setError(message);
          } else {
            setLinkDead(message);
          }
          return;
        }

        setVerified(true);
      }

      const { error: updateError } = await supabase.auth.updateUser({ password });

      if (updateError) {
        setError(describeUpdatePasswordError(updateError));
        return;
      }

      setPassword("");
      setConfirm("");
      setDone(true);
    } catch {
      setError(NETWORK_ERROR_MESSAGE);
    } finally {
      setSubmitting(false);
    }
  }

  const deadMessage = token ? linkDead : INVALID_LINK_MESSAGE;

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-title font-semibold">Set your password</h2>

      {done ? (
        <p role="status" className="text-body text-settled">
          Your password is set and you are signed in. Taking you to your dashboard…
        </p>
      ) : deadMessage ? (
        <p role="alert" className="text-body text-owed">
          {deadMessage}
        </p>
      ) : (
        <form className="flex flex-col gap-3" onSubmit={(event) => void handleSubmit(event)} noValidate>
          <p className="text-body text-ink-muted">
            Choose a password of at least {MIN_PASSWORD_LENGTH} characters. Setting it will sign
            you in on this device.
          </p>

          <div className="flex flex-col gap-1">
            <label htmlFor={passwordId} className="text-label font-medium text-ink">
              New password
            </label>
            <input
              id={passwordId}
              type="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              className={fieldClass}
            />
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
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              className={fieldClass}
            />
          </div>

          {error ? (
            <p id={errorId} role="alert" className="text-label text-owed">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={submitting}
            className="min-h-touch rounded-card bg-accent px-3 text-body font-medium text-on-accent disabled:opacity-50"
          >
            {submitting ? "Saving…" : "Set password"}
          </button>
        </form>
      )}
    </section>
  );
}
