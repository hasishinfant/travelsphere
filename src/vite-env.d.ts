/// <reference types="vite/client" />

// Only browser-safe values belong here: every VITE_* variable is compiled into the
// public JavaScript bundle. Secrets (API keys, DB URLs, JWT secrets) live in server/.env.
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_API_TIMEOUT?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** @deprecated move TBO/TekTravels calls behind the server; do not set in production */
  readonly VITE_TEK_TRAVELS_API_KEY?: string;
  readonly VITE_TEK_TRAVELS_API_URL?: string;
  readonly VITE_TBO_HOTEL_API_URL?: string;
  readonly VITE_TBO_HOTEL_USERNAME?: string;
  readonly VITE_TBO_HOTEL_PASSWORD?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
