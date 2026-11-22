// Incident reporting and management. Travellers create and read their own incidents; responders/admins see all and
// change status. RLS enforces the same rules in the database (defence in depth).
import { Router } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import type { Db, Tx } from '../../db.js';
import { withUser } from '../../db.js';
import { HttpError, parse, route } from '../../http.js';
import { DEST_ID, Page, UUID, pageMeta } from './common.js';

const STATUSES = ['open', 'acknowledged', 'in_progress', 'resolved', 'closed'] as const;
const HAZARD = z.enum(['flood', 'landslide', 'wildfire', 'cyclone', 'earthquake', 'volcano', 'drought', 'storm', 'heat',
  'tsunami', 'other']);

// Allowed status transitions (closed is terminal; resolved may be reopened)
export const TRANSITIONS: Record<string, string[]> = {
  open: ['acknowledged', 'in_progress', 'resolved', 'closed'],
  acknowledged: ['in_progress', 'resolved', 'closed'],
  in_progress: ['resolved', 'closed'],
  resolved: ['in_progress', 'closed'],
  closed: [],
};

const Create = z.object({
  category: z.enum(['medical', 'accident', 'natural_hazard', 'unsafe_location', 'lost_traveller', 'security', 'other']),
  priority: z.enum(['low', 'normal', 'high', 'critical']).optional(),
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().max(4000).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  location_accuracy_m: z.number().min(0).max(100_000).optional(),
  occurred_at: z.string().datetime({ offset: true }).optional(),
  is_sos: z.boolean().default(false),
  journey_id: UUID.optional(),
  destination_id: DEST_ID.optional(),
  hazard_type: HAZARD.optional(),
}).strict()
  .refine(b => (b.latitude === undefined) === (b.longitude === undefined), { message: 'latitude and longitude go together', path: ['longitude'] })
  .refine(b => !b.occurred_at || Date.parse(b.occurred_at) <= Date.now() + 5 * 60_000, { message: 'occurred_at is in the future', path: ['occurred_at'] });

const StatusChange = z.object({
  status: z.enum(STATUSES),
  note: z.string().trim().max(2000).optional(),
  verified: z.boolean().optional(),
  assigned_to: UUID.nullable().optional(),
}).strict();

const Note = z.object({ note: z.string().trim().min(1).max(2000) }).strict();
const ListQuery = Page.extend({ status: z.enum(STATUSES).optional(), scope: z.enum(['mine', 'all']).default('mine') }).strict();

const COLUMNS = `id, reference, reporter_id, journey_id, destination_id, category, hazard_type, priority, status, title,
  description, latitude, longitude, location_accuracy_m, occurred_at, is_sos, verified, assigned_to, created_at, updated_at`;

const isStaff = async (tx: Tx) =>
  (await tx.query(`select role in ('responder', 'admin') as staff from public.profiles where id = auth.uid()`)).rows[0]?.staff === true;

