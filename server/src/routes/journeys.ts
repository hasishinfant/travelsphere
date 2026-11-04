import { Router } from 'express';
import { z } from 'zod';
import type { Db, Tx } from '../db.js';
import { withUser } from '../db.js';
import { HttpError, parse, route } from '../http.js';

// Round-trip check: JS silently rolls 2027-02-30 over to March, so compare the components back
const ISO_DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').refine(v => {
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}, 'Not a real calendar date');
const Lat = z.number().min(-90).max(90);
const Lng = z.number().min(-180).max(180);
const UUID = z.string().uuid();

const Item = z.object({
  day_number: z.number().int().min(1).max(60),
  position: z.number().int().min(0).max(100).default(0),
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(1000).nullish(),
  category: z.string().trim().max(40).nullish(),
  activity_type: z.enum(['sightseeing', 'trekking', 'water', 'transit', 'dining', 'shopping', 'indoor', 'other'])
    .default('sightseeing'),
  latitude: Lat.nullish(),
  longitude: Lng.nullish(),
  planned_start: z.string().datetime({ offset: true }).nullish(),
  planned_duration_minutes: z.number().int().min(0).max(1440).nullish(),
}).strict().refine(i => (i.latitude == null) === (i.longitude == null), 'latitude and longitude go together');

const JourneyFields = {
  title: z.string().trim().max(120).nullish(),
  destination_id: z.string().regex(/^[a-z0-9-]{2,40}$/, 'Invalid destination id'),
  destination_name: z.string().trim().min(1).max(120),
  latitude: Lat.nullish(),
  longitude: Lng.nullish(),
  start_date: ISO_DATE,
  end_date: ISO_DATE,
  travellers: z.number().int().min(1).max(20).default(1),
  budget: z.enum(['low', 'medium', 'luxury']).nullish(),
  interests: z.array(z.enum(['food', 'adventure', 'culture', 'nature', 'shopping'])).max(10).default([]),
};

const datesOk = (v: { start_date?: string; end_date?: string }) =>
  !v.start_date || !v.end_date || v.end_date >= v.start_date;
const coordsOk = (v: { latitude?: number | null; longitude?: number | null }) =>
  (v.latitude == null) === (v.longitude == null);

const JourneyCreate = z.object({ ...JourneyFields, items: z.array(Item).max(300).default([]) })
  .strict()
  .refine(datesOk, { message: 'end_date must be on or after start_date', path: ['end_date'] })
  .refine(coordsOk, { message: 'latitude and longitude go together', path: ['longitude'] });

const JourneyUpdate = z.object({
  ...Object.fromEntries(Object.entries(JourneyFields).map(([k, v]) => [k, (v as z.ZodTypeAny).optional()])),
  status: z.enum(['planned', 'active', 'completed', 'cancelled']).optional(),
  items: z.array(Item).max(300).optional(),
}).strict();

const ListQuery = z.object({
  status: z.enum(['planned', 'active', 'completed', 'cancelled']).optional(),
}).strict();

const JOURNEY_COLUMNS = `id, title, destination_id, destination_name, latitude, longitude, start_date, end_date,
  travellers, budget, interests, status, created_at, updated_at`;

async function loadItems(tx: Tx, journeyId: string) {
  const { rows } = await tx.query(
    `select id, day_number, position, title, description, category, activity_type, latitude, longitude,
            planned_start, planned_duration_minutes
     from public.itinerary_items where journey_id = $1 order by day_number, position, created_at`,
    [journeyId],
  );
  return rows;
}

