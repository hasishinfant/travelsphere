// Thin client for the TravelSphere API (server/). Holds the session token and
// normalises errors. When there is no session the app works offline from localStorage.

const BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) || '/api';
const SESSION_KEY = 'ts_session';

export interface Session {
  token: string;
  userId: string;
  mode: 'local-dev' | 'password';
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

let pending: Promise<boolean> | null = null;

/**
 * Make sure the signed-in user also has a server session.
 * Guests get an anonymous server account on first use. Signed-in users whose token expired must sign in again.
 * Returns false when there is no session to be had or the server is unreachable.
 */
export function ensureSession(): Promise<boolean> {
  if (getSession()) return Promise.resolve(true);
  if (pending) return pending;

  let user: { guest?: boolean } | null = null;
  try { user = JSON.parse(localStorage.getItem('user') || 'null'); } catch { user = null; }
  if (!user?.guest) return Promise.resolve(false);

  pending = api<{ token: string; user: { id: string }; mode: Session['mode'] }>('/auth/guest', { method: 'POST', auth: false })
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
