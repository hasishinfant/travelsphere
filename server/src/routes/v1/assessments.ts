import { Router } from 'express';
import { z } from 'zod';
import type { Db } from '../../db.js';
import { withUser } from '../../db.js';
import { HttpError, parse, route } from '../../http.js';
import type { RiskService } from '../../integrations/riskService.js';
import { destinationExists, getOrAssessDestination } from '../../services/assessments.js';
import { Coordinate, DEST_ID, UUID, zonedIso } from './common.js';

const Activity = z.enum(['sightseeing', 'trekking', 'water', 'transit', 'dining', 'shopping', 'indoor', 'other']);
const EXPOSURE_ORDER = ['trekking', 'water', 'sightseeing', 'transit', 'other', 'shopping', 'dining', 'indoor'];

const DestinationBody = z.object({ destination_id: DEST_ID }).strict();

const JourneyBody = z.object({
  journey_id: UUID.optional(),
  destination_id: DEST_ID.optional(),
  origin: Coordinate.optional(),
  current_location: Coordinate.and(z.object({ accuracy_m: z.number().min(0).max(100_000).optional() })).optional(),
  waypoints: z.array(Coordinate).max(20).optional(),
  travel_start: z.string().datetime({ offset: true }).optional(),
  travel_end: z.string().datetime({ offset: true }).optional(),
  activity: Activity.optional(),
  activity_duration_minutes: z.number().int().min(0).max(1440).optional(),
  travellers: z.number().int().min(1).max(20).optional(),
  transport_mode: z.enum(['driving', 'foot']).optional(),
}).strict().refine(b => b.journey_id || b.destination_id, { message: 'Provide journey_id or destination_id', path: ['destination_id'] })
  .refine(b => b.journey_id || b.travel_start, { message: 'travel_start is required without a journey', path: ['travel_start'] });

