/** Mirrors the server's minimum; the server (Supabase Auth) is the real control. */
export const MIN_PASSWORD_LENGTH = 8;

export const MIN_LENGTH_MESSAGE = `Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`;
export const PASSWORD_MISMATCH_MESSAGE = "The two passwords don't match.";
export const NETWORK_ERROR_MESSAGE =
  "Could not reach the sign-in service. Check your connection and try again.";

type AuthLikeError = { code?: string; status?: number; name?: string } | null | undefined;

/** True for a failure to reach the server at all (offline, DNS, 5xx). */
export function isNetworkAuthError(error: AuthLikeError): boolean {
  if (!error) {
    return false;
  }
  return (
    error.name === "AuthRetryableFetchError" ||
    error.status === 0 ||
    (typeof error.status === "number" && error.status >= 500)
  );
}

/** Words for a failed `updateUser({ password })`. */
export function describeUpdatePasswordError(error: AuthLikeError): string {
  if (error?.code === "same_password") {
    return "Choose a different password from your current one.";
  }
  if (error?.code === "weak_password") {
    return MIN_LENGTH_MESSAGE;
  }
  if (isNetworkAuthError(error)) {
    return NETWORK_ERROR_MESSAGE;
  }
  return "Could not change the password. Please try again.";
}

/** Words for a failed `verifyOtp` on the set-password page. */
export function describeVerifyError(error: AuthLikeError): string {
  if (error?.code === "user_banned") {
    return "This account is not active.";
  }
  if (isNetworkAuthError(error)) {
    return NETWORK_ERROR_MESSAGE;
  }
  return "This link has expired or was already used. Ask a Parent for a new one.";
}
