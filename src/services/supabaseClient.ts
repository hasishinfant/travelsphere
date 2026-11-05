// Supabase singleton client — import this everywhere you need Supabase.
// The anon (publishable) key is safe to ship in browser code; RLS enforces data access.
//
// When the Supabase env vars are absent (e.g. a static GitHub Pages build without
// repository variables) the client is `null` and the app runs in guest/offline mode
// instead of crashing at import time.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url  = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const anon = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();

export const isSupabaseConfigured = Boolean(url && anon);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url!, anon!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'ts_supabase_session',
      },
    })
  : null;

if (!isSupabaseConfigured && import.meta.env.DEV) {
  console.warn('[Supabase] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set — running in guest mode.');
}

/** Returns the client or throws a user-friendly error when auth is unavailable. */
export function requireSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error('Account sign-in is not available right now. Continue as a guest instead.');
  }
  return supabase;
}

export type SupabaseUser = Awaited<ReturnType<SupabaseClient['auth']['getUser']>>['data']['user'];
