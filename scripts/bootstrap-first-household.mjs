// Family Ledger: one-time bootstrap of the FIRST household and its first Parent.
//
// Why this exists: the app has no public sign-up and no "create household"
// screen (ARCHITECTURE.md §6.2), and add_household_member() requires the
// caller to already be a Parent -- so the very first Parent cannot be created
// through the app. This script does that one step from a trusted machine,
// using the Supabase Auth Admin API (service_role key) and then plain table
// inserts. It is the only supported way to seed a fresh hosted project.
//
// Safety properties:
//   * Refuses to run if ANY household already exists -- it can never add a
//     second household or a second "first" Parent by accident.
//   * Reads every value from environment variables; nothing sensitive is in
//     this file or in git. Run it via `npm run bootstrap` (see
//     docs/DEPLOYMENT_RUNBOOK.md), which loads `.env.bootstrap` (gitignored).
//   * Writes the same audit_log rows the app's own functions write.
//   * Rolls back (deletes the auth user / household) if a later step fails.
//   * Never prints the service_role key or the password.

import { createClient } from "@supabase/supabase-js";

const required = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "FIRST_PARENT_EMAIL",
  "FIRST_PARENT_PASSWORD",
  "FIRST_PARENT_NAME",
  "HOUSEHOLD_NAME",
  "HOUSEHOLD_TIMEZONE",
];

const missing = required.filter((k) => !process.env[k]?.trim());
if (missing.length > 0) {
  console.error(`Missing required settings: ${missing.join(", ")}`);
  console.error("Fill them in .env.bootstrap (see docs/DEPLOYMENT_RUNBOOK.md).");
  process.exit(1);
}

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  FIRST_PARENT_EMAIL,
  FIRST_PARENT_PASSWORD,
  FIRST_PARENT_NAME,
  HOUSEHOLD_NAME,
  HOUSEHOLD_TIMEZONE,
} = process.env;

// Guard: this script is for the HOSTED project. Running it against the local
// Docker stack works too, but make that an explicit, visible choice.
console.log(`Target project: ${SUPABASE_URL}`);

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  // 1. Refuse if the project already has a household.
  const { count, error: countError } = await admin
    .from("households")
    .select("id", { count: "exact", head: true });
  if (countError) {
    throw new Error(
      `Could not read households (${countError.message}). ` +
        "Check that the database migrations were applied and the service_role key is correct.",
    );
  }
  if (count && count > 0) {
    throw new Error(
      `This project already has ${count} household(s). Bootstrap is first-run only; nothing was changed.`,
    );
  }

  // 2. Create the login (no email confirmation: the project has no email provider).
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: FIRST_PARENT_EMAIL.trim(),
    password: FIRST_PARENT_PASSWORD,
    email_confirm: true,
  });
  if (createError || !created?.user) {
    throw new Error(`Could not create the login: ${createError?.message ?? "unknown error"}`);
  }
  const userId = created.user.id;

  let householdId = null;
  try {
    // 3. Household (the timezone trigger rejects non-IANA names).
    const { data: household, error: householdError } = await admin
      .from("households")
      .insert({ name: HOUSEHOLD_NAME.trim(), timezone: HOUSEHOLD_TIMEZONE.trim() })
      .select()
      .single();
    if (householdError) throw new Error(`households insert: ${householdError.message}`);
    householdId = household.id;

    // 4. The first Parent's membership row, active immediately.
    const { data: member, error: memberError } = await admin
      .from("household_members")
      .insert({
        household_id: householdId,
        user_id: userId,
        name: FIRST_PARENT_NAME.trim(),
        role: "parent",
        status: "active",
      })
      .select()
      .single();
    if (memberError) throw new Error(`household_members insert: ${memberError.message}`);

    // 5. Audit trail, matching what the app's own functions record.
    const { error: auditError } = await admin.from("audit_log").insert([
      {
        household_id: householdId,
        actor_user_id: userId,
        entity_type: "households",
        entity_id: householdId,
        action: "created",
        new_values: household,
      },
      {
        household_id: householdId,
        actor_user_id: userId,
        entity_type: "household_members",
        entity_id: member.id,
        action: "created",
        new_values: member,
      },
    ]);
    if (auditError) throw new Error(`audit_log insert: ${auditError.message}`);

    console.log("");
    console.log("Done. First household created.");
    console.log(`  Household: ${household.name} (${household.timezone})`);
    console.log(`  Parent:    ${member.name} <${FIRST_PARENT_EMAIL.trim()}>`);
    console.log("You can now sign in at the app's URL with that email and password.");
  } catch (err) {
    // Roll back so a re-run starts from a clean slate. Deleting the household
    // cascades to its members and audit rows; audit_log.actor_user_id is
    // ON DELETE RESTRICT, so the household must go before the auth user.
    if (householdId) {
      const { error } = await admin.from("households").delete().eq("id", householdId);
      if (error) console.error(`Rollback: could not delete household: ${error.message}`);
    }
    const { error: delError } = await admin.auth.admin.deleteUser(userId);
    if (delError) console.error(`Rollback: could not delete login: ${delError.message}`);
    throw err;
  }
}

main().catch((err) => {
  console.error(`\nBootstrap failed: ${err.message}`);
  process.exit(1);
});
