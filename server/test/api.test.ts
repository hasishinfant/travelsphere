import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { SignJWT } from 'jose';
import { loadConfig } from '../src/config.js';
import { createPool, type Db } from '../src/db.js';
import { createApp } from '../src/app.js';
import { HttpError } from '../src/http.js';
import type { RiskService } from '../src/integrations/riskService.js';

// Risk service that is up but cannot assess → /api/places uses the labelled rules-v1 fallback in these tests
const unavailable = () => Promise.reject(new HttpError(503, 'risk_service_unavailable', 'down'));
const stubRisk: RiskService = { health: async () => ({ status: 'ok' }), assessDestination: unavailable, assessJourney: unavailable };

const ADMIN_URL = process.env.TEST_ADMIN_DATABASE_URL || 'postgres://localhost:5432/postgres';
const DB_URL = ADMIN_URL.replace(/\/[^/]*$/, '/travelsphere_api_test');
const SECRET = 'test-secret-that-is-at-least-32-characters-long';

const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: DB_URL, AUTH_MODE: 'local', LOCAL_JWT_SECRET: SECRET });
let db: Db;
let app: ReturnType<typeof createApp>;

const signIn = async (email: string, full_name?: string) => {
  const res = await request(app).post('/api/auth/dev-session').send({ email, full_name });
  expect(res.status).toBe(201);
  return { token: res.body.token as string, id: res.body.user.id as string };
};
const as = (token: string) => ({ Authorization: `Bearer ${token}` });

const paris = {
  destination_id: 'paris',
  destination_name: 'Paris, France',
  latitude: 48.8584,
  longitude: 2.2945,
  start_date: '2027-03-10',
  end_date: '2027-03-14',
  travellers: 2,
  budget: 'medium',
  interests: ['culture', 'food'],
  items: [
    { day_number: 1, position: 0, title: 'Eiffel Tower', category: 'culture', latitude: 48.8584, longitude: 2.2945 },
    { day_number: 1, position: 1, title: 'Seine River Cruise', activity_type: 'water' },
    { day_number: 2, title: 'Louvre Museum', activity_type: 'indoor' },
  ],
};

beforeAll(() => {
  db = createPool(DB_URL);
  app = createApp(config, db, undefined, undefined, stubRisk);
});
afterAll(async () => {
  await db.end();
});

describe('configuration', () => {
  it('refuses local dev auth in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', DATABASE_URL: DB_URL, AUTH_MODE: 'local', LOCAL_JWT_SECRET: SECRET }))
      .toThrow(/refused when NODE_ENV=production/);
  });
  it('requires Supabase settings in supabase mode', () => {
    expect(() => loadConfig({ DATABASE_URL: DB_URL, AUTH_MODE: 'supabase' })).toThrow(/SUPABASE_URL/);
  });
});

describe('health', () => {
  it('reports database and auth mode', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', auth_mode: 'local', database: 'connected' });
  });
  it('404s unknown endpoints with a JSON error', async () => {
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });
});

describe('authentication', () => {
  it('rejects requests without a token', async () => {
    const res = await request(app).get('/api/journeys');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthenticated');
  });
  it('rejects a token signed with a different secret', async () => {
    const forged = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' })
      .setSubject('00000000-0000-0000-0000-000000000001').setIssuer('travelsphere-local-dev').setExpirationTime('1h')
      .sign(new TextEncoder().encode('another-secret-another-secret-another-secret'));
    const res = await request(app).get('/api/profile').set(as(forged));
    expect(res.status).toBe(401);
  });
  it('validates the dev-session payload', async () => {
    const res = await request(app).post('/api/auth/dev-session').send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].field).toBe('email');
  });
  it('returns the same user for the same email', async () => {
    const a = await signIn('same@test.local');
    const b = await signIn('same@test.local');
    expect(a.id).toBe(b.id);
  });
});

describe('profile', () => {
  it('creates a profile on sign-in and returns it', async () => {
    const { token } = await signIn('noora@test.local', 'Noora Lindqvist');
    const res = await request(app).get('/api/profile').set(as(token));
    expect(res.status).toBe(200);
    expect(res.body.profile).toMatchObject({ email: 'noora@test.local', full_name: 'Noora Lindqvist', role: 'traveller' });
  });
  it('updates allowed fields and normalises the airport code', async () => {
    const { token } = await signIn('update@test.local');
    const res = await request(app).put('/api/profile').set(as(token)).send({ home_airport: 'yvr', home_city: 'Vancouver' });
    expect(res.status).toBe(200);
    expect(res.body.profile).toMatchObject({ home_airport: 'YVR', home_city: 'Vancouver' });
  });
  it('does not let a traveller change their role', async () => {
    const { token } = await signIn('escalate@test.local');
    const res = await request(app).put('/api/profile').set(as(token)).send({ role: 'admin' });
    expect(res.status).toBe(400);
    const after = await request(app).get('/api/profile').set(as(token));
    expect(after.body.profile.role).toBe('traveller');
  });
  it('rejects invalid values', async () => {
    const { token } = await signIn('invalid@test.local');
    const res = await request(app).put('/api/profile').set(as(token)).send({ home_airport: 'LONDON' });
    expect(res.status).toBe(400);
  });
  it('merges notification preferences', async () => {
    const { token } = await signIn('prefs@test.local');
    const res = await request(app).put('/api/profile/preferences').set(as(token)).send({ web_push: true });
    expect(res.status).toBe(200);
    expect(res.body.preferences).toEqual({ in_app: true, web_push: true, min_risk_level: 'MODERATE' });
    const bad = await request(app).put('/api/profile/preferences').set(as(token)).send({ min_risk_level: 'EXTREME' });
    expect(bad.status).toBe(400);
  });
});

