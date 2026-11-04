// Thin client for the TravelSphere API (server/). Holds the session token and
// normalises errors. When there is no session the app works offline from localStorage.

const BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) || '/api';
const SESSION_KEY = 'ts_session';

export interface Session {
  token: string;
  userId: string;
  mode: 'local-dev' | 'supabase';
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

export const getSession = (): Session | null => {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
};

export const setSession = (s: Session | null) => {
  if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  else localStorage.removeItem(SESSION_KEY);
};

export const isOnlineSession = () => !!getSession();

export async function api<T>(path: string, init: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  const session = getSession();
  if (init.auth !== false && session) headers.Authorization = `Bearer ${session.token}`;

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: init.method || 'GET',
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'network', 'Can’t reach the TravelSphere server');
  }

  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = (data as { error?: { code?: string; message?: string; details?: unknown } }).error;
    // Our API always returns { error: { code } }. A 5xx without it comes from a proxy/gateway,
    // i.e. the API itself is down.
    if (!e && res.status >= 500) throw new ApiError(0, 'network', 'Can’t reach the TravelSphere server');
    if (res.status === 401 && session) setSession(null); // expired / revoked session
    if (!e) throw new ApiError(res.status, 'http_error', `Request failed (${res.status})`);
    throw new ApiError(res.status, e.code || 'http_error', e.message || `Request failed (${res.status})`, e.details);
  }
  return data as T;
}

/** True when the failure means "server not available" rather than "request rejected". */
export const isUnavailable = (err: unknown) =>
  err instanceof ApiError && (err.status === 0 || err.status >= 502);

const GUEST_KEY = 'ts_guest_email';
let pending: Promise<boolean> | null = null;

/**
 * Make sure a signed-in user also has a server session.
 * Covers sessions created before the API existed, guests, and expired tokens.
 * Guests get an anonymous account (stable per browser), similar to Supabase anonymous sign-in.
 * Returns false when the server is unreachable or doesn't offer development sign-in.
 */
export function ensureSession(): Promise<boolean> {
  if (getSession()) return Promise.resolve(true);
  if (pending) return pending;

  let user: { email?: string; name?: string; guest?: boolean } | null = null;
  try { user = JSON.parse(localStorage.getItem('user') || 'null'); } catch { user = null; }
  if (!user) return Promise.resolve(false);

  let email = (user.email || '').trim().toLowerCase();
  if (!email || user.guest) {
    email = localStorage.getItem(GUEST_KEY) || `guest-${crypto.randomUUID().slice(0, 12)}@guest.travelsphere.local`;
    localStorage.setItem(GUEST_KEY, email);
  }

  pending = api<{ token: string; user: { id: string }; mode: 'local-dev' }>('/auth/dev-session', {
    method: 'POST',
    auth: false,
    body: { email, full_name: user.guest ? 'Guest' : user.name || undefined },
  })
    .then(s => {
      setSession({ token: s.token, userId: s.user.id, mode: s.mode });
      const cur = JSON.parse(localStorage.getItem('user') || '{}');
      localStorage.setItem('user', JSON.stringify({ ...cur, offline: false }));
      window.dispatchEvent(new Event('auth-change'));
      return true;
    })
    .catch(() => false)
    .finally(() => { pending = null; });
  return pending;
}