async function replaceItems(tx: Tx, journeyId: string, items: z.infer<typeof Item>[]) {
  await tx.query('delete from public.itinerary_items where journey_id = $1', [journeyId]);
  for (const it of items) {
    await tx.query(
      `insert into public.itinerary_items
         (journey_id, day_number, position, title, description, category, activity_type,
          latitude, longitude, planned_start, planned_duration_minutes)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [journeyId, it.day_number, it.position, it.title, it.description ?? null, it.category ?? null,
        it.activity_type, it.latitude ?? null, it.longitude ?? null, it.planned_start ?? null,
        it.planned_duration_minutes ?? null],
    );
  }
}

export function journeysRouter(db: Db) {
  const r = Router();

  r.get('/', route(async (req, res) => {
    const q = parse(ListQuery, req.query);
    const journeys = await withUser(db, req.user!.id, async tx => {
      const { rows } = await tx.query(
        `select ${JOURNEY_COLUMNS},
                (select count(*)::int from public.itinerary_items i where i.journey_id = j.id) as item_count
         from public.journeys j
         where user_id = auth.uid() and ($1::text is null or status = $1)
         order by start_date, created_at`,
        [q.status ?? null],
      );
      return rows;
    });
    res.json({ journeys });
  }));

  r.post('/', route(async (req, res) => {
    const body = parse(JourneyCreate, req.body);
    const journey = await withUser(db, req.user!.id, async tx => {
      const { rows } = await tx.query(
        `insert into public.journeys
           (user_id, title, destination_id, destination_name, latitude, longitude, start_date, end_date,
            travellers, budget, interests)
         values (auth.uid(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         returning ${JOURNEY_COLUMNS}`,
        [body.title ?? null, body.destination_id, body.destination_name, body.latitude ?? null,
          body.longitude ?? null, body.start_date, body.end_date, body.travellers, body.budget ?? null,
          body.interests],
      );
      await replaceItems(tx, rows[0].id, body.items);
      return { ...rows[0], items: await loadItems(tx, rows[0].id) };
    });
    res.status(201).json({ journey });
  }));

  r.get('/:id', route(async (req, res) => {
    const id = parse(UUID, req.params.id);
    const journey = await withUser(db, req.user!.id, async tx => {
      const { rows } = await tx.query(
        `select ${JOURNEY_COLUMNS} from public.journeys where id = $1 and user_id = auth.uid()`, [id]);
      return rows[0] ? { ...rows[0], items: await loadItems(tx, id) } : null;
    });
    if (!journey) throw new HttpError(404, 'not_found', 'Journey not found');
    res.json({ journey });
  }));

  r.put('/:id', route(async (req, res) => {
    const id = parse(UUID, req.params.id);
    const body = parse(JourneyUpdate, req.body) as Record<string, unknown> & { items?: z.infer<typeof Item>[] };
    const { items, ...fields } = body;
    const keys = Object.keys(fields);
    if (!keys.length && !items) throw new HttpError(400, 'validation_failed', 'Provide at least one field to update');

    const journey = await withUser(db, req.user!.id, async tx => {
      const { rows: current } = await tx.query(
        `select start_date, end_date, latitude, longitude from public.journeys where id = $1 and user_id = auth.uid()
         for update`, [id]);
      if (!current[0]) return null;
      const merged = { ...current[0], ...fields } as Record<string, any>;
      if (!datesOk(merged)) throw new HttpError(400, 'validation_failed', 'end_date must be on or after start_date');
      if (!coordsOk(merged)) throw new HttpError(400, 'validation_failed', 'latitude and longitude go together');

      if (keys.length) {
        await tx.query(
          `update public.journeys set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}
           where id = $1 and user_id = auth.uid()`,
          [id, ...keys.map(k => fields[k] ?? null)],
        );
      }
      if (items) await replaceItems(tx, id, items);
      const { rows } = await tx.query(`select ${JOURNEY_COLUMNS} from public.journeys where id = $1`, [id]);
      return { ...rows[0], items: await loadItems(tx, id) };
    });
    if (!journey) throw new HttpError(404, 'not_found', 'Journey not found');
    res.json({ journey });
  }));

  r.delete('/:id', route(async (req, res) => {
    const id = parse(UUID, req.params.id);
    const deleted = await withUser(db, req.user!.id, async tx => {
      const { rowCount } = await tx.query('delete from public.journeys where id = $1 and user_id = auth.uid()', [id]);
      return rowCount === 1;
    });
    if (!deleted) throw new HttpError(404, 'not_found', 'Journey not found');
    res.status(204).end();
  }));

  return r;
}
