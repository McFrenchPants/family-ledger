// Family Ledger: LOCAL-ONLY fixture -- adds a fake "Test Family" household to
// the Docker Supabase stack so signed-in screens can be checked in a browser.
//
//   node scripts/dev/seed-local-test-family.mjs
//
// * Refuses any Supabase URL that is not 127.0.0.1/localhost. The keys below
//   are the Supabase CLI's public, well-known local-demo keys, not secrets.
// * Additive: creates its own household; never touches other local data.
//   Refuses to run twice (checks for the test parent's email).
// * Writes go through the app's own RPCs, signed in as the test Parent, so
//   audit rows and server rules apply exactly as in the app.
//
// Test logins (local stack only), all with password LOCAL_TEST_PASSWORD:
//   Parent  dana@test.familyledger.local
//   Child   alex@test.familyledger.local   (plan, $15.00 overdue)
//   Child   sam@test.familyledger.local    (plan, paid for the month)
//   Child   riley@test.familyledger.local  (no plan, nothing owed)

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const LOCAL_TEST_PASSWORD = "local-test-only-1234";

const host = new URL(SUPABASE_URL).hostname;
if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
  console.error(`Refusing to seed ${host}: this fixture is for the local Docker stack only.`);
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const people = [
  { key: "dana", name: "Dana", role: "parent" },
  { key: "alex", name: "Alex", role: "child" },
  { key: "sam", name: "Sam", role: "child" },
  { key: "riley", name: "Riley", role: "child" },
];
const emailOf = (key) => `${key}@test.familyledger.local`;

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}
function monthsAgo(n, day) {
  const now = new Date();
  return isoDate(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - n, day)));
}

async function must(promise, what) {
  const { data, error } = await promise;
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
}

async function main() {
  const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (list?.users?.some((u) => u.email === emailOf("dana"))) {
    console.log("Test Family already exists; nothing changed.");
    return;
  }

  const household = await must(
    admin
      .from("households")
      .insert({ name: "Test Family", timezone: "America/New_York" })
      .select()
      .single(),
    "households insert",
  );

  const members = {};
  for (const p of people) {
    const created = await must(
      admin.auth.admin.createUser({
        email: emailOf(p.key),
        password: LOCAL_TEST_PASSWORD,
        email_confirm: true,
      }),
      `create login ${p.key}`,
    );
    members[p.key] = await must(
      admin
        .from("household_members")
        .insert({
          household_id: household.id,
          user_id: created.user.id,
          name: p.name,
          role: p.role,
          status: "active",
        })
        .select()
        .single(),
      `member ${p.key}`,
    );
  }

  // Everything else through the app's own RPCs, as the Parent.
  const parent = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await must(
    parent.auth.signInWithPassword({ email: emailOf("dana"), password: LOCAL_TEST_PASSWORD }),
    "parent sign-in",
  );

  const expense = (who, cents, description, on) =>
    must(
      parent.rpc("record_expense", {
        p_member_id: members[who].id,
        p_amount_cents: cents,
        p_description: description,
        p_occurred_on: on,
      }),
      `expense ${who} ${description}`,
    );
  const payment = (who, cents, on) =>
    must(
      parent.rpc("record_payment", {
        p_member_id: members[who].id,
        p_amount_cents: -cents, // balance decreases are sent negative
        p_description: "Payment",
        p_occurred_on: on,
      }),
      `payment ${who}`,
    );

  await expense("alex", 12000, "Phone repair", monthsAgo(2, 3));
  await expense("alex", 4217, "Gas", monthsAgo(1, 2));
  await expense("alex", 6015, "Concert ticket", monthsAgo(1, 20));
  await payment("alex", 2500, monthsAgo(1, 10));
  await must(
    parent.rpc("create_payment_plan", {
      p_member_id: members.alex.id,
      p_minimum_cents: 4000,
      p_due_day: 15,
      p_starts_on: monthsAgo(1, 1),
    }),
    "alex plan",
  );

  await expense("sam", 8000, "Books", monthsAgo(1, 5));
  await payment("sam", 3000, monthsAgo(0, 1));
  await must(
    parent.rpc("create_payment_plan", {
      p_member_id: members.sam.id,
      p_minimum_cents: 2500,
      p_due_day: 20,
      p_starts_on: monthsAgo(1, 1),
    }),
    "sam plan",
  );

  console.log("Test Family created on the local stack (see this file's header for logins).");
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
