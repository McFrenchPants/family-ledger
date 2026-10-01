// Family Ledger: end-to-end smoke test for the member-management Edge Functions
// (manage-household-member and add-household-member), over real HTTP, against
// the LOCAL Supabase stack only.
//
// Prerequisites (all local):
//   * `npx supabase start` is running (Docker).
//   * `npx supabase functions serve` is running, with APP_BASE_URL set in
//     supabase/functions/.env (default https://localhost:5173).
//   * Docker is available (used once, to install a temporary trigger that makes
//     the identity provider's "ban" write fail, to prove archive/restore never
//     report a half-done state).
//
// Run:  node scripts/smoke-manage-member.mjs
// Optional env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
// (otherwise read from `npx supabase status -o json`), APP_BASE_URL,
// SERVE_LOG (path to the functions-serve output: if set, the script also checks
// that no link token or email address was written to it).
//
// It creates a throwaway household A (two Parents + a Child + a member with no
// login), a second household B with its own Parent, all using @example.test
// emails, and removes EVERYTHING it created afterwards -- including the audit
// rows it caused. Pre-existing local data is never touched. Prints PASS/FAIL per
// check and exits non-zero if any check fails.

import { execFileSync, execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

// --- Config ---------------------------------------------------------------

function loadConfig() {
  let { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    const status = JSON.parse(execSync("npx supabase status -o json", { encoding: "utf8" }));
    SUPABASE_URL ||= status.API_URL;
    SUPABASE_ANON_KEY ||= status.ANON_KEY;
    SUPABASE_SERVICE_ROLE_KEY ||= status.SERVICE_ROLE_KEY;
  }
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(SUPABASE_URL)) {
    throw new Error(`Refusing to run against a non-local URL: ${SUPABASE_URL}`);
  }
  return { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY };
}

const { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY } = loadConfig();
const APP_BASE_URL = (process.env.APP_BASE_URL ?? "https://localhost:5173").replace(/\/+$/, "");
const FN = `${SUPABASE_URL}/functions/v1`;
const DB_CONTAINER = "supabase_db_family-ledger";

const plain = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, plain);
const anon = () => createClient(SUPABASE_URL, SUPABASE_ANON_KEY, plain);

const RUN = randomBytes(4).toString("hex");
const email = (tag) => `smoke-${tag}-${RUN}@example.test`;
const PW = "Smoke-Pass-1111";

// --- Tiny test harness ------------------------------------------------------

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  -- ${detail}` : ""}`);
}
const short = (v) => JSON.stringify(v)?.slice(0, 200);