describe('journeys', () => {
  it('creates, lists, reads, updates and deletes a journey with itinerary items', async () => {
    const { token } = await signIn('traveller@test.local');

    const created = await request(app).post('/api/journeys').set(as(token)).send(paris);
    expect(created.status).toBe(201);
    const j = created.body.journey;
    expect(j).toMatchObject({ destination_id: 'paris', start_date: '2027-03-10', end_date: '2027-03-14', status: 'planned' });
    expect(j.items.map((i: { title: string }) => i.title)).toEqual(['Eiffel Tower', 'Seine River Cruise', 'Louvre Museum']);

    const list = await request(app).get('/api/journeys').set(as(token));
    expect(list.body.journeys).toHaveLength(1);
    expect(list.body.journeys[0].item_count).toBe(3);

    const upd = await request(app).put(`/api/journeys/${j.id}`).set(as(token))
      .send({ status: 'cancelled', items: [{ day_number: 1, title: 'Montmartre' }] });
    expect(upd.status).toBe(200);
    expect(upd.body.journey.status).toBe('cancelled');
    expect(upd.body.journey.items).toHaveLength(1);

    const filtered = await request(app).get('/api/journeys?status=planned').set(as(token));
    expect(filtered.body.journeys).toHaveLength(0);

    expect((await request(app).delete(`/api/journeys/${j.id}`).set(as(token))).status).toBe(204);
    expect((await request(app).get(`/api/journeys/${j.id}`).set(as(token))).status).toBe(404);
  });

  it('validates dates, coordinates and ids', async () => {
    const { token } = await signIn('validation@test.local');
    const backwards = await request(app).post('/api/journeys').set(as(token)).send({ ...paris, end_date: '2027-03-01' });
    expect(backwards.status).toBe(400);
    const halfCoords = await request(app).post('/api/journeys').set(as(token)).send({ ...paris, longitude: undefined });
    expect(halfCoords.status).toBe(400);
    const badDate = await request(app).post('/api/journeys').set(as(token)).send({ ...paris, start_date: '2027-02-30' });
    expect(badDate.status).toBe(400);
    const unknownField = await request(app).post('/api/journeys').set(as(token)).send({ ...paris, user_id: 'x' });
    expect(unknownField.status).toBe(400);
    expect((await request(app).get('/api/journeys/not-a-uuid').set(as(token))).status).toBe(400);

    const ok = await request(app).post('/api/journeys').set(as(token)).send(paris);
    const moved = await request(app).put(`/api/journeys/${ok.body.journey.id}`).set(as(token)).send({ start_date: '2027-04-01' });
    expect(moved.status).toBe(400); // would end before it starts
  });

  it('keeps journeys private between travellers', async () => {
    const alice = await signIn('alice@test.local');
    const bob = await signIn('bob@test.local');
    const created = await request(app).post('/api/journeys').set(as(alice.token)).send(paris);
    const id = created.body.journey.id;

    expect((await request(app).get(`/api/journeys/${id}`).set(as(bob.token))).status).toBe(404);
    expect((await request(app).put(`/api/journeys/${id}`).set(as(bob.token)).send({ title: 'mine now' })).status).toBe(404);
    expect((await request(app).delete(`/api/journeys/${id}`).set(as(bob.token))).status).toBe(404);
    expect((await request(app).get('/api/journeys').set(as(bob.token))).body.journeys).toHaveLength(0);

    const still = await request(app).get(`/api/journeys/${id}`).set(as(alice.token));
    expect(still.status).toBe(200);
    expect(still.body.journey.title).toBeNull();
  });
});

// ---------------------------------------------------------------- places / safety assessments
import { WeatherService, type FetchLike } from '../src/services/weather.js';
import { PLACES } from '../src/data/places.js';

const meteo = (over: Record<string, unknown> = {}) => ({
  utc_offset_seconds: 0, timezone: 'UTC',
  current: { time: new Date(Date.now() - 5 * 60_000).toISOString().slice(0, 16), interval: 900, temperature_2m: 18,
    precipitation: 0, weather_code: 1, wind_gusts_10m: 5, is_day: 1, visibility: 30000, ...over },
  hourly: { precipitation: [0, 0], wind_gusts_10m: [5, 6] },
  daily: { sunset: [new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 16)] },
});

