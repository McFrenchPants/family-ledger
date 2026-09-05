/// <reference types="vite/client" />

/**
 * Only browser-safe values are declared here. Any privileged key or the VAPID
 * private key must never gain a VITE_ prefix and so must never appear in this
 * interface -- a missing declaration is the first line of defence against
 * someone reaching for a secret from client code.
 */
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_VAPID_PUBLIC_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