export function assessmentsRouter(db: Db, risk: RiskService, maxAgeMin: number) {
  const r = Router();

  // Force a fresh destination assessment
  r.post('/destination', route(async (req, res) => {
    const { destination_id } = parse(DestinationBody, req.body);
    if (!(await destinationExists(db, destination_id))) throw new HttpError(404, 'not_found', 'Unknown destination');
    res.status(201).json({ assessment: await getOrAssessDestination(db, risk, destination_id, maxAgeMin, true) });
  }));

  // Journey-context assessment for the signed-in traveller
  r.post('/journey', route(async (req, res) => {
    const body = parse(JourneyBody, req.body);
    const userId = req.user!.id;

    const ctx = await withUser(db, userId, async tx => {
      const { rows: prof } = await tx.query(
        'select location_consent, location_retention_days from public.profiles where id = auth.uid()');
      let journey: any = null;
      let items: any[] = [];
      if (body.journey_id) {
        const { rows } = await tx.query(
          `select j.*, d.timezone from public.journeys j left join public.destinations d on d.id = j.destination_id
           where j.id = $1 and j.user_id = auth.uid()`, [body.journey_id]);
        journey = rows[0];
        if (!journey) throw new HttpError(404, 'not_found', 'Journey not found');
        if (journey.status === 'cancelled') throw new HttpError(409, 'journey_cancelled', 'This journey is cancelled');
        ({ rows: items } = await tx.query(
          `select day_number, position, activity_type, latitude, longitude from public.itinerary_items
           where journey_id = $1 order by day_number, position`, [body.journey_id]));
      }
      if (body.current_location) {
        if (!prof[0]?.location_consent) {
          throw new HttpError(403, 'location_consent_required', 'Enable location sharing in your profile to use your current location');
        }
        // Minimum necessary storage: only with a journey, only for the retention period the traveller chose
        const days = Number(prof[0].location_retention_days);
        if (journey && days > 0) {
          await tx.query(
            `insert into public.journey_locations (journey_id, user_id, latitude, longitude, accuracy_m, source, expires_at)
             values ($1, auth.uid(), $2, $3, $4, 'gps', now() + make_interval(days => $5))`,
            [journey.id, body.current_location.latitude, body.current_location.longitude,
              body.current_location.accuracy_m ?? null, days]);
        }
      }
      return { journey, items };
    });

    const { journey, items } = ctx;
    const destination_id = body.destination_id ?? journey.destination_id;
    if (journey && body.destination_id && body.destination_id !== journey.destination_id) {
      throw new HttpError(400, 'validation_failed', 'destination_id does not match the journey');
    }
    if (!(await destinationExists(db, destination_id))) {
      throw new HttpError(422, 'unsupported_destination', 'Safety assessment is not available for this destination yet');
    }

    let travel_start = body.travel_start;
    if (!travel_start) {
      // Default: 09:00 local on the first day of the journey, or now if the journey has started
      const local = zonedIso(journey.start_date, '09:00', journey.timezone);
      travel_start = new Date(Math.max(Date.parse(local), Date.now() + 5 * 60_000)).toISOString();
    }
    const startDay = journey ? Math.max(1, Math.floor((Date.parse(travel_start) - Date.parse(`${journey.start_date}T00:00:00Z`)) / 86_400_000) + 1) : null;
    const dayItems = items.filter(i => i.day_number === startDay);
    const waypoints = body.waypoints ?? dayItems.filter(i => i.latitude != null).slice(0, 20)
      .map(i => ({ latitude: i.latitude, longitude: i.longitude }));
    const activity = body.activity ?? (dayItems.length
      ? dayItems.map(i => i.activity_type).sort((a, b) => EXPOSURE_ORDER.indexOf(a) - EXPOSURE_ORDER.indexOf(b))[0]
      : undefined);

    const result = await risk.assessJourney({
      user_id: userId, journey_id: journey?.id ?? null, destination_id,
      origin: body.origin ?? null, current_location: body.current_location ?? null, waypoints,
      travel_start, travel_end: body.travel_end ?? null, activity, travellers: body.travellers ?? journey?.travellers ?? 1,
      activity_duration_minutes: body.activity_duration_minutes, transport_mode: body.transport_mode,
    });
    res.status(201).json({ assessment: result });
  }));

  // Explanation for any assessment the caller may see (destination: everyone; journey: owner/staff via RLS)
  r.get('/:id/explanation', route(async (req, res) => {
    const id = parse(UUID, req.params.id);
    const found = await withUser(db, req.user!.id, async tx => {
      const { rows: d } = await tx.query(
        `select 'destination' as type, id, destination_id, risk_category, assessment_status, explanation, scoring_version,
                assessed_at, null::jsonb as dimensions
         from public.destination_assessments where id = $1
         union all
         select 'journey', id, destination_id, risk_category, assessment_status, explanation, scoring_version, assessed_at,
                dimensions
         from public.journey_assessments where id = $1`, [id]);
      if (!d[0]) return null;
      const { rows: factors } = await tx.query(
        `select factor_key as key, status, value, severity_class, raw_value, unit, explanation, inputs, data_quality
         from public.factor_assessments where destination_assessment_id = $1 or journey_assessment_id = $1`, [id]);
      return { ...d[0], factors };
    });
    if (!found) throw new HttpError(404, 'not_found', 'Assessment not found');
    res.json({ assessment_id: id, ...found });
  }));

  return r;
}

export function journeyAssessmentRouter(db: Db) {
  const r = Router();
  r.get('/:id/assessment', route(async (req, res) => {
    const id = parse(UUID, req.params.id);
    const row = await withUser(db, req.user!.id, async tx => {
      const { rows: j } = await tx.query('select id from public.journeys where id = $1 and user_id = auth.uid()', [id]);
      if (!j[0]) return undefined;
      const { rows } = await tx.query(
        `select * from public.journey_assessments where journey_id = $1 order by assessed_at desc limit 1`, [id]);
      if (!rows[0]) return null;
      const { rows: factors } = await tx.query(
        `select factor_key as key, status, value, severity_class, raw_value, unit, explanation, inputs, data_quality,
                observed_at from public.factor_assessments where journey_assessment_id = $1`, [rows[0].id]);
      return { ...rows[0], factors };
    });
    if (row === undefined) throw new HttpError(404, 'not_found', 'Journey not found');
    if (row === null) throw new HttpError(404, 'not_assessed', 'This journey has not been assessed yet — POST /api/v1/assessments/journey');
    res.json({ assessment: row });
  }));
  return r;
}
