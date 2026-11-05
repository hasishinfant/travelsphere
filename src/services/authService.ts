// authService.ts — All authentication operations via Supabase Auth.
// Never import the raw supabase client outside of this file and supabaseClient.ts.
import { supabase, requireSupabase } from './supabaseClient';
import type { Session, User } from '@supabase/supabase-js';

export interface AuthProfile {
  id: string;
  email: string;
  full_name: string;
  avatar_url?: string | null;
  home_airport?: string | null;
  home_city?: string | null;
  role: 'user' | 'admin';
}

// ─── Sign In ────────────────────────────────────────────────────────────────

export async function signIn(email: string, password: string): Promise<{ user: User; session: Session }> {
  const { data, error } = await requireSupabase().auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  if (!data.user || !data.session) throw new Error('Sign-in failed — no session returned.');
  return { user: data.user, session: data.session };
}

// ─── Sign Up ─────────────────────────────────────────────────────────────────

export async function signUp(email: string, password: string, fullName: string): Promise<{ user: User; session: Session | null }> {
  const { data, error } = await requireSupabase().auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } },
  });
  if (error) throw new Error(error.message);
  if (!data.user) throw new Error('Sign-up failed.');
  return { user: data.user, session: data.session };
}

// ─── Sign Out ────────────────────────────────────────────────────────────────

export async function signOut(): Promise<void> {
  if (supabase) {
    const { error } = await supabase.auth.signOut().catch((e: Error) => ({ error: e }));
    if (error) console.warn('[authService] signOut error:', error.message);
  }
  localStorage.removeItem('user');
  window.dispatchEvent(new Event('auth-change'));
}

// ─── Get current session ─────────────────────────────────────────────────────

export async function getAuthSession(): Promise<Session | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
}

// ─── Build local profile object from Supabase user ───────────────────────────

export function buildLocalProfile(user: User): AuthProfile {
  const meta = user.user_metadata || {};
  return {
    id: user.id,
    email: user.email || '',
    full_name: (meta.full_name as string) || (meta.name as string) || user.email?.split('@')[0] || 'Traveler',
    avatar_url: (meta.avatar_url as string) || null,
    home_airport: (meta.home_airport as string) || null,
    home_city: (meta.home_city as string) || null,
    role: (meta.role as 'user' | 'admin') || 'user',
  };
}

// ─── Persist profile to localStorage (keeps offline mode working) ─────────────

export function persistLocalUser(profile: AuthProfile) {
  localStorage.setItem('user', JSON.stringify({
    ...profile,
    loggedIn: true,
    loginTime: new Date().toISOString(),
    offline: false,
  }));
  window.dispatchEvent(new Event('auth-change'));
}

// ─── Reset password email ─────────────────────────────────────────────────────

export async function sendPasswordReset(email: string): Promise<void> {
  const { error } = await requireSupabase().auth.resetPasswordForEmail(email, {
    // Respect the deploy base path (e.g. /tbo/ on GitHub Pages)
    redirectTo: `${window.location.origin}${import.meta.env.BASE_URL}`,
  });
  if (error) throw new Error(error.message);
}

// ─── Guest mode (no account; data stays in this browser) ─────────────────────

export function continueAsGuest() {
  localStorage.setItem('user', JSON.stringify({
    id: 'guest',
    email: '',
    full_name: 'Guest',
    name: 'Guest',
    role: 'user',
    guest: true,
    loggedIn: true,
    loginTime: new Date().toISOString(),
    offline: true,
  }));
  window.dispatchEvent(new Event('auth-change'));
}