export function incidentsRouter(db: Db) {
  const r = Router();
  const createLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false,
    keyGenerator: req => req.user?.id ?? ipKeyGenerator(req.ip ?? '') });

  r.post('/', createLimiter, route(async (req, res) => {
    const b = parse(Create, req.body);
    const incident = await withUser(db, req.user!.id, async tx => {
      if (b.journey_id) {
        const { rowCount } = await tx.query('select 1 from public.journeys where id = $1 and user_id = auth.uid()', [b.journey_id]);
        if (!rowCount) throw new HttpError(400, 'invalid_reference', 'Journey not found');
      }
      const { rows } = await tx.query(
        `insert into public.incidents (reporter_id, journey_id, destination_id, category, hazard_type, priority, title,
           description, latitude, longitude, location_accuracy_m, occurred_at, is_sos)
         values (auth.uid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, coalesce($11::timestamptz, now()), $12)
         returning ${COLUMNS}`,
        [b.journey_id ?? null, b.destination_id ?? null, b.category, b.hazard_type ?? null,
          b.priority ?? (b.is_sos ? 'critical' : 'normal'), b.title, b.description ?? null, b.latitude ?? null,
          b.longitude ?? null, b.location_accuracy_m ?? null, b.occurred_at ?? null, b.is_sos]);
      return rows[0];
    });
    res.status(201).json({ incident });
  }));

  r.get('/', route(async (req, res) => {
    const q = parse(ListQuery, req.query);
    const out = await withUser(db, req.user!.id, async tx => {
      const staff = await isStaff(tx);
      if (q.scope === 'all' && !staff) throw new HttpError(403, 'forbidden', 'Only responders can list all incidents');
      const { rows } = await tx.query(
        `select ${COLUMNS} from public.incidents
         where ($1::text = 'all' or reporter_id = auth.uid()) and ($2::text is null or status = $2)
         order by case priority when 'critical' then 0 when 'high' then 1 when 'normal' then 2 else 3 end, created_at desc
         limit $3 offset $4`, [q.scope, q.status ?? null, q.limit, q.offset]);
      return rows;
    });
    res.json({ incidents: out, page: pageMeta(q.limit, q.offset, out.length) });
  }));

  r.get('/:id', route(async (req, res) => {
    const id = parse(UUID, req.params.id);
    const incident = await withUser(db, req.user!.id, async tx => {
      const { rows } = await tx.query(`select ${COLUMNS} from public.incidents where id = $1`, [id]);
      if (!rows[0]) return null;
      const { rows: updates } = await tx.query(
        `select id, author_id, status, note, created_at from public.incident_updates where incident_id = $1 order by created_at`, [id]);
      return { ...rows[0], updates };
    });
    if (!incident) throw new HttpError(404, 'not_found', 'Incident not found');
    res.json({ incident });
  }));

  r.patch('/:id/status', route(async (req, res) => {
    const id = parse(UUID, req.params.id);
    const b = parse(StatusChange, req.body);
    const incident = await withUser(db, req.user!.id, async tx => {
      if (!(await isStaff(tx))) throw new HttpError(403, 'forbidden', 'Only responders can change incident status');
      const { rows } = await tx.query('select status from public.incidents where id = $1 for update', [id]);
      if (!rows[0]) throw new HttpError(404, 'not_found', 'Incident not found');
      const from = rows[0].status as string;
      if (from !== b.status && !TRANSITIONS[from].includes(b.status)) {
        throw new HttpError(409, 'invalid_transition', `Cannot move an incident from ${from} to ${b.status}`,
          { allowed: TRANSITIONS[from] });
      }
      const { rows: upd } = await tx.query(
        `update public.incidents set status = $2,
           verified = coalesce($3, verified),
           verified_by = case when $3 is true then auth.uid() when $3 is false then null else verified_by end,
           assigned_to = case when $4::boolean then $5::uuid else assigned_to end
         where id = $1 returning ${COLUMNS}`,
        [id, b.status, b.verified ?? null, b.assigned_to !== undefined, b.assigned_to ?? null]);
      await tx.query(
        `insert into public.incident_updates (incident_id, author_id, status, note) values ($1, auth.uid(), $2, $3)`,
        [id, b.status, b.note ?? (b.verified ? 'Verified by responder' : null)]);
      return upd[0];
    });
    // Notify the reporter. Notifications are server-written (no traveller insert policy), so this runs outside the
    // RLS transaction — a failure here must never roll back the status change.
    await db.query(
      `insert into public.notifications (user_id, incident_id, kind, title, body) values ($1, $2, 'incident_update', $3, $4)`,
      [incident.reporter_id, id, `Incident ${incident.reference}: ${b.status.replace('_', ' ')}`,
        b.note ?? `Your report "${incident.title}" is now ${b.status.replace('_', ' ')}.`],
    ).catch(err => console.warn('[incidents] notification not created:', (err as Error).message));
    res.json({ incident });
  }));

  r.post('/:id/notes', route(async (req, res) => {
    const id = parse(UUID, req.params.id);
    const { note } = parse(Note, req.body);
    const update = await withUser(db, req.user!.id, async tx => {
      const { rowCount } = await tx.query('select 1 from public.incidents where id = $1', [id]);
      if (!rowCount) throw new HttpError(404, 'not_found', 'Incident not found');
      const { rows } = await tx.query(
        `insert into public.incident_updates (incident_id, author_id, note) values ($1, auth.uid(), $2)
         returning id, author_id, status, note, created_at`, [id, note]);
      return rows[0];
    });
    res.status(201).json({ update });
  }));

  return r;
}
