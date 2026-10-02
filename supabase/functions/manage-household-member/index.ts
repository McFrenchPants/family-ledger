// Family Ledger: manage-household-member Edge Function (account management).
//
// One POST endpoint, JSON body { action, ... }, for the member operations that
// need the Supabase Auth Admin API (service_role) and therefore cannot run in
// the browser:
//
//   create_link      { member_id }            one-time set-password link
//   change_email     { member_id, email }     change a member's login email
//   archive          { member_id }            archive + disable login
//   restore          { member_id }            restore + re-enable login
//   get_login_emails { household_id }         member id -> login email map
//
// Same two-boundary pattern as add-household-member:
//   1. The CALLER'S OWN JWT identifies the caller (auth.getUser) and is used
//      for every authorization read and for the SQL function
//      set_household_member_status(), which re-derives Parent-ness from
//      auth.uid() itself.
//   2. service_role is used ONLY for Auth Admin API calls and the audit_log
//      insert (audit_log is not writable by app roles).
//
// Authorization: the TARGET member row is read through the caller's
// RLS-scoped client, then the caller's OWN membership row in that member's
// household must be active + parent. A missing target, a target in another
// household, a non-Parent and an archived caller all get the identical generic
// 403 -- nothing discloses whether a member exists.
//
// Audit payloads (audit_log is readable only by Parents of the household):
//   set_password_link_created  new_values {}                (no token, no email)
//   login_email_changed        old_values {email}, new_values {email}
//   archived / restored        written by the household_members trigger
//
// Duplicate-email pre-check: the Admin updateUserById returns a bare 500 on a
// duplicate, so we scan the Admin listUsers pages (case-insensitive compare).
// That is O(users) but this is a household-scale app (a handful of logins);
// the scan is capped and fails closed beyond the cap.

import {
  errorResponse,
  getAppBaseUrl,
  isActiveParentOf,
  jsonResponse,
  LINK_ACTION,
  LINK_EXPIRY_HOURS,
  makeAdminClient,
  makeCallerClient,
  mintSetPasswordLink,
  preflightResponse,
  recordLinkCreated,
  UUID_RE,
} from "../_shared/member-admin.ts";

const MAX_LINKS_PER_HOUR = 20;
const BAN_FOREVER = "876000h";
const MAX_EMAIL_LENGTH = 254;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LIST_PAGE_SIZE = 1000;
const LIST_MAX_PAGES = 20;
const EMAIL_LOOKUP_MAX_MEMBERS = 100;
const EMAIL_LOOKUP_BATCH = 10;

const FORBIDDEN = "only an active Parent of this member's household may do this";
const RETRY = "something went wrong, please try again";

interface TargetMember {
  id: string;
  household_id: string;
  user_id: string | null;
  role: string;
  status: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return preflightResponse();
  if (req.method !== "POST") return errorResponse("method not allowed", 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return errorResponse("missing Authorization header", 401);

  let body: Record<string, unknown>;
  try {
    const parsed = await req.json();
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return errorResponse("request body must be a JSON object", 400);
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return errorResponse("request body must be valid JSON", 400);
  }

  const callerClient = makeCallerClient(authHeader);
  const {
    data: { user: caller },
    error: getUserError,
  } = await callerClient.auth.getUser();
  if (getUserError || !caller) return errorResponse("invalid or expired session", 401);

  const action = body.action;

  try {
    // --- get_login_emails: authorised by household, not by a member -------
    if (action === "get_login_emails") {
      const householdId = body.household_id;
      if (typeof householdId !== "string" || !UUID_RE.test(householdId)) {
        return errorResponse("household_id is required", 400);
      }
      const ok = await isActiveParentOf(callerClient, caller.id, householdId);
      if (ok === "error") return errorResponse("unable to verify authorization", 500);
      if (!ok) return errorResponse(FORBIDDEN, 403);
      return await getLoginEmails(callerClient, householdId);
    }

    if (
      action !== "create_link" &&
      action !== "change_email" &&
      action !== "archive" &&
      action !== "restore"
    ) {
      return errorResponse("unknown action", 400);
    }

    const memberId = body.member_id;
    if (typeof memberId !== "string" || !UUID_RE.test(memberId)) {
      return errorResponse("member_id is required", 400);
    }

    // --- Target + caller authorization (identical 403 for every failure) --
    const { data: target, error: targetError } = await callerClient
      .from("household_members")
      .select("id, household_id, user_id, role, status")
      .eq("id", memberId)
      .maybeSingle();
    if (targetError) return errorResponse("unable to verify authorization", 500);
    if (!target) return errorResponse(FORBIDDEN, 403);

    const ok = await isActiveParentOf(callerClient, caller.id, target.household_id);
    if (ok === "error") return errorResponse("unable to verify authorization", 500);
    if (!ok) return errorResponse(FORBIDDEN, 403);

    const member = target as TargetMember;
    switch (action) {
      case "create_link":
        return await createLink(member, caller.id);
      case "change_email":
        return await changeEmail(member, caller.id, body.email);
      default:
        return await setStatus(callerClient, member, action);
    }
  } catch (err) {
    // Never echo internal detail to the client.
    console.error(
      `manage-household-member: unexpected failure (${(err as Error)?.name ?? "unknown"})`,
    );
    return errorResponse(RETRY, 500);
  }
});

