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

export const supabase = createClient(
  readRequiredEnv("VITE_SUPABASE_URL"),
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