async function call(fnName, token, body, { method = "POST", raw } = {}) {
  const headers = { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${FN}/${fnName}`, {
    method,
    headers,
    body: method === "POST" ? (raw ?? JSON.stringify(body)) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON */
  }
  return { status: res.status, json, text, headers: res.headers };
}
const manage = (token, body, opts) => call("manage-household-member", token, body, opts);

async function signIn(emailAddr, password = PW) {
  const c = anon();
  const { data, error } = await c.auth.signInWithPassword({ email: emailAddr, password });
  return { token: data?.session?.access_token ?? null, error };
}

function psql(sql) {
  return execFileSync("docker", ["exec", DB_CONTAINER, "psql", "-U", "postgres", "-q", "-v", "ON_ERROR_STOP=1", "-c", sql], {
    encoding: "utf8",
  });
}
const BLOCK_BAN_SQL = `
create or replace function public.zz_smoke_block_ban() returns trigger language plpgsql as $$
begin
  if new.banned_until is distinct from old.banned_until then raise exception 'smoke: ban blocked'; end if;
  return new;
end $$;
drop trigger if exists zz_smoke_block_ban on auth.users;
create trigger zz_smoke_block_ban before update on auth.users for each row execute function public.zz_smoke_block_ban();`;
const UNBLOCK_BAN_SQL = `
drop trigger if exists zz_smoke_block_ban on auth.users;
drop function if exists public.zz_smoke_block_ban();`;

/** Parse a returned set-password URL and exchange it like the app page would. */
async function consumeLink(url, newPassword) {
  const u = new URL(url);
  const frag = new URLSearchParams(u.hash.slice(1));
  const tokenHash = frag.get("token_hash");
  const c = anon();
  const { data, error } = await c.auth.verifyOtp({ token_hash: tokenHash, type: frag.get("type") });
  if (error || !data?.session) return { ok: false, error, tokenHash };
  const { error: upErr } = await c.auth.updateUser({ password: newPassword });
  return { ok: !upErr, error: upErr, tokenHash };
}
const tokenOf = (url) => new URLSearchParams(new URL(url).hash.slice(1)).get("token_hash");

// --- Bookkeeping for cleanup --------------------------------------------------

const createdUserIds = [];
const householdIds = [];
const issuedTokens = [];
const usedEmails = [];
let usersBefore = null;

async function listAllUsers() {
  const out = [];
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    out.push(...data.users);
    if (data.users.length < 1000) break;
  }
  return out;
}

async function mkUser(tag) {
  const e = email(tag);
  usedEmails.push(e);
  const { data, error } = await admin.auth.admin.createUser({ email: e, password: PW, email_confirm: true });
  if (error) throw new Error(`createUser ${tag}: ${error.message}`);
  createdUserIds.push(data.user.id);
  return { id: data.user.id, email: e };
}
async function mkHousehold(name) {
  const { data, error } = await admin.from("households").insert({ name: `smoke-${name}-${RUN}`, timezone: "America/Toronto" }).select().single();
  if (error) throw new Error(`household ${name}: ${error.message}`);
  householdIds.push(data.id);
  return data.id;
}
async function mkMember(householdId, userId, name, role, status = "active") {
  const { data, error } = await admin.from("household_members").insert({ household_id: householdId, user_id: userId, name, role, status }).select().single();
  if (error) throw new Error(`member ${name}: ${error.message}`);
  return data.id;
}
const memberStatus = async (id) => (await admin.from("household_members").select("status").eq("id", id).single()).data?.status;
const auditRows = async (entityId, action) =>
  (await admin.from("audit_log").select("*").eq("entity_id", entityId).eq("action", action)).data ?? [];

async function cleanup() {
  const problems = [];
  try {
    psql(UNBLOCK_BAN_SQL);
  } catch {
    /* docker may be unavailable; nothing to drop then */
  }
  // Leftovers from a crashed earlier run are matched by the "smoke-" prefix + @example.test.
  const { data: oldHouseholds } = await admin.from("households").select("id").like("name", "smoke-%");
  const hIds = new Set([...householdIds, ...(oldHouseholds ?? []).map((h) => h.id)]);
  for (const id of hIds) {
    // audit_log, members and the rest cascade from the household.
    const { error } = await admin.from("households").delete().eq("id", id);
    if (error) problems.push(`household ${id}: ${error.message}`);
  }
  const users = await listAllUsers();
  const toDelete = new Set([...createdUserIds, ...users.filter((u) => /^smoke-.*@example\.test$/.test(u.email ?? "")).map((u) => u.id)]);
  for (const id of toDelete) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) problems.push(`user ${id}: ${error.message}`);
  }
  return problems;
}

// --- The tests ----------------------------------------------------------------

async function main() {
  try {
    psql(UNBLOCK_BAN_SQL); // make sure no stale trigger from a crashed run
  } catch (e) {
    throw new Error(`docker/psql is required for the ban-failure test: ${e.message}`);
  }
  await cleanup(); // clear any leftovers from a crashed earlier run
  usersBefore = (await listAllUsers()).length;
  console.log(`Local auth users before: ${usersBefore}\n`);

  // Setup: household A (Parent A1) and household B (Parent B).
  const pa1 = await mkUser("pa1");
  const pb = await mkUser("pb");
  const hhA = await mkHousehold("A");
  const hhB = await mkHousehold("B");
  const pa1Member = await mkMember(hhA, pa1.id, "Parent A1", "parent");
  const pbMember = await mkMember(hhB, pb.id, "Parent B", "parent");
  const noLoginMember = await mkMember(hhA, null, "No Login", "child");

  const pa1s = await signIn(pa1.email);
  const pbs = await signIn(pb.email);
  check("setup: Parent A1 and Parent B can sign in", pa1s.token && pbs.token);

  // ---- add-household-member (AM4) ------------------------------------------
  console.log("\n-- add-household-member --");
  const childEmail = email("child");
  const pa2Email = email("pa2");
  usedEmails.push(childEmail, pa2Email);

  const addChild = await call("add-household-member", pa1s.token, { household_id: hhA, name: "Kid", role: "child", email: childEmail });
  check("add member (child): 201", addChild.status === 201, short(addChild));
  const keys = Object.keys(addChild.json ?? {}).sort();
  check("add member: response has set_password_url, expires_in_hours 24, id, user_id",
    addChild.json?.expires_in_hours === 24 && typeof addChild.json?.set_password_url === "string" && addChild.json?.id && addChild.json?.user_id, short(addChild.json));
  check("add member: NO initial_password key and no other password-like key", !keys.some((k) => /password/i.test(k) && k !== "set_password_url") && !("initial_password" in (addChild.json ?? {})), keys.join(","));
  check("add member: no action_link / email_otp / hashed_token leaked", !/action_link|email_otp|hashed_token|\/auth\/v1\/verify/.test(addChild.text));
  const childUrl = addChild.json?.set_password_url;
  check("add member: url is APP_BASE_URL/set-password#token_hash=... (fragment, no query string)",
    childUrl?.startsWith(`${APP_BASE_URL}/set-password#token_hash=`) && !childUrl.includes("?"), childUrl && childUrl.slice(0, 60));
  issuedTokens.push(tokenOf(childUrl));
  const childUserId = addChild.json?.user_id;
  createdUserIds.push(childUserId);
  const childMember = addChild.json?.id;
  const used = await consumeLink(childUrl, PW);
  check("add member: returned link works (verifyOtp then updateUser)", used.ok, short(used.error));
  const childSignIn = await signIn(childEmail);
  check("add member: new member signs in with the password they chose", !!childSignIn.token);
  const reuse = await consumeLink(childUrl, "Another-Pass-2222");
  check("add member: link is single use (second exchange rejected)", !reuse.ok);
  check("add member: audit row set_password_link_created, empty new_values, no token/email",
    await (async () => {
      const rows = await auditRows(childMember, "set_password_link_created");
      const s = JSON.stringify(rows);
      return rows.length === 1 && rows[0].actor_user_id === pa1.id && rows[0].household_id === hhA &&
        JSON.stringify(rows[0].new_values) === "{}" && rows[0].old_values === null &&
        !s.includes(tokenOf(childUrl)) && !s.includes(childEmail);
    })());

  const addParent2 = await call("add-household-member", pa1s.token, { household_id: hhA, name: "Parent A2", role: "parent", email: pa2Email });
  check("add member (second Parent): 201 with link", addParent2.status === 201 && !!addParent2.json?.set_password_url, short(addParent2));
  issuedTokens.push(tokenOf(addParent2.json.set_password_url));
  createdUserIds.push(addParent2.json.user_id);
  const pa2Member = addParent2.json.id;
  const pa2Used = await consumeLink(addParent2.json.set_password_url, PW);
  check("add member (second Parent): link works", pa2Used.ok);

  const addDup = await call("add-household-member", pa1s.token, { household_id: hhA, name: "Dup", role: "child", email: childEmail });
  check("add member: duplicate email -> 400, nothing leaked", addDup.status === 400 && !("set_password_url" in (addDup.json ?? {})), short(addDup));
  const addAsChild = await call("add-household-member", childSignIn.token, { household_id: hhA, name: "X", role: "child", email: email("x") });
  check("add member as Child -> 403", addAsChild.status === 403, short(addAsChild));

  const pa2s = await signIn(pa2Email);
  const childs = childSignIn;

  // ---- create_link ----------------------------------------------------------
  console.log("\n-- create_link --");
  const l1 = await manage(pa1s.token, { action: "create_link", member_id: childMember });
  check("create_link as Parent: 200 { url, expires_in_hours: 24 } only", l1.status === 200 && l1.json?.expires_in_hours === 24 && Object.keys(l1.json).sort().join() === "expires_in_hours,url", short(l1));
  check("create_link: url shape (own page, fragment token, type=recovery)", l1.json?.url?.startsWith(`${APP_BASE_URL}/set-password#token_hash=`) && l1.json.url.endsWith("&type=recovery") && !l1.json.url.includes("?"));
  check("create_link: no action_link / email_otp anywhere in response", !/action_link|email_otp|\/auth\/v1\/verify/.test(l1.text));
  issuedTokens.push(tokenOf(l1.json.url));
  const l2 = await manage(pa1s.token, { action: "create_link", member_id: childMember });
  issuedTokens.push(tokenOf(l2.json.url));
  const oldLinkTry = await consumeLink(l1.json.url, "Zzz-Pass-3333");
  check("create_link: a newer link cancels the older one", !oldLinkTry.ok);
  const NEWPW = "Brand-New-Pass-4444";
  const newLinkTry = await consumeLink(l2.json.url, NEWPW);
  check("create_link: newest link works and sets the password", newLinkTry.ok, short(newLinkTry.error));
  check("create_link: new password signs in; previous password no longer does", !!(await signIn(childEmail, NEWPW)).token && !(await signIn(childEmail, PW)).token);
  const linkAudit = await auditRows(childMember, "set_password_link_created");
  check("create_link: audit rows exist, actor = caller, no token/email in payload",
    linkAudit.length === 3 && linkAudit.every((r) => r.actor_user_id === pa1.id && JSON.stringify(r.new_values) === "{}" && !JSON.stringify(r).includes(childEmail) && !JSON.stringify(r).includes(tokenOf(l2.json.url))));
  const lp = await manage(pa1s.token, { action: "create_link", member_id: pa2Member });
  check("create_link: Parent can create a link for another Parent", lp.status === 200, short(lp));
  if (lp.json?.url) issuedTokens.push(tokenOf(lp.json.url));
  const lnl = await manage(pa1s.token, { action: "create_link", member_id: noLoginMember });
  check("create_link: member with no login -> 400", lnl.status === 400, short(lnl));

  // ---- Authorization: Child, other household, nonexistent, unauthenticated ---
  console.log("\n-- authorization --");
  const ghost = "00000000-0000-4000-8000-000000000000";
  const fresh = (await signIn(childEmail, NEWPW)).token;
  for (const [label, body] of [
    ["create_link", { action: "create_link", member_id: pa1Member }],
    ["create_link (self)", { action: "create_link", member_id: childMember }],
    ["change_email", { action: "change_email", member_id: childMember, email: email("nope") }],
    ["archive", { action: "archive", member_id: pa2Member }],
    ["restore", { action: "restore", member_id: childMember }],
    ["get_login_emails", { action: "get_login_emails", household_id: hhA }],
  ]) {
    const r = await manage(fresh, body);
    check(`Child -> ${label}: 403`, r.status === 403, short(r));
  }
  const nonexistent = await manage(pa1s.token, { action: "create_link", member_id: ghost });
  const otherHh = await manage(pbs.token, { action: "create_link", member_id: childMember });
  const childAct = await manage(fresh, { action: "create_link", member_id: pa1Member });
  check("nonexistent member -> 403", nonexistent.status === 403, short(nonexistent));
  check("other-household Parent -> 403 with body identical to nonexistent member", otherHh.status === 403 && otherHh.text === nonexistent.text, `${otherHh.text} vs ${nonexistent.text}`);
  check("Child -> 403 with the same body too (no existence disclosure)", childAct.text === nonexistent.text);
  for (const body of [
    { action: "change_email", member_id: childMember, email: email("evil") },
    { action: "archive", member_id: childMember },
    { action: "restore", member_id: childMember },
  ]) {
    const r = await manage(pbs.token, body);
    check(`other-household Parent -> ${body.action}: 403, same body`, r.status === 403 && r.text === nonexistent.text, short(r));
  }
  check("other-household Parent had no effect (child still active, email unchanged)",
    (await memberStatus(childMember)) === "active" && (await signIn(childEmail, NEWPW)).token !== null);
  const geB = await manage(pbs.token, { action: "get_login_emails", household_id: hhA });
  check("get_login_emails for another household -> 403 same body", geB.status === 403 && geB.text === nonexistent.text, short(geB));

  // Archived-but-not-banned caller (status flipped directly, as an admin would) gets the same 403.
  await admin.from("household_members").update({ status: "archived", archived_at: new Date().toISOString() }).eq("id", pa2Member);
  const archivedCaller = await manage(pa2s.token, { action: "create_link", member_id: childMember });
  check("archived Parent caller -> 403 with the same generic body", archivedCaller.status === 403 && archivedCaller.text === nonexistent.text, short(archivedCaller));
  await admin.from("household_members").update({ status: "active", archived_at: null }).eq("id", pa2Member);

  const noAuth = await manage(null, { action: "create_link", member_id: childMember });
  check("no Authorization header -> 401", noAuth.status === 401, short(noAuth));
  const anonAsUser = await manage(SUPABASE_ANON_KEY, { action: "create_link", member_id: childMember });
  check("anon key as bearer (not a user session) -> 401", anonAsUser.status === 401, short(anonAsUser));
  const junk = await manage("not-a-jwt", { action: "create_link", member_id: childMember });
  check("garbage bearer token -> 401", junk.status === 401, short(junk));

  // ---- Bad input -------------------------------------------------------------
  console.log("\n-- bad input --");
  const get = await manage(pa1s.token, null, { method: "GET" });
  check("GET -> 405", get.status === 405, String(get.status));
  const badJson = await manage(pa1s.token, null, { raw: "{not json" });
  check("invalid JSON -> 400", badJson.status === 400, short(badJson));
  const arrayBody = await manage(pa1s.token, null, { raw: "[1,2]" });
  check("JSON array body -> 400", arrayBody.status === 400);
  check("unknown action -> 400", (await manage(pa1s.token, { action: "delete_everything", member_id: childMember })).status === 400);
  check("missing member_id -> 400", (await manage(pa1s.token, { action: "archive" })).status === 400);
  check("member_id not a uuid -> 400", (await manage(pa1s.token, { action: "archive", member_id: "abc'; drop" })).status === 400);
  check("get_login_emails without household_id -> 400", (await manage(pa1s.token, { action: "get_login_emails" })).status === 400);
  for (const [label, value] of [["missing", undefined], ["not an email", "plainaddress"], ["too long", `${"a".repeat(250)}@example.test`], ["not a string", 42]]) {
    const r = await manage(pa1s.token, { action: "change_email", member_id: childMember, email: value });
    check(`change_email ${label} -> 400`, r.status === 400, short(r));
  }
  const preflight = await call("manage-household-member", null, null, { method: "OPTIONS" });
  // Locally the API gateway (Kong) answers preflights itself with "*"; on the
  // hosted platform the request reaches the function, which answers with the
  // APP_BASE_URL origin. Either is acceptable here.
  const acao = preflight.headers.get("access-control-allow-origin");
  check("OPTIONS preflight -> 204 with a matching Allow-Origin",
    preflight.status === 204 && (acao === "*" || acao === new URL(APP_BASE_URL).origin), `${preflight.status} ${acao}`);

  // ---- change_email -----------------------------------------------------------
  console.log("\n-- change_email --");
  const newEmailRaw = `  New-${RUN}@Example.TEST `;
  const newEmail = newEmailRaw.trim().toLowerCase();
  usedEmails.push(newEmail);
  const same = await manage(pa1s.token, { action: "change_email", member_id: childMember, email: childEmail.toUpperCase() });
  check("change_email to the same address (any case) -> 400", same.status === 400, short(same));
  const dup = await manage(pa1s.token, { action: "change_email", member_id: childMember, email: pb.email.toUpperCase() });
  check("change_email to another user's address (different case) -> 400 friendly, not 500", dup.status === 400 && /can't be used/.test(dup.json?.error ?? ""), short(dup));
  const dup2 = await manage(pa1s.token, { action: "change_email", member_id: childMember, email: pa1.email });
  check("change_email to a Parent's address -> 400 friendly", dup2.status === 400 && dup.text === dup2.text, short(dup2));
  const ce = await manage(pa1s.token, { action: "change_email", member_id: childMember, email: newEmailRaw });
  check("change_email: 200 with normalized (trimmed, lower-case) address", ce.status === 200 && ce.json?.email === newEmail, short(ce));
  check("change_email: old address can no longer sign in", !(await signIn(childEmail, NEWPW)).token);
  check("change_email: new address signs in with the same password", !!(await signIn(newEmail, NEWPW)).token);
  const ceAudit = await auditRows(childMember, "login_email_changed");
  check("change_email: audit row has old and new email, actor = caller",
    ceAudit.length === 1 && ceAudit[0].old_values?.email === childEmail && ceAudit[0].new_values?.email === newEmail && ceAudit[0].actor_user_id === pa1.id, short(ceAudit));
  const ceNoLogin = await manage(pa1s.token, { action: "change_email", member_id: noLoginMember, email: email("zz") });
  check("change_email: member with no login -> 400", ceNoLogin.status === 400, short(ceNoLogin));

  // ---- get_login_emails ------------------------------------------------------
  console.log("\n-- get_login_emails --");
  const ge = await manage(pa1s.token, { action: "get_login_emails", household_id: hhA });
  const emails = ge.json?.emails ?? {};
  check("get_login_emails: map of exactly the household's members with logins",
    ge.status === 200 && Object.keys(emails).sort().join() === [pa1Member, pa2Member, childMember].sort().join() &&
    emails[pa1Member] === pa1.email && emails[childMember] === newEmail && emails[pa2Member] === pa2Email, short(ge));
  check("get_login_emails: nothing from household B and no null-login member", !(pbMember in emails) && !(noLoginMember in emails) && !ge.text.includes(pb.email));
  const geOwnB = await manage(pbs.token, { action: "get_login_emails", household_id: hhB });
  check("get_login_emails: Parent B sees only household B", geOwnB.status === 200 && Object.keys(geOwnB.json.emails).join() === pbMember && !geOwnB.text.includes(pa1.email));

  // ---- archive / restore ------------------------------------------------------
  console.log("\n-- archive / restore --");
  const childToken = (await signIn(newEmail, NEWPW)).token;
  const ar = await manage(pa1s.token, { action: "archive", member_id: childMember });
  check("archive Child: 200 status archived", ar.status === 200 && ar.json?.status === "archived", short(ar));
  check("archive: DB status archived + audit row 'archived'", (await memberStatus(childMember)) === "archived" && (await auditRows(childMember, "archived")).length === 1);
  const blocked = await signIn(newEmail, NEWPW);
  check("archive: member can no longer sign in (user_banned)", !blocked.token && blocked.error?.code === "user_banned", short(blocked.error?.code));
  check("archive: member's already-open token can't pass the function's session check", (await manage(childToken, { action: "create_link", member_id: pa1Member })).status !== 200);
  const arAgain = await manage(pa1s.token, { action: "archive", member_id: childMember });
  check("archive again is idempotent (200, ban re-applied)", arAgain.status === 200 && arAgain.json?.status === "archived", short(arAgain));
  const linkArchived = await manage(pa1s.token, { action: "create_link", member_id: childMember });
  check("create_link for an archived member -> 400", linkArchived.status === 400, short(linkArchived));
  const rs = await manage(pa1s.token, { action: "restore", member_id: childMember });
  check("restore: 200 status active", rs.status === 200 && rs.json?.status === "active", short(rs));
  check("restore: DB status active + audit row 'restored'", (await memberStatus(childMember)) === "active" && (await auditRows(childMember, "restored")).length === 1);
  check("restore: member can sign in again", !!(await signIn(newEmail, NEWPW)).token);

  // Member with no login: archive/restore work without any admin call.
  const arNl = await manage(pa1s.token, { action: "archive", member_id: noLoginMember });
  const rsNl = await manage(pa1s.token, { action: "restore", member_id: noLoginMember });
  check("archive + restore of a member with no login both succeed", arNl.status === 200 && rsNl.status === 200 && (await memberStatus(noLoginMember)) === "active", short([arNl.json, rsNl.json]));

  // Parent archives the other Parent; the other Parent is then blocked; restore.
  const arP2 = await manage(pa1s.token, { action: "archive", member_id: pa2Member });
  check("archive second Parent: 200 and they can't sign in", arP2.status === 200 && !(await signIn(pa2Email)).token);
  // Last Parent: now A1 is the only active Parent.
  const lastP = await manage(pa1s.token, { action: "archive", member_id: pa1Member });
  check("archive the only active Parent -> 409 with a clear message", lastP.status === 409 && /only active Parent/.test(lastP.json?.error ?? ""), short(lastP));
  check("last-Parent refusal changed nothing (still active, login not banned)", (await memberStatus(pa1Member)) === "active" && !!(await signIn(pa1.email)).token);
  const rsP2 = await manage(pa1s.token, { action: "restore", member_id: pa2Member });
  check("restore second Parent: 200 and they can sign in again", rsP2.status === 200 && !!(await signIn(pa2Email)).token);
  const rsActive = await manage(pa1s.token, { action: "restore", member_id: pa1Member });
  check("restore of an already-active member -> 200 (no state change)", rsActive.status === 200 && (await memberStatus(pa1Member)) === "active", short(rsActive));

  // ---- Admin (ban) call fails: no half state ---------------------------------
  console.log("\n-- archive/restore when the login update fails --");
  psql(BLOCK_BAN_SQL);
  try {
    const failArchive = await manage(pa1s.token, { action: "archive", member_id: childMember });
    check("archive when the ban write fails -> 502 (not success)", failArchive.status === 502, short(failArchive));
    check("archive failure: status compensated back to active, login still works",
      (await memberStatus(childMember)) === "active" && !!(await signIn(newEmail, NEWPW)).token);
    check("archive failure: error body is generic (no internals)", Object.keys(failArchive.json ?? {}).join() === "error" && !/smoke|trigger|ban blocked/i.test(failArchive.text));
  } finally {
    psql(UNBLOCK_BAN_SQL);
  }
  const okArchive = await manage(pa1s.token, { action: "archive", member_id: childMember });
  check("archive works again once the failure is removed", okArchive.status === 200 && (await memberStatus(childMember)) === "archived");
  psql(BLOCK_BAN_SQL);
  try {
    const failRestore = await manage(pa1s.token, { action: "restore", member_id: childMember });
    check("restore when the unban write fails -> 502 (not success)", failRestore.status === 502, short(failRestore));
    check("restore failure: status compensated back to archived, still can't sign in",
      (await memberStatus(childMember)) === "archived" && !(await signIn(newEmail, NEWPW)).token);
  } finally {
    psql(UNBLOCK_BAN_SQL);
  }
  const okRestore = await manage(pa1s.token, { action: "restore", member_id: childMember });
  check("restore works again once the failure is removed", okRestore.status === 200 && !!(await signIn(newEmail, NEWPW)).token);

  // ---- Rate limit --------------------------------------------------------------
  console.log("\n-- rate limit --");
  const seed = (ageMs, n) =>
    Array.from({ length: n }, () => ({
      household_id: hhA, actor_user_id: pa1.id, entity_type: "household_members", entity_id: childMember,
      action: "set_password_link_created", new_values: {}, created_at: new Date(Date.now() - ageMs).toISOString(),
    }));
  const oldSeed = await admin.from("audit_log").insert(seed(2 * 3600 * 1000, 25)).select("id");
  const notLimited = await manage(pa1s.token, { action: "create_link", member_id: childMember });
  check("rate limit: rows older than an hour do not count (200)", notLimited.status === 200, short(notLimited));
  await admin.from("audit_log").delete().in("id", (oldSeed.data ?? []).map((r) => r.id));
  const freshSeed = await admin.from("audit_log").insert(seed(1000, 20)).select("id");
  const limited = await manage(pa1s.token, { action: "create_link", member_id: childMember });
  check("rate limit: >= 20 links in the last hour -> 429, no url", limited.status === 429 && !("url" in (limited.json ?? {})), short(limited));
  const otherCaller = await manage(pa2s.token, { action: "create_link", member_id: childMember });
  check("rate limit is per caller (another Parent still allowed)", otherCaller.status === 200, short(otherCaller));
  if (otherCaller.json?.url) issuedTokens.push(tokenOf(otherCaller.json.url));
  await admin.from("audit_log").delete().in("id", (freshSeed.data ?? []).map((r) => r.id));
  const afterClear = await manage(pa1s.token, { action: "create_link", member_id: childMember });
  check("rate limit lifts when the recent rows are gone", afterClear.status === 200, short(afterClear));
  if (afterClear.json?.url) issuedTokens.push(tokenOf(afterClear.json.url));

  // ---- Logs ---------------------------------------------------------------------
  if (process.env.SERVE_LOG) {
    const log = readFileSync(process.env.SERVE_LOG, "utf8");
    const leaked = [...issuedTokens.filter(Boolean), ...usedEmails].filter((s) => log.includes(s));
    check("functions log contains no link token and no email address", leaked.length === 0, `${leaked.length} leaked`);
  }
}

let crashed = false;
try {
  await main();
} catch (err) {
  crashed = true;
  console.error(`\nCRASH: ${err.stack ?? err}`);
  results.push({ name: "script ran to completion", ok: false });
}

console.log("\n-- cleanup --");
const problems = await cleanup();
const usersAfter = (await listAllUsers()).length;
const { count: leftoverAudit } = await admin.from("audit_log").select("id", { count: "exact", head: true }).in("household_id", householdIds.length ? householdIds : ["00000000-0000-0000-0000-000000000000"]);
check("cleanup: no errors", problems.length === 0, problems.join("; "));
check("cleanup: auth user count back to what it was before", usersBefore === usersAfter, `${usersBefore} -> ${usersAfter}`);
check("cleanup: no audit rows of the test households remain", (leftoverAudit ?? 0) === 0);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed${crashed ? " (script crashed)" : ""}`);
process.exit(failed.length === 0 ? 0 : 1);