// ---------------------------------------------------------------------------

async function createLink(member: TargetMember, callerId: string): Promise<Response> {
  const appBaseUrl = getAppBaseUrl();
  if (!appBaseUrl) {
    console.error(
      "manage-household-member: APP_BASE_URL is not set or invalid; refusing to mint links",
    );
    return errorResponse("link creation is not configured", 500);
  }
  if (!member.user_id || (member.status !== "active" && member.status !== "invited")) {
    return errorResponse(
      "a set-password link can only be created for an active member with a login",
      400,
    );
  }

  const admin = makeAdminClient();

  // Rate limit: count this caller's recent link audit rows (no extra table).
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error: countError } = await admin
    .from("audit_log")
    .select("id", { count: "exact", head: true })
    .eq("actor_user_id", callerId)
    .eq("action", LINK_ACTION)
    .gte("created_at", since);
  if (countError || count === null) return errorResponse(RETRY, 500);
  if (count >= MAX_LINKS_PER_HOUR) {
    return errorResponse("too many links created recently; please try again later", 429);
  }

  const { data: userData, error: userError } = await admin.auth.admin.getUserById(member.user_id);
  const email = userData?.user?.email;
  if (userError || !email) return errorResponse("unable to create the link", 400);

  const url = await mintSetPasswordLink(admin, email, appBaseUrl);
  if (!url) return errorResponse("unable to create the link", 502);

  // If the audit row cannot be written the link is NOT handed out (nobody has
  // seen it; the next one minted cancels it).
  const audited = await recordLinkCreated(admin, {
    householdId: member.household_id,
    actorId: callerId,
    memberId: member.id,
  });
  if (!audited) return errorResponse(RETRY, 500);

  return jsonResponse({ url, expires_in_hours: LINK_EXPIRY_HOURS }, 200);
}

// ---------------------------------------------------------------------------

async function changeEmail(
  member: TargetMember,
  callerId: string,
  rawEmail: unknown,
): Promise<Response> {
  if (typeof rawEmail !== "string") return errorResponse("email is required", 400);
  const email = rawEmail.trim().toLowerCase();
  if (email.length === 0 || email.length > MAX_EMAIL_LENGTH || !EMAIL_RE.test(email)) {
    return errorResponse("please enter a valid email address", 400);
  }
  if (!member.user_id) return errorResponse("this member has no login to change", 400);

  const CANT_USE = "that email can't be used";
  const admin = makeAdminClient();

  const { data: current, error: currentError } = await admin.auth.admin.getUserById(
    member.user_id,
  );
  const oldEmail = current?.user?.email;
  if (currentError || !oldEmail) return errorResponse(CANT_USE, 400);
  if (oldEmail.toLowerCase() === email) {
    return errorResponse("that is already this person's login email", 400);
  }

  // Duplicate pre-check (case-insensitive) -- see header comment.
  for (let page = 1; page <= LIST_MAX_PAGES; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: LIST_PAGE_SIZE });
    if (error) return errorResponse(CANT_USE, 400);
    const users = data?.users ?? [];
    if (users.some((u) => u.id !== member.user_id && u.email?.toLowerCase() === email)) {
      return errorResponse(CANT_USE, 400);
    }
    if (users.length < LIST_PAGE_SIZE) break;
    if (page === LIST_MAX_PAGES) return errorResponse(CANT_USE, 400); // fail closed
  }

  const { error: updateError } = await admin.auth.admin.updateUserById(member.user_id, {
    email,
    email_confirm: true,
  });
  if (updateError) {
    console.error(
      `manage-household-member: email update failed (status ${updateError.status ?? "none"})`,
    );
    return errorResponse(CANT_USE, 400);
  }

  const { error: auditError } = await admin.from("audit_log").insert({
    household_id: member.household_id,
    actor_user_id: callerId,
    entity_type: "household_members",
    entity_id: member.id,
    action: "login_email_changed",
    old_values: { email: oldEmail },
    new_values: { email },
  });
  if (auditError) {
    // Every email change must be audited: undo it rather than leave a gap.
    console.error(
      `manage-household-member: audit insert failed (code ${auditError.code ?? "none"}); reverting email`,
    );
    const { error: revertError } = await admin.auth.admin.updateUserById(member.user_id, {
      email: oldEmail,
      email_confirm: true,
    });
    if (revertError) {
      console.error(`manage-household-member: email revert FAILED, member ${member.id}`);
    }
    return errorResponse(RETRY, 500);
  }

  return jsonResponse({ email }, 200);
}

