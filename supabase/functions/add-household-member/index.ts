// Family Ledger: M6.3 -- add-household-member Edge Function.
//
// This is the OTHER half of the invite-a-member flow that M6.2's
// public.add_household_member() SQL function deliberately left undone: that
// function assumes p_user_id already names a real auth.users row and never
// creates one. Only the Supabase Admin API (service_role) can create that
// row, and service_role must never reach the browser -- so this has to be a
// server-side Edge Function, not client code calling Admin endpoints
// directly.
//
// Two privilege boundaries stay cleanly separated on purpose:
//   1. Admin API (service_role) -- used ONLY to create/delete the auth.users
//      row. Nothing else in this file uses the service_role client.
//   2. RLS-covered SQL (the caller's own JWT) -- used for the Parent-check
//      read and for calling add_household_member(), which is itself
//      SECURITY DEFINER and re-derives the caller's Parent-ness from
//      auth.uid() internally. Calling it with the ORIGINAL caller's identity
//      (never service_role) is what keeps its own authorization check
//      meaningful.
//
// Flow:
//   1. Read + validate input. Role is checked before anything else touches
//      the network -- an invalid role is a client bug, not a case worth an
//      Admin API round trip.
//   2. Verify the caller's identity from their own JWT (auth.getUser()), then
//      independently query household_members (RLS-scoped to the caller) to
//      confirm they are an ACTIVE PARENT of the TARGET household. This is a
//      real server-side re-derivation, not trust in anything the client
//      claims about itself.
//   3. Create the auth.users row via the Admin API, with a server-generated
//      password (never a client-chosen one -- see the header comment in the
//      SQL migration for why: simpler, avoids weak-password client input
//      entirely) and email_confirm: true (no email provider in this
//      project's cost guardrail, so there is no confirmation flow to run).
//   4. Call add_household_member() with the caller's own JWT.
//   5. If step 4 fails, best-effort delete the auth.users row created in
//      step 3 so a rejected request never leaves an orphaned, credentialed
//      account with no household link. Cleanup failure is logged but does
//      not mask the original error.
//
// Authorization failures are intentionally generic ("not authorized to add a
// member to this household") and never distinguish "household does not
// exist" from "you are not a Parent of it" -- mirroring
// add_household_member()'s own error semantics.

import { createClient } from "npm:@supabase/supabase-js@2";

type Role = "parent" | "child";

interface AddMemberRequest {
  household_id?: unknown;
  name?: unknown;
  role?: unknown;
  email?: unknown;
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, status: number): Response {
  // Deliberately just { error }: no stack traces, no internal exception
  // shapes, no hint about which internal step failed.
  return jsonResponse({ error: message }, status);
}

/** A URL-safe, high-entropy initial password. Never persisted beyond Auth's own hash. */
function generateInitialPassword(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  // base64url, no padding -- 24 random bytes -> 32 chars, well past this
  // project's minimum_password_length = 6 and free of characters that could
  // complicate copy/paste.
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return errorResponse("method not allowed", 405);
  }

  // --- Parse + validate input up front -------------------------------
  let body: AddMemberRequest;
  try {
    body = await req.json();
  } catch {
    return errorResponse("request body must be valid JSON", 400);
  }

  const householdId = body.household_id;
  const name = body.name;
  const role = body.role;
  const email = body.email;

  if (typeof householdId !== "string" || householdId.length === 0) {
    return errorResponse("household_id is required", 400);
  }
  if (typeof name !== "string" || name.trim().length === 0) {
    return errorResponse("name is required", 400);
  }
  if (role !== "parent" && role !== "child") {
    return errorResponse("role must be 'parent' or 'child'", 400);
  }
  if (typeof email !== "string" || email.trim().length === 0) {
    return errorResponse("email is required", 400);
  }
  const validatedRole = role as Role;

  // --- Identify the caller from their OWN JWT -------------------------
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return errorResponse("missing Authorization header", 401);
  }

  // A client anchored to the caller's own session. Used for auth.getUser(),
  // the Parent-check read (RLS-scoped), and the eventual
  // add_household_member() call -- never for the Admin API.
  const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const {
    data: { user: caller },
    error: getUserError,
  } = await callerClient.auth.getUser();

  if (getUserError || !caller) {
    return errorResponse("invalid or expired session", 401);
  }

  // --- Re-derive Parent-ness ourselves, server-side --------------------
  // Never trust the request body's household_id/role pair on its own: query
  // household_members through the caller's own RLS-scoped client (the
  // household_members_select_self policy lets a caller see their own row
  // regardless of which household_id they ask about) and check the result
  // in code. A non-Parent, a Parent of a *different* household, or an
  // inactive membership all fall through to the same generic rejection --
  // this never discloses whether the target household exists.
  const { data: callerMembership, error: membershipError } = await callerClient
    .from("household_members")
    .select("role, status")
    .eq("household_id", householdId)
    .eq("user_id", caller.id)
    .maybeSingle();

  if (membershipError) {
    return errorResponse("unable to verify authorization", 500);
  }

  const isActiveParent =
    callerMembership?.role === "parent" && callerMembership?.status === "active";

  if (!isActiveParent) {
    return errorResponse(
      "only an active Parent of this household may add a member",
      403,
    );
  }

  // --- Create the auth.users row (Admin API, service_role) -------------
  // A separate client, built only from the Edge Function's own environment
  // (never from the request), used ONLY for the Admin API calls below.
  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const initialPassword = generateInitialPassword();

  const { data: createdUser, error: createUserError } = await adminClient.auth.admin.createUser({
    email,
    password: initialPassword,
    email_confirm: true, // no email provider in this project -- nothing to confirm
  });

  if (createUserError || !createdUser?.user) {
    // Admin API errors (duplicate email, invalid email, etc.) are real but
    // their internal detail isn't handed to the client -- a clear, generic
    // failure is enough here.
    return errorResponse("unable to create the new member's account", 400);
  }

  const newUserId = createdUser.user.id;

  // --- Link the household_members row (caller's own JWT) ---------------
  const { data: newMember, error: addMemberError } = await callerClient.rpc(
    "add_household_member",
    {
      p_household_id: householdId,
      p_user_id: newUserId,
      p_name: name,
      p_role: validatedRole,
    },
  );

  if (addMemberError) {
    // Roll back the just-created auth.users row so a rejected request never
    // leaves an orphaned, credentialed account with no household link.
    // Best-effort: log cleanup failure but still surface the ORIGINAL error.
    const { error: cleanupError } = await adminClient.auth.admin.deleteUser(newUserId);
    if (cleanupError) {
      console.error(
        `add-household-member: failed to roll back orphaned auth.users row ${newUserId} ` +
          `after add_household_member() failed: ${cleanupError.message}`,
      );
    }
    return errorResponse("unable to add the household member", 400);
  }

  return jsonResponse(
    {
      id: (newMember as { id: string } | null)?.id ?? null,
      user_id: newUserId,
      initial_password: initialPassword,
    },
    201,
  );
});
