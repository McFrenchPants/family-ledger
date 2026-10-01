import { supabase } from "../../lib/supabase";

export type FunctionResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      /** HTTP status of the Edge Function's reply, or null when it was never reached. */
      status: number | null;
      /** The function's own `{error}` text, if it sent one. */
      message: string | null;
    };

type ResponseLike = { status: number; json: () => Promise<unknown> };

function isResponseLike(value: unknown): value is ResponseLike {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as ResponseLike).status === "number" &&
    typeof (value as ResponseLike).json === "function"
  );
}

function errorText(body: unknown): string | null {
  if (typeof body === "object" && body !== null) {
    const text = (body as { error?: unknown }).error;
    if (typeof text === "string" && text.length > 0) {
      return text;
    }
  }
  return null;
}

/**
 * Calls an Edge Function and flattens supabase-js's several failure shapes
 * (a returned error with the function's `{error}` body in `data` or only in
 * `error.context`, or a thrown network failure) into one result. Never
 * throws, never logs. The function is the real authorization control; this
 * only decides what words to show.
 */
export async function invokeFunction<T>(
  name: string,
  body: Record<string, unknown>,
): Promise<FunctionResult<T>> {
  try {
    const { data, error } = await supabase.functions.invoke(name, { body });

    if (error) {
      let message = errorText(data);
      let status: number | null = null;
      const context = (error as { context?: unknown }).context;

      if (isResponseLike(context)) {
        status = context.status;
        if (message === null) {
          try {
            message = errorText(await context.json());
          } catch {
            // Body was not JSON; fall back to the caller's generic wording.
          }
        }
      }

      return { ok: false, status, message };
    }

    return { ok: true, data: data as T };
  } catch {
    return { ok: false, status: null, message: null };
  }
}

/** "that email can't be used" becomes "That email can't be used." */
export function sentence(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return trimmed;
  }
  const capitalised = trimmed[0].toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(capitalised) ? capitalised : `${capitalised}.`;
}
