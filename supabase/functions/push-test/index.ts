// Family Ledger: N4.3 -- push-test Edge Function (Phase 4 push notification
// technical spike).
//
// Purpose: prove Web Push delivery actually works end-to-end (VAPID-signed,
// encrypted payload, real fetch to the browser's push service) and make the
// push service's raw response status observable to whoever triggered the
// test. This is deliberately throwaway-shaped spike tooling -- there is no
// reminder logic, no scheduling, no cleanup of expired subscriptions (a 410
// response is just returned as-is, never acted on). That is intentionally
// out of scope; see N4.1/N4.2 for the schema/keys this builds on and later
// phases for real notification-sending infrastructure.
//
// Request shape (chosen for simplicity -- this is a spike, not a stable
// public API): POST { subscription_id: "<uuid>" }, naming a row in
// public.push_subscriptions to send a fixed test notification to.
//
// ---------------------------------------------------------------------------
// Authorization -- the part of this file that actually matters
// ---------------------------------------------------------------------------
//
// Exactly two callers may trigger a test send to a given subscription:
//   (a) the subscription's own owner (its household_member_id resolves to
//       the caller's own active household_members row), or
//   (b) an active Parent of the household that owns that subscription's
//       member.
// Anyone else -- an unrelated caller, or a Parent of a *different*
// household -- gets the same generic rejection, and NEVER causes p256dh/auth
// (the subscription's key material) to be read from the database. That
// ordering is the actual security property this file provides, so the code
// below is deliberately sequenced to prove it:
//
//   1. Try to read the target row through the CALLER's OWN RLS-scoped client
//      (never service_role). push_subscriptions' own SELECT policy
//      (push_subscriptions_select_own, from N4.1) already restricts this to
//      the row's own owner -- so if this read succeeds, case (a) is proven
//      by Postgres itself, not by application logic, and we already have
//      endpoint/p256dh/auth in hand. No service_role client is created for
//      this path at all.
//
//   2. Only if that RLS-scoped read comes back empty do we consider case
//      (b). Doing so requires knowing which household the target
//      subscription's member belongs to, which an ordinary member cannot
//      see about someone else's subscription (RLS would block it) -- so this
//      one lookup uses a service_role client, but it selects ONLY
//      household_member_id, never p256dh/auth/endpoint. This is the
//      narrowest possible use of service_role: existence + a foreign key,
//      nothing that could itself be exfiltrated as key material.
//
//   3. From that household_member_id, look up its owning household_id --
//      again via service_role (RLS would otherwise block seeing another
//      member's row), again selecting no key material.
//
//   4. Re-derive the caller's OWN Parent-ness of that household through the
//      caller's OWN RLS-scoped client, exactly like add-household-member
//      does: query household_members for (household_id = target,
//      user_id = caller) and check role = 'parent' AND status = 'active' in
//      application code. This is a real server-side re-derivation of a fact
//      about the CALLER, not trust in anything the request body claims.
//
//   5. Only once that check passes do we make a second service_role read --
//      the first and only place in this file that reads p256dh/auth --
//      fetching the full subscription row so the push can actually be sent.
//
// A caller who is neither the owner nor an active Parent of the right
// household fails at step 1 (empty) and then step 4 (not an active Parent),
// and the request is rejected at that point -- step 5 is simply never
// reached, so p256dh/auth is never read for them. A Parent of a *different*
// household fails step 4 specifically because the household_id looked up in
// step 3 does not match any household_members row for them with role
// 'parent' -- same generic rejection, same "step 5 never reached" property.
//
// Every rejection path returns the same generic message and status, mirroring
// add-household-member's style: this never discloses whether the
// subscription id exists, whether it belongs to the caller's own household,
// or anything else about it.

import { createClient } from "npm:@supabase/supabase-js@2";
import { buildPushPayload } from "npm:@block65/webcrypto-web-push@2";
import type { PushMessage, PushSubscription as WebPushSubscription, VapidKeys } from "npm:@block65/webcrypto-web-push@2";

interface PushTestRequest {
  subscription_id?: unknown;
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// VAPID_PRIVATE_KEY/VAPID_SUBJECT come from N4.2 (supabase/functions/.env,
// not touched by this task). VAPID_PUBLIC_KEY is a NEW name this function
// expects in that same file -- see this task's final report for why: it is
// not secret (VAPID public keys are meant to be public -- it is the same
// value as the frontend's VITE_VAPID_PUBLIC_KEY), but buildPushPayload()
// requires it as an explicit input (it does not derive it from the private
// key), and Vite-prefixed env vars are not available to the Edge Function
// runtime. This file only ever reads key material from Deno.env -- never
// from the request body, and never logs any of these three values.
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY");
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY");
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT");

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, status: number): Response {
  // Deliberately just { error }: no stack traces, no internal exception
  // shapes, no hint about which internal step failed -- matching
  // add-household-member's style.
  return jsonResponse({ error: message }, status);
}

