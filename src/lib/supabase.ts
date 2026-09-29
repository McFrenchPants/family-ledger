import { createClient } from "@supabase/supabase-js";

/**
 * The single browser Supabase client.
 *
 * It is built from `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` only. The
 * anon key is a *public* credential: every request it makes is still subject
 * to Row Level Security in Postgres, which is where authorization actually
 * lives. No key that grants more than an anonymous visitor may ever be
 * referenced from `src/` -- a privileged key would be shipped in the bundle
 * and would bypass RLS entirely. See CLAUDE.md for which keys those are.
 */
function readRequiredEnv(name: "VITE_SUPABASE_URL" | "VITE_SUPABASE_ANON_KEY"): string {
  const value = import.meta.env[name];

  // Failing loudly at module load beats a client that silently 401s on every
  // call, which is what an empty string produces.
  if (!value) {
    throw new Error(
      `Missing ${name}. Copy .env.example to .env and fill in the values for ` +
        "the local Supabase stack (`npx supabase status`) or the hosted project.",
    );
  }

  return value;
}

// In `npm run dev`, always go through Vite's own `/supabase-api` proxy
// (see vite.config.ts) rather than the literal `VITE_SUPABASE_URL` value --
// this makes API calls same-origin with whatever host loaded the page
// (localhost, or a LAN IP when testing from a phone), instead of hardcoding
// 127.0.0.1, which a phone can't resolve to the dev machine at all.
const supabaseUrl = import.meta.env.DEV
  ? `${window.location.origin}/supabase-api`
  : readRequiredEnv("VITE_SUPABASE_URL");

export const supabase = createClient(
  supabaseUrl,
  readRequiredEnv("VITE_SUPABASE_ANON_KEY"),
  {
    auth: {
      // Persist to localStorage and refresh in the background so a page reload
      // keeps the signed-in session. This is Phase 0's proof that auth works
      // end to end; it carries no authorization meaning on its own.
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  },
);
