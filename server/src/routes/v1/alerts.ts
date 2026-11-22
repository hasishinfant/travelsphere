import { Router } from 'express';
import { z } from 'zod';
import type { Db } from '../../db.js';
import { withUser } from '../../db.js';
import { HttpError, parse, route } from '../../http.js';
import { Page, UUID, pageMeta } from './common.js';

const ListQuery = Page.extend({ status: z.enum(['active', 'acknowledged', 'expired', 'resolved']).default('active') }).strict();
const Device = z.object({ platform: z.enum(['fcm', 'web_push']), token: z.string().min(10).max(4096) }).strict();

export function alertsRouter(db: Db) {
  const r = Router();

  // Own alerts plus destination-wide warnings (RLS: user_id = me or user_id is null)
  r.get('/', route(async (req, res) => {
    const q = parse(ListQuery, req.query);
    const alerts = await withUser(db, req.user!.id, async tx => (await tx.query(
      `select id, user_id is null as destination_wide, destination_id, journey_id, level, title, body, recommended_action,
              status, issued_at, expires_at, acknowledged_at, destination_assessment_id, journey_assessment_id
       from public.safety_alerts where status = $1 and (user_id = auth.uid() or user_id is null)
       order by case level when 'CRITICAL' then 0 when 'HIGH' then 1 else 2 end, issued_at desc
       limit $2 offset $3`, [q.status, q.limit, q.offset])).rows);
    res.json({ alerts, page: pageMeta(q.limit, q.offset, alerts.length) });
  }));

  r.post('/:id/acknowledge', route(async (req, res) => {
    const id = parse(UUID, req.params.id);
    const alert = await withUser(db, req.user!.id, async tx => (await tx.query(
      `update public.safety_alerts set status = 'acknowledged', acknowledged_at = now()
       where id = $1 and user_id = auth.uid() and status = 'active'
       returning id, status, acknowledged_at`, [id])).rows[0]);
    if (!alert) throw new HttpError(404, 'not_found', 'No active alert of yours with this id');
    res.json({ alert });
  }));

  return r;
}

export function devicesRouter(db: Db) {
  const r = Router();
  r.post('/', route(async (req, res) => {
    const b = parse(Device, req.body);
    const device = await withUser(db, req.user!.id, async tx => (await tx.query(
      `insert into public.device_tokens (user_id, platform, token) values (auth.uid(), $1, $2)
       on conflict (user_id, token) do update set last_seen_at = now()
       returning id, platform, created_at, last_seen_at`, [b.platform, b.token])).rows[0]);
    res.status(201).json({ device });
  }));
  r.delete('/:id', route(async (req, res) => {
    const id = parse(UUID, req.params.id);
    const ok = await withUser(db, req.user!.id, async tx =>
      (await tx.query('delete from public.device_tokens where id = $1 and user_id = auth.uid()', [id])).rowCount === 1);
    if (!ok) throw new HttpError(404, 'not_found', 'Device not found');
    res.status(204).end();
  }));
  return r;
}
