import { Router } from 'express';
import { z } from 'zod';
import type { Db } from '../db.js';
import { withUser } from '../db.js';
import { HttpError, parse, route } from '../http.js';
import { PLACES, getPlace, type PlaceProfile } from '../data/places.js';
import type { WeatherService } from '../services/weather.js';
import { assess, type Assessment, type JourneyCtx, type ZoneHit } from '../services/riskEngine.js';
import type { RiskService } from '../integrations/riskService.js';
import { latestDestinationAssessment, storedToAssessment, toPlaceShape, weatherFromFactors } from '../services/assessments.js';

const HAVERSINE = (lat: string, lng: string) => `(2 * 6371000 * asin(sqrt(
  power(sin(radians(${lat} - $1) / 2), 2) +
  cos(radians($1)) * cos(radians(${lat})) * power(sin(radians(${lng} - $2) / 2), 2))))`;

async function zonesNear(db: Db, p: PlaceProfile): Promise<ZoneHit[]> {
  const { rows } = await db.query(
    `select name, hazard_type, severity, ${HAVERSINE('latitude', 'longitude')} as distance_m
     from public.risk_zones
     where active and (valid_from is null or valid_from <= now()) and (valid_to is null or valid_to > now())
       and abs(latitude - $1) < 1 and abs(longitude - $2) < 1
       and ${HAVERSINE('latitude', 'longitude')} <= radius_m + 2000`,
    [p.lat, p.lng],
  );
  return rows.map(r => ({ ...r, distance_m: Number(r.distance_m) }));
}

/** Aggregate count only — no individual incident data leaves the database. */
async function incidentsNear(db: Db, p: PlaceProfile): Promise<number | null> {
  try {
    const { rows } = await db.query(
      `select count(*)::int as n from public.incidents
       where latitude is not null and created_at > now() - interval '365 days'
         and abs(latitude - $1) < 0.5 and abs(longitude - $2) < 0.5
         and ${HAVERSINE('latitude', 'longitude')} <= 25000`,
      [p.lat, p.lng],
    );
    return rows[0].n;
  } catch {
    return null;
  }
}

async function journeyFor(db: Db, userId: string, placeId: string): Promise<JourneyCtx | null> {
  return withUser(db, userId, async tx => {
    const { rows } = await tx.query(
      `select j.id, j.destination_name, j.start_date, j.end_date,
              coalesce(array_agg(distinct i.activity_type) filter (where i.activity_type is not null), '{}') as activities
       from public.journeys j left join public.itinerary_items i on i.journey_id = j.id
       where j.user_id = auth.uid() and j.destination_id = $1 and j.status in ('planned', 'active')
         and j.end_date >= current_date
       group by j.id order by j.start_date limit 1`,
      [placeId],
    );
    const j = rows[0];
    if (!j) return null;
    const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
    return { startDate: j.start_date, endDate: j.end_date, activities: j.activities,
      label: `Your ${j.destination_name.split(',')[0]} journey, ${fmt(j.start_date)}–${fmt(j.end_date)}` };
  });
}

const summary = (a: Assessment) => ({
  place_id: a.placeId,
  risk_level: a.riskLevel,
  data_status: a.dataStatus,
  factors_available: a.factorsAvailable,
  headline: a.reasons[0],
  observed_at: a.observedAt,
  weather: a.weather,
});

const full = (a: Assessment) => ({
  ...summary(a),
  factors: a.factors,
  reasons: a.reasons,
  recommended_action: a.recommendedAction,
  observation_age_min: a.observationAgeMin,
  model_version: a.modelVersion,
  uncertainty: a.uncertainty,
  notice: 'Travel safety information only. Always follow official warnings and local emergency services.',
});