const UNAUTHORIZED_MESSAGE = "not authorized to send a test push for this subscription";

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return errorResponse("method not allowed", 405);
  }

  // --- Parse + validate input up front --------------------------------
  let body: PushTestRequest;
  try {
    body = await req.json();
  } catch {
    return errorResponse("request body must be valid JSON", 400);
  }

  const subscriptionId = body.subscription_id;
  if (typeof subscriptionId !== "string" || subscriptionId.length === 0) {
    return errorResponse("subscription_id is required", 400);
  }

  // --- Identify the caller from their OWN JWT --------------------------
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return errorResponse("missing Authorization header", 401);
  }

  // A client anchored to the caller's own session -- used for
  // auth.getUser(), the owner-read attempt, and the Parent re-derivation
  // read. Never used for anything requiring service_role.
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

  // --- Step 1: try to read the row as its own owner (RLS-scoped) -------
  // If this succeeds, push_subscriptions_select_own has already proven case
  // (a) for us -- no application-level check needed, and no service_role
  // client has been created yet.
  type SubscriptionRow = {
    endpoint: string;
    p256dh: string;
    auth: string;
    household_member_id: string;
  };

  const { data: ownedRow, error: ownedReadError } = await callerClient
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth, household_member_id")
    .eq("id", subscriptionId)
    .maybeSingle<SubscriptionRow>();

  if (ownedReadError) {
    return errorResponse("unable to verify authorization", 500);
  }

  let subscriptionRow: SubscriptionRow | null = ownedRow;

  if (!subscriptionRow) {
    // --- Step 2/3: resolve the target's owning household, without ever
    // reading p256dh/auth. Needs service_role because an ordinary caller
    // cannot see another member's push_subscriptions or household_members
    // rows under RLS -- but neither of these two reads touches key
    // material.
    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: targetSub, error: targetSubError } = await adminClient
      .from("push_subscriptions")
      .select("household_member_id")
      .eq("id", subscriptionId)
      .maybeSingle<{ household_member_id: string }>();

    if (targetSubError) {
      return errorResponse("unable to verify authorization", 500);
    }
    if (!targetSub) {
      // Subscription id does not exist at all -- same generic rejection as
      // "exists but you have no relationship to it", so existence is never
      // disclosed.
      return errorResponse(UNAUTHORIZED_MESSAGE, 403);
    }

    const { data: targetMember, error: targetMemberError } = await adminClient
      .from("household_members")
      .select("household_id")
      .eq("id", targetSub.household_member_id)
      .maybeSingle<{ household_id: string }>();

    if (targetMemberError) {
      return errorResponse("unable to verify authorization", 500);
    }
    if (!targetMember) {
      return errorResponse(UNAUTHORIZED_MESSAGE, 403);
    }

    // --- Step 4: re-derive the CALLER's own Parent-ness of that household,
    // through the caller's OWN RLS-scoped client -- exactly like
    // add-household-member re-derives Parent-ness. Never trusts anything
    // the request claims.
    const { data: callerMembership, error: membershipError } = await callerClient
      .from("household_members")
      .select("role, status")
      .eq("household_id", targetMember.household_id)
      .eq("user_id", caller.id)
      .maybeSingle<{ role: string; status: string }>();

    if (membershipError) {
      return errorResponse("unable to verify authorization", 500);
    }

    const isActiveParent =
      callerMembership?.role === "parent" && callerMembership?.status === "active";

    if (!isActiveParent) {
      // Neither the owner nor an active Parent of the right household --
      // includes "Parent of a different household" as a specific case,
      // since targetMember.household_id will simply not match any of the
      // caller's own household_members rows with role = 'parent'.
      return errorResponse(UNAUTHORIZED_MESSAGE, 403);
    }

    // --- Step 5: authorization confirmed -- ONLY NOW read p256dh/auth,
    // via service_role since the caller still cannot see this row under
    // RLS (it belongs to someone else).
    const { data: fullRow, error: fullReadError } = await adminClient
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth, household_member_id")
      .eq("id", subscriptionId)
      .maybeSingle<SubscriptionRow>();

    if (fullReadError || !fullRow) {
      return errorResponse("unable to send test push", 500);
    }
    subscriptionRow = fullRow;
  }

  // --- Build + send the push ---------------------------------------------
  if (!VAPID_PRIVATE_KEY || !VAPID_PUBLIC_KEY || !VAPID_SUBJECT) {
    // Configuration problem, not an authorization problem -- but still
    // generic, and still never echoes any of the values themselves.
    console.error("push-test: VAPID configuration is incomplete in this environment");
    return errorResponse("push is not configured in this environment", 500);
  }

  const message: PushMessage = {
    data: {
      title: "Family Ledger test",
      body: "If you see this, push delivery works.",
    },
    options: { ttl: 60 },
  };

  const pushSubscription: WebPushSubscription = {
    endpoint: subscriptionRow.endpoint,
    expirationTime: null,
    keys: {
      auth: subscriptionRow.auth,
      p256dh: subscriptionRow.p256dh,
    },
  };

  const vapid: VapidKeys = {
    subject: VAPID_SUBJECT,
    publicKey: VAPID_PUBLIC_KEY,
    privateKey: VAPID_PRIVATE_KEY,
  };

  let payload: Awaited<ReturnType<typeof buildPushPayload>>;
  try {
    payload = await buildPushPayload(message, pushSubscription, vapid);
  } catch (err) {
    // Never log key material -- only the fact that building the payload
    // failed and, for local debugging, the error's own message (which
    // describes malformed input shape, not secret values).
    console.error(
      `push-test: failed to build push payload: ${err instanceof Error ? err.message : String(err)}`,
    );
    return errorResponse("unable to build push payload", 500);
  }

  try {
    const res = await fetch(pushSubscription.endpoint, payload);
    return jsonResponse({ status: res.status, ok: res.ok }, 200);
  } catch (err) {
    // The endpoint was unreachable / not a real push service / otherwise
    // failed before any HTTP response came back at all. Surface this as a
    // clearly-failed, non-2xx-shaped result rather than letting the
    // exception become an unhandled 500 -- this function's whole job is to
    // make delivery failure observable, not to hide it behind a crash.
    console.error(
      `push-test: fetch to push endpoint failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return jsonResponse(
      { status: 0, ok: false, error: "failed to reach push endpoint" },
      200,
    );
  }
});