// ---------------------------------------------------------------------------

async function setStatus(
  // deno-lint-ignore no-explicit-any
  callerClient: any,
  member: TargetMember,
  action: "archive" | "restore",
): Promise<Response> {
  const target = action === "archive" ? "archived" : "active";
  const opposite = action === "archive" ? "active" : "archived";
  const admin = makeAdminClient();

  const applyLogin = () =>
    admin.auth.admin.updateUserById(member.user_id!, {
      ban_duration: action === "archive" ? BAN_FOREVER : "none",
    });

  // Already in the requested state: a previous attempt may have left the login
  // out of step (status changed, ban call failed AND compensation failed).
  // Re-apply the login state so the Parent can repair by simply retrying.
  if (member.status === target) {
    if (member.user_id) {
      const { error } = await applyLogin();
      if (error) return errorResponse("could not update the login, please try again", 502);
    }
    return jsonResponse({ id: member.id, status: target }, 200);
  }

  const { error: rpcError } = await callerClient.rpc("set_household_member_status", {
    p_member_id: member.id,
    p_new_status: target,
  });
  if (rpcError) {
    const message: string = rpcError.message ?? "";
    if (/only active Parent/i.test(message)) {
      return errorResponse(
        "the household's only active Parent can't be archived; make another person a Parent first",
        409,
      );
    }
    if (rpcError.code === "23514") {
      return errorResponse(
        action === "archive"
          ? "this member can't be archived in their current state"
          : "only an archived member can be restored",
        409,
      );
    }
    if (rpcError.code === "42501") return errorResponse(FORBIDDEN, 403);
    console.error(
      `manage-household-member: status change failed (code ${rpcError.code ?? "none"})`,
    );
    return errorResponse(RETRY, 500);
  }

  if (member.user_id) {
    const { error: adminError } = await applyLogin();
    if (adminError) {
      // Never report a half-archived / half-restored state as success: put the
      // status back, as the caller, through the same checked function.
      console.error(
        `manage-household-member: ${action} login update failed; compensating, member ${member.id}`,
      );
      const { error: compError } = await callerClient.rpc("set_household_member_status", {
        p_member_id: member.id,
        p_new_status: opposite,
      });
      if (compError) {
        console.error(
          `manage-household-member: COMPENSATION FAILED, member ${member.id} needs attention`,
        );
      }
      return errorResponse("could not update the login, nothing was changed; please try again", 502);
    }
  }

  return jsonResponse({ id: member.id, status: target }, 200);
}

// ---------------------------------------------------------------------------

async function getLoginEmails(
  // deno-lint-ignore no-explicit-any
  callerClient: any,
  householdId: string,
): Promise<Response> {
  const { data: members, error } = await callerClient
    .from("household_members")
    .select("id, user_id")
    .eq("household_id", householdId)
    .not("user_id", "is", null)
    .limit(EMAIL_LOOKUP_MAX_MEMBERS);
  if (error) return errorResponse(RETRY, 500);

  const admin = makeAdminClient();
  const emails: Record<string, string | null> = {};
  const rows = (members ?? []) as { id: string; user_id: string }[];
  for (let i = 0; i < rows.length; i += EMAIL_LOOKUP_BATCH) {
    const batch = rows.slice(i, i + EMAIL_LOOKUP_BATCH);
    await Promise.all(
      batch.map(async (m) => {
        const { data, error: e } = await admin.auth.admin.getUserById(m.user_id);
        emails[m.id] = e ? null : (data?.user?.email ?? null);
      }),
    );
  }
  return jsonResponse({ emails }, 200);
}
