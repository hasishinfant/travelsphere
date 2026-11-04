import { Router } from 'express';
import { z } from 'zod';
import type { Db } from '../db.js';
import { withUser } from '../db.js';
import { HttpError, parse, route } from '../http.js';

const PROFILE_COLUMNS = `id, email, full_name, home_airport, home_city, role, notification_preferences,
  location_consent, location_retention_days, created_at, updated_at`;

const ProfileUpdate = z
  .object({
    full_name: z.string().trim().min(1).max(120),
    home_airport: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Use a 3-letter IATA code').nullable(),
    home_city: z.string().trim().max(80).nullable(),
    location_consent: z.boolean(),
    location_retention_days: z.number().int().min(0).max(365),
  })
  .partial()
  .strict()
  .refine(v => Object.keys(v).length > 0, 'Provide at least one field to update');

const Preferences = z
  .object({
    in_app: z.boolean(),
    web_push: z.boolean(),
    min_risk_level: z.enum(['LOW', 'MODERATE', 'HIGH', 'CRITICAL']),
  })
  .partial()
  .strict();

export function profileRouter(db: Db) {
  const r = Router();

  r.get('/', route(async (req, res) => {
    const profile = await withUser(db, req.user!.id, async tx => {
      const { rows } = await tx.query(`select ${PROFILE_COLUMNS} from public.profiles where id = auth.uid()`);
      return rows[0];
    });
    if (!profile) throw new HttpError(404, 'profile_missing', 'Profile not found');
    res.json({ profile });
  }));

  r.put('/', route(async (req, res) => {
    const body = parse(ProfileUpdate, req.body);
    const keys = Object.keys(body) as (keyof typeof body)[];
    const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
    const profile = await withUser(db, req.user!.id, async tx => {
      const { rows } = await tx.query(
        `update public.profiles set ${sets} where id = auth.uid() returning ${PROFILE_COLUMNS}`,
        keys.map(k => body[k]),
      );
      return rows[0];
    });
    if (!profile) throw new HttpError(404, 'profile_missing', 'Profile not found');
    res.json({ profile });
  }));

  r.get('/preferences', route(async (req, res) => {
    const prefs = await withUser(db, req.user!.id, async tx => {
      const { rows } = await tx.query(`select notification_preferences from public.profiles where id = auth.uid()`);
      return rows[0]?.notification_preferences;
    });
    if (!prefs) throw new HttpError(404, 'profile_missing', 'Profile not found');
    res.json({ preferences: prefs });
  }));

  r.put('/preferences', route(async (req, res) => {
    const body = parse(Preferences, req.body);
    const prefs = await withUser(db, req.user!.id, async tx => {
      const { rows } = await tx.query(
        `update public.profiles set notification_preferences = notification_preferences || $1::jsonb
         where id = auth.uid() returning notification_preferences`,
        [JSON.stringify(body)],
      );
      return rows[0]?.notification_preferences;
    });
    res.json({ preferences: prefs });
  }));

  return r;
}
