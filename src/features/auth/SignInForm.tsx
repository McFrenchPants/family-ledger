import { useId, useState } from "react";
import type { FormEvent } from "react";

import { Button } from "../../components/ui/Button";
import { INPUT_CLASS, LABEL_CLASS } from "../../components/ui/styles";
import { supabase } from "../../lib/supabase";

/**
 * Email + password sign-in (ADR-010: no magic link, no self-service sign-up --
 * accounts are Parent-created). Phase 0 scope is only "does authentication
 * work end to end", so there is no password reset or role resolution here.
 */
export function SignInForm() {
  const emailId = useId();
  const passwordId = useId();
  const errorId = useId();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      // Supabase returns failures in the result rather than throwing, so an
      // unchecked call fails silently. Surface it as visible text.
      if (signInError) {
        setError(signInError.message);
        return;
      }

      setPassword("");
    } catch (caught) {
      // Network/CORS failures do throw. Never let one land as an unhandled
      // rejection with no user-visible state.
      setError(
        caught instanceof Error
          ? `Could not reach the sign-in service: ${caught.message}`
          : "Could not reach the sign-in service.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={emailId} className={LABEL_CLASS}>
          Email
        </label>
        <input
          id={emailId}
          type="email"
          autoComplete="username"
          spellCheck={false}
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className={INPUT_CLASS}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={passwordId} className={LABEL_CLASS}>
          Password
        </label>
        <input
          id={passwordId}
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
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
        {submitting ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
