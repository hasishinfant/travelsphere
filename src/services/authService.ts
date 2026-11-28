// authService.ts — sign-in, sign-up and sign-out against the TravelSphere API (server/).
import { api, setSession, type Session } from './apiClient';

export interface AuthProfile {
  id: string;
  email: string;
  full_name: string;
  avatar_url?: string | null;
  home_airport?: string | null;
  home_city?: string | null;
  role: 'user' | 'admin';
}

interface AuthResponse {
  token: string;
  user: { id: string; email: string; full_name: string | null };
  mode: Session['mode'];
}

async function startSession(path: string, body: Record<string, string>): Promise<AuthProfile> {
  const { token, user, mode } = await api<AuthResponse>(path, { method: 'POST', auth: false, body });
  setSession({ token, userId: user.id, mode });
  return { id: user.id, email: user.email, full_name: user.full_name || user.email.split('@')[0], role: 'user' };
}

export const signIn = (email: string, password: string) => startSession('/auth/login', { email, password });

export const signUp = (email: string, password: string, fullName: string) =>
  startSession('/auth/register', { email, password, full_name: fullName });

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

// ─── Guest mode (anonymous server account created on first use; see ensureSession) ───

export function continueAsGuest() {
  setSession(null);
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