describe('places — 8-factor safety assessments', () => {
  const fetchOk: FetchLike = async url => {
    const n = new URL(url).searchParams.get('latitude')!.split(',').length;
    // Paris gets heavy rain (2.75 mm per 15 min = 11 mm/h); everywhere else is calm
    const list = Array.from({ length: n }, (_, i) => (PLACES[i]?.id === 'paris' && n > 1) || n === 1
      ? meteo({ precipitation: 2.75, weather_code: 65 }) : meteo());
    return { ok: true, status: 200, json: async () => (n === 1 ? list[0] : list) };
  };
  const fetchDown: FetchLike = async () => ({ ok: false, status: 503, json: async () => ({}) });

  it('requires authentication', async () => {
    expect((await request(app).get('/api/places/conditions')).status).toBe(401);
  });

  it('returns a meter summary for every place from live conditions', async () => {
    const appOk = createApp(config, db, undefined, new WeatherService(db, fetchOk), stubRisk);
    const { token } = await signIn('meter@test.local');
    const res = await request(appOk).get('/api/places/conditions').set(as(token));
    expect(res.status).toBe(200);
    expect(res.body.places).toHaveLength(PLACES.length);
    const paris = res.body.places.find((p: { place_id: string }) => p.place_id === 'paris');
    expect(paris).toMatchObject({ risk_level: 'MODERATE', factors_available: 6, data_status: 'PARTIAL' });
    expect(paris.headline).toMatch(/Heavy rain/);
    const tokyo = res.body.places.find((p: { place_id: string }) => p.place_id === 'tokyo');
    expect(tokyo.risk_level).toBe('LOW');
  });

  it('uses the traveller’s own journey: trekking in Paris today raises the same rain to HIGH', async () => {
    const appOk = createApp(config, db, undefined, new WeatherService(db, fetchOk), stubRisk);
    const { token } = await signIn('trekker@test.local');
    const today = new Date().toISOString().slice(0, 10);
    await request(appOk).post('/api/journeys').set(as(token)).send({
      ...paris, start_date: today, end_date: today,
      items: [{ day_number: 1, title: 'Seine riverside walk', activity_type: 'trekking' }],
    });
    const res = await request(appOk).get('/api/places/paris/assessment').set(as(token));
    expect(res.status).toBe(200);
    const a = res.body.assessment;
    expect(a.risk_level).toBe('HIGH');
    expect(a.factors_available).toBe(8);
    expect(a.factors).toHaveLength(8);
    expect(a.factors.find((f: { key: string }) => f.key === 'journey_context').status).toBe('derived');
    expect(a.model_version).toBe('rules-v1');
    expect(a.notice).toMatch(/official warnings/);
  });

  it('records the assessment once (deduplicated within 15 minutes)', async () => {
    const appOk = createApp(config, db, undefined, new WeatherService(db, fetchOk), stubRisk);
    const { token, id } = await signIn('recorder@test.local');
    await request(appOk).get('/api/places/kyoto/assessment').set(as(token));
    await request(appOk).get('/api/places/kyoto/assessment').set(as(token));
    const { rows } = await db.query(`select risk_level, method, model_version, factors_available from public.risk_assessments
      where user_id = $1 and place_id = 'kyoto'`, [id]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ method: 'rules', model_version: 'rules-v1' });
  });

  it('provider down and nothing stored → no risk level, status UNAVAILABLE', async () => {
    await db.query(`delete from public.environment_observations where place_id = 'bali'`);
    const appDown = createApp(config, db, undefined, new WeatherService(db, fetchDown), stubRisk);
    const { token } = await signIn('outage@test.local');
    const res = await request(appDown).get('/api/places/bali/assessment').set(as(token));
    expect(res.status).toBe(200);
    expect(res.body.assessment).toMatchObject({ risk_level: null, data_status: 'UNAVAILABLE' });
  });

  it('provider down but a recent observation is stored → served from the database', async () => {
    const { token } = await signIn('fallback@test.local');
    await request(createApp(config, db, undefined, new WeatherService(db, fetchOk), stubRisk)).get('/api/places/rome/assessment').set(as(token));
    const res = await request(createApp(config, db, undefined, new WeatherService(db, fetchDown), stubRisk))
      .get('/api/places/rome/assessment').set(as(token));
    expect(res.body.assessment.risk_level).toBe('LOW');
    expect(res.body.assessment.observed_at).not.toBeNull();
  });

  it('404s an unknown place and rejects malformed ids', async () => {
    const { token } = await signIn('unknown-place@test.local');
    expect((await request(app).get('/api/places/atlantis/assessment').set(as(token))).status).toBe(404);
    expect((await request(app).get('/api/places/DROP%20TABLE/assessment').set(as(token))).status).toBe(400);
  });
});