/** Legacy rule baseline (rules-v1) — used only when the risk-intelligence service is unreachable. */
async function legacy(db: Db, weather: WeatherService, userId: string, places: PlaceProfile[]) {
  const obs = await weather.observe(places);
  return Promise.all(places.map(async p => assess({
    place: p,
    observation: obs.get(p.id) ?? null,
    zones: await zonesNear(db, p),
    incidentCount: await incidentsNear(db, p),
    journey: await journeyFor(db, userId, p.id),
  })));
}

const legacyFull = (a: Assessment) => ({ ...full(a), engine: 'fallback',
  uncertainty: `${a.uncertainty}. Shown because the risk-intelligence service is unavailable.` });

export function placesRouter(db: Db, weather: WeatherService, risk?: RiskService, maxAgeMin = 30) {
  const r = Router();

  /** 8-factor engine result for one place in the place-card shape, or null if the engine is unreachable. */
  const engine = async (place: PlaceProfile) => {
    if (!risk) return null;
    try {
      const stored = await latestDestinationAssessment(db, place.id, maxAgeMin);
      if (stored) {
        const a = storedToAssessment(stored);
        return toPlaceShape(a as any, weatherFromFactors(stored.factors));
      }
      const fresh = await risk.assessDestination(place.id);
      return toPlaceShape(fresh as any, fresh.weather);
    } catch (err) {
      console.warn(`[places] risk service unavailable for ${place.id}: ${(err as Error).message}`);
      return null;
    }
  };

  // Compact meter data for every place (cards). Up to 3 places are assessed concurrently.
  r.get('/conditions', route(async (req, res) => {
    const results: (ReturnType<typeof toPlaceShape> | null)[] = new Array(PLACES.length).fill(null);
    let next = 0;
    await Promise.all(Array.from({ length: 3 }, async () => {
      while (next < PLACES.length) {
        const i = next++;
        results[i] = await engine(PLACES[i]);
      }
    }));
    const missing = PLACES.filter((_, i) => !results[i]);
    const fallback = missing.length ? await legacy(db, weather, req.user!.id, missing) : [];
    const places = PLACES.map((p, i) => {
      if (results[i]) {
        const { factors: _f, reasons: _r, recommended_action: _a, observation_age_min: _o, model_version: _m,
          uncertainty: _u, notice: _n, hazard_outlook: _h, ...summaryOnly } = results[i]!;
        return summaryOnly;
      }
      return summary(fallback[missing.indexOf(p)]);
    });
    const firstEngine = results.find(Boolean);
    res.json({ places, model_version: firstEngine?.model_version ?? fallback[0]?.modelVersion });
  }));

  // Full 8-factor assessment for one place
  r.get('/:id/assessment', route(async (req, res) => {
    const id = parse(z.string().regex(/^[a-z0-9-]{2,40}$/), req.params.id);
    const place = getPlace(id);
    if (!place) throw new HttpError(404, 'not_found', 'Unknown place');
    const shaped = await engine(place);
    if (shaped) return res.json({ assessment: shaped });

    const [a] = await legacy(db, weather, req.user!.id, [place]);
    if (a.riskLevel) {
      // Server-only write. Skip if an identical result was recorded in the last 15 minutes.
      await db.query(
        `insert into public.risk_assessments
           (user_id, place_id, latitude, longitude, risk_level, method, reasons, recommended_action, features,
            data_status, uncertainty, model_version, factors_available)
         select $1,$2,$3,$4,$5,'rules',$6,$7,$8,$9,$10,$11,$12
         where not exists (
           select 1 from public.risk_assessments
           where user_id = $1 and place_id = $2 and risk_level = $5 and data_status = $9
             and created_at > now() - interval '15 minutes')`,
        [req.user!.id, place.id, place.lat, place.lng, a.riskLevel, JSON.stringify(a.reasons), a.recommendedAction,
          JSON.stringify(Object.fromEntries(a.factors.map(f => [f.key, { value: f.value, status: f.status }]))),
          a.dataStatus, a.uncertainty, a.modelVersion, a.factorsAvailable],
      );
    }
    res.json({ assessment: legacyFull(a) });
  }));

  return r;
}
