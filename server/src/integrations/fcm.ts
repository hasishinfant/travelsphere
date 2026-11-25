// Firebase Cloud Messaging HTTP v1 sender + notification dispatcher.
// Credential-dependent: needs FCM_PROJECT_ID and FCM_SERVICE_ACCOUNT_JSON (a service-account key with the
// "Firebase Cloud Messaging API Admin" role). Without them, notifications remain in-app only.
import { importPKCS8, SignJWT } from 'jose';
import type { Db } from '../db.js';

interface ServiceAccount { client_email: string; private_key: string; token_uri?: string }
type FetchFn = typeof fetch;

export interface PushSender {
  send(token: string, title: string, body: string, data?: Record<string, string>): Promise<'sent' | 'invalid_token' | 'failed'>;
}

export function createFcmSender(projectId: string, serviceAccountJson: string, fetchFn: FetchFn = fetch): PushSender {
  const sa = JSON.parse(serviceAccountJson) as ServiceAccount;
  if (!sa.client_email || !sa.private_key) throw new Error('FCM_SERVICE_ACCOUNT_JSON lacks client_email/private_key');
  const tokenUri = sa.token_uri || 'https://oauth2.googleapis.com/token';
  let cached: { token: string; exp: number } | null = null;

  async function accessToken(): Promise<string> {
    if (cached && cached.exp > Date.now() + 60_000) return cached.token;
    const key = await importPKCS8(sa.private_key, 'RS256');
    const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/firebase.messaging' })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' }).setIssuer(sa.client_email).setAudience(tokenUri)
      .setIssuedAt().setExpirationTime('1h').sign(key);
    const res = await fetchFn(tokenUri, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }) });
    if (!res.ok) throw new Error(`FCM OAuth token request failed (${res.status})`);
    const body = await res.json() as { access_token: string; expires_in: number };
    cached = { token: body.access_token, exp: Date.now() + body.expires_in * 1000 };
    return cached.token;
  }

  return {
    async send(token, title, body, data) {
      const res = await fetchFn(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: { token, notification: { title, body }, data } }),
      });
      if (res.ok) return 'sent';
      // 404 UNREGISTERED / 400 INVALID_ARGUMENT → token no longer valid
      return res.status === 404 || res.status === 400 ? 'invalid_token' : 'failed';
    },
  };
}

/**
 * Deliver pending notifications by push:
 *   - risk warnings to users who enabled push, at or above their minimum level;
 *   - incident alerts (new SOS / urgent incidents, to responders) and incident updates (to the reporter) to anyone
 *     with a registered device — registering a device is the opt-in.
 * 'sent' records that FCM ACCEPTED the message for delivery. It does not mean the device showed it or a person saw it.
 * Without a sender or a device token the notification stays 'pending' and remains visible in-app.
 */
export async function dispatchPending(db: Db, sender: PushSender | null, limit = 50): Promise<{ sent: number; failed: number }> {
  if (!sender) return { sent: 0, failed: 0 };
  const { rows } = await db.query(
    `select n.id, n.user_id, n.kind, n.title, n.body, n.risk_level, n.safety_alert_id, n.incident_id
     from public.notifications n join public.profiles p on p.id = n.user_id
     where n.delivery_status = 'pending' and (n.expires_at is null or n.expires_at > now())
       and exists (select 1 from public.device_tokens t where t.user_id = n.user_id and t.platform = 'fcm')
       and (n.kind in ('incident_alert', 'incident_update') or (n.kind = 'risk_warning'
         and coalesce((p.notification_preferences ->> 'web_push')::boolean, false)
         and array_position(array['LOW','MODERATE','HIGH','CRITICAL'], n.risk_level)
             >= array_position(array['LOW','MODERATE','HIGH','CRITICAL'], coalesce(p.notification_preferences ->> 'min_risk_level', 'MODERATE'))))
     order by case n.kind when 'incident_alert' then 0 when 'incident_update' then 1 else 2 end, n.created_at limit $1`, [limit]);
  let sent = 0;
  let failed = 0;
  for (const n of rows) {
    const { rows: tokens } = await db.query(
      `select id, token from public.device_tokens where user_id = $1 and platform = 'fcm'`, [n.user_id]);
    const data: Record<string, string> = { kind: n.kind, alert_id: String(n.safety_alert_id ?? ''), level: n.risk_level ?? '',
      incident_id: String(n.incident_id ?? '') };
    let ok = false;
    const errors: string[] = [];
    for (const t of tokens) {
      const r = await sender.send(t.token, n.title, n.body, data).catch(() => 'failed' as const);
      if (r === 'sent') ok = true;
      else errors.push(r);
      if (r === 'invalid_token') await db.query('delete from public.device_tokens where id = $1', [t.id]);
    }
    const error = ok ? null : errors.length ? `push not accepted: ${[...new Set(errors)].join(', ')}` : 'no device token';
    await db.query(
      `update public.notifications set delivery_status = $2, channel = 'fcm', delivery_error = $3, delivery_attempted_at = now()
       where id = $1`, [n.id, ok ? 'sent' : 'failed', error]);
    if (ok) sent++; else failed++;
  }
  return { sent, failed };
}
