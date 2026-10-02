// Family Ledger: helpers shared by the household-member Edge Functions
// (add-household-member and manage-household-member).
//
// Lives in supabase/functions/_shared/ -- the Supabase CLI bundler follows
// relative imports and ignores folders starting with an underscore when it
// looks for deployable functions.
//
// Privilege rules (same as add-household-member):
//   * `callerClient` carries the CALLER'S OWN JWT and is used for every
//     authorization decision and for the SQL functions that re-derive Parent-
//     ness from auth.uid().
//   * `adminClient` (service_role) is used ONLY for Auth Admin API calls and
//     the audit_log insert below. It is built from the function's own
//     environment, never from the request.
//
// Secrets hygiene: the one-time token is never logged. Log lines in this
// module and its callers carry only action names, ids and error codes -- never
// emails, tokens or keys.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

export const LINK_EXPIRY_HOURS = 24;
export const LINK_ACTION = "set_password_link_created";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/**
 * Public origin of the web app, no trailing slash. Returns null when unset or
 * not a valid http(s) URL; callers must fail closed (a link pointing nowhere,
 * or at a guessed host, must never be handed out).
 */
export function getAppBaseUrl(): string | null {
  const raw = (Deno.env.get("APP_BASE_URL") ?? "").trim().replace(/\/+$/, "");
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return raw;
  } catch {
    return null;
  }
}

// --- Responses ----------------------------------------------------------

function corsHeaders(): Record<string, string> {
  const base = getAppBaseUrl();
  if (!base) return {};
  return {
    "Access-Control-Allow-Origin": new URL(base).origin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

export function preflightResponse(): Response {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

/** Deliberately just { error }: no stack traces, no internal detail. */
export function errorResponse(message: string, status: number): Response {
  return jsonResponse({ error: message }, status);
}

// --- Clients ------------------------------------------------------------

export function makeCallerClient(authHeader: string): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function makeAdminClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// --- Authorization ------------------------------------------------------

/** True if the caller's OWN membership row in `householdId` is active + parent. */
export async function isActiveParentOf(
  callerClient: SupabaseClient,
  callerId: string,
  householdId: string,
): Promise<boolean | "error"> {
  const { data, error } = await callerClient
    .from("household_members")
    .select("role, status")
    .eq("household_id", householdId)
    .eq("user_id", callerId)
    .maybeSingle();
  if (error) return "error";
  return data?.role === "parent" && data?.status === "active";
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// --- Set-password link --------------------------------------------------

/**
 * Mint a one-time set-password link for the login with this email. The link
 * points at OUR page and carries the token hash in the URL fragment (never a
 * query string, so it is not sent to any server log). Supabase's own
 * action_link and the email OTP are discarded: a plain GET of action_link
 * (e.g. a chat link preview) would consume the token.
 *
 * Generating a link cancels every older link for that user.
 * Returns null on any failure (no detail leaked).
 */
export async function mintSetPasswordLink(
  adminClient: SupabaseClient,
  email: string,
  appBaseUrl: string,
): Promise<string | null> {
  const { data, error } = await adminClient.auth.admin.generateLink({
    type: "recovery",
    email,
  });
  const hashed = data?.properties?.hashed_token;
  if (error || !hashed) {
    console.error(`mintSetPasswordLink: generateLink failed (status ${error?.status ?? "none"})`);
    return null;
  }
  return `${appBaseUrl}/set-password#token_hash=${encodeURIComponent(hashed)}&type=recovery`;
}

/**
 * Audit row for a minted link: who, for whom, when. new_values is empty on
 * purpose -- no token, no email. Returns false if the insert failed.
 */
export async function recordLinkCreated(
  adminClient: SupabaseClient,
  args: { householdId: string; actorId: string; memberId: string },
): Promise<boolean> {
  const { error } = await adminClient.from("audit_log").insert({
    household_id: args.householdId,
    actor_user_id: args.actorId,
    entity_type: "household_members",
    entity_id: args.memberId,
    action: LINK_ACTION,
    new_values: {},
  });
  if (error) {
    console.error(`recordLinkCreated: audit insert failed (code ${error.code ?? "none"})`);
    return false;
  }
  return true;
}
