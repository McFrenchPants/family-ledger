import { useEffect, useId, useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import { Button } from "../components/ui/Button";
import { Icon } from "../components/ui/Icon";
import { INPUT_CLASS, LABEL_CLASS } from "../components/ui/styles";
import {
  describeUpdatePasswordError,
  describeVerifyError,
  MIN_LENGTH_MESSAGE,
  MIN_PASSWORD_LENGTH,
  NETWORK_ERROR_MESSAGE,
  PASSWORD_MISMATCH_MESSAGE,
} from "../features/auth/password-errors";
import { supabase } from "../lib/supabase";

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
    <section className="mx-auto mt-4 flex w-full max-w-[560px] flex-col gap-4 min-[900px]:mt-12">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent text-on-accent">
          <Icon name="lock" />
        </span>
        <h1 className="text-title">Set your password</h1>
      </div>

      {done ? (
        <p
          role="status"
          className="flex items-start gap-2 rounded-control bg-ok-soft px-3 py-2.5 text-body font-semibold text-ok"
        >
          <Icon name="checkc" className="mt-0.5" />
          Your password is set and you are signed in. Taking you to your dashboard…
        </p>
      ) : deadMessage ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-control bg-danger-soft px-3 py-2.5 text-body font-medium text-danger"
        >
          <Icon name="alert" className="mt-0.5" />
          {deadMessage}
        </p>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={(event) => void handleSubmit(event)} noValidate>
          <p className="text-body text-muted">
            Choose a password of at least {MIN_PASSWORD_LENGTH} characters. Setting it will sign
            you in on this device.
          </p>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={passwordId} className={LABEL_CLASS}>
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
              className={INPUT_CLASS}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={confirmId} className={LABEL_CLASS}>
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
              className={INPUT_CLASS}
            />
          </div>

          {error ? (
            <p id={errorId} role="alert" className="text-label font-semibold text-danger">
              {error}
            </p>
          ) : null}

          <Button type="submit" variant="primary" size="lg" fullWidth disabled={submitting}>
            {submitting ? "Saving…" : "Set password"}
          </Button>
        </form>
      )}
    </section>
  );
}
