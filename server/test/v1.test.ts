import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { loadConfig } from '../src/config.js';
import { createPool, type Db } from '../src/db.js';
import { createApp } from '../src/app.js';
import { HttpError } from '../src/http.js';
import { createRiskService, DestinationAssessmentSchema, type JourneyAssessmentInput, type RiskService }
  from '../src/integrations/riskService.js';
import { dispatchPending, type PushSender } from '../src/integrations/fcm.js';
import { toPlaceShape } from '../src/services/assessments.js';
import { zonedIso } from '../src/routes/v1/common.js';

const ADMIN_URL = process.env.TEST_ADMIN_DATABASE_URL || 'postgres://localhost:5432/postgres';
const DB_URL = ADMIN_URL.replace(/\/[^/]*$/, '/travelsphere_api_test');
const SECRET = 'test-secret-that-is-at-least-32-characters-long';
const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: DB_URL, AUTH_MODE: 'local', LOCAL_JWT_SECRET: SECRET });

// A real assessment captured from the Python service (Kyoto) — the contract the client validates
const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/destination-assessment.json', import.meta.url), 'utf8'));

let db: Db;
let app: ReturnType<typeof createApp>;
const journeyCalls: JourneyAssessmentInput[] = [];
const fakeRisk: RiskService = {
  health: async () => ({ status: 'ok', engine_version: 'test' }),
  assessDestination: async id => {
    if (id === 'santorini') throw new HttpError(503, 'risk_service_unavailable', 'down');
    return DestinationAssessmentSchema.parse({ ...FIXTURE, destination_id: id, destination: { ...FIXTURE.destination, id } });
  },
  assessJourney: async input => {
    journeyCalls.push(input);
    return { ...FIXTURE, journey_id: input.journey_id ?? null, user_id: input.user_id, destination_id: input.destination_id,
      dimensions: { hazard: {}, exposure: {}, journey_context: {}, response_accessibility: { class: 'adequate' } },
      route: null, safer_route: { available: false }, activity: input.activity ?? 'sightseeing',
      travellers: input.travellers ?? 1, travel_start: input.travel_start, travel_end: input.travel_start } as any;
  },
};

const signIn = async (email: string) => {
  const res = await request(app).post('/api/auth/dev-session').send({ email });
  return { token: res.body.token as string, id: res.body.user.id as string };
};
const as = (t: string) => ({ Authorization: `Bearer ${t}` });
const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

beforeAll(() => {
  db = createPool(DB_URL);
  app = createApp(config, db, undefined, undefined, fakeRisk);
});
afterAll(async () => { await db.end(); });

describe('v1 authentication', () => {
  it.each(['/api/v1/destinations', '/api/v1/incidents', '/api/v1/alerts', '/api/v1/destinations/paris/safety'])(
    '%s requires a token', async path => {
      const res = await request(app).get(path);
      expect(res.status).toBe(401);
    });
  it('health reports the risk service', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.risk_service).toMatchObject({ status: 'ok' });
  });
});

describe('destinations', () => {
  it('lists the seeded destinations', async () => {
    const { token } = await signIn('dest@example.test');
    const res = await request(app).get('/api/v1/destinations').set(as(token));
    expect(res.status).toBe(200);
    expect(res.body.destinations.map((d: any) => d.id)).toContain('kyoto');
  });
  it('returns safety and the eight factors', async () => {
    const { token } = await signIn('dest@example.test');
    const safety = await request(app).get('/api/v1/destinations/kyoto/safety').set(as(token));
    expect(safety.status).toBe(200);
    expect(safety.body.assessment).toMatchObject({ destination_id: 'kyoto', scoring_version: 'scoring-v1' });
    expect(safety.body.assessment.explanation.disclaimer).toMatch(/not the probability/);
    const factors = await request(app).get('/api/v1/destinations/kyoto/factors').set(as(token));
    expect(factors.body.factors).toHaveLength(8);
    expect(factors.body.factors.find((f: any) => f.key === 'route_exposure').status).toBe('not_applicable');
  });
  it('404s an unknown destination and 400s a malformed id', async () => {
    const { token } = await signIn('dest@example.test');
    expect((await request(app).get('/api/v1/destinations/atlantis/safety').set(as(token))).status).toBe(404);
    expect((await request(app).get('/api/v1/destinations/NOT_VALID!/safety').set(as(token))).status).toBe(400);
  });
  it('surfaces risk-service failure as 503, never as a safe result', async () => {
    const { token } = await signIn('dest@example.test');
    const res = await request(app).get('/api/v1/destinations/santorini/safety').set(as(token));
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('risk_service_unavailable');
  });
  it('serves a fresh stored assessment without calling the engine, and paginates history', async () => {
    const { token } = await signIn('dest@example.test');
    const { rows } = await db.query(
      `insert into public.destination_assessments (destination_id, risk_category, composite_index, assessment_status,
         data_coverage, data_reliability, explanation, scoring_version, engine_version, inputs_hash)
       values ('santorini', 'MODERATE', 0.3, 'COMPLETE', 1, 0.9, $1, 'scoring-v1', 'test', 'h') returning id`,
      [JSON.stringify(FIXTURE.explanation)]);
    for (const f of FIXTURE.factors) {
      await db.query(`insert into public.factor_assessments (destination_assessment_id, factor_key, status, value, explanation, inputs)
                      values ($1, $2, $3, $4, $5, $6)`, [rows[0].id, f.key, f.status, f.value, f.explanation, JSON.stringify(f.inputs)]);
    }
    for (let i = 0; i < 3; i++) {
      await db.query(`insert into public.assessment_history (subject_type, destination_id, assessment_id, risk_category,
        assessment_status, scoring_version, assessed_at) values ('destination', 'santorini', $1, 'MODERATE', 'COMPLETE', 'scoring-v1',
        now() - make_interval(hours => $2))`, [rows[0].id, i]);
    }
    const res = await request(app).get('/api/v1/destinations/santorini/safety').set(as(token)); // engine would 503 for santorini
    expect(res.status).toBe(200);
    expect(res.body.assessment).toMatchObject({ risk_category: 'MODERATE', source: 'stored' });
    const hist = await request(app).get('/api/v1/destinations/santorini/history?limit=2').set(as(token));
    expect(hist.body.history).toHaveLength(2);
    expect(hist.body.page.next_offset).toBe(2);
    const expl = await request(app).get(`/api/v1/assessments/${rows[0].id}/explanation`).set(as(token));
    expect(expl.status).toBe(200);
    expect(expl.body).toMatchObject({ type: 'destination', risk_category: 'MODERATE' });
    expect(expl.body.factors).toHaveLength(8);
  });
});

describe('journey assessment', () => {
  const journey = { destination_id: 'kyoto', destination_name: 'Kyoto, Japan', start_date: tomorrow(), end_date: tomorrow(),
    travellers: 3, items: [
      { day_number: 1, title: 'Fushimi Inari hike', activity_type: 'trekking', latitude: 34.9671, longitude: 135.7727 },
      { day_number: 1, title: 'Lunch', activity_type: 'dining', latitude: 34.99, longitude: 135.77 }] };

  it('derives destination, party, activity and waypoints from the stored journey', async () => {
    const u = await signIn('trav@example.test');
    const j = await request(app).post('/api/journeys').set(as(u.token)).send(journey);
    const res = await request(app).post('/api/v1/assessments/journey').set(as(u.token))
      .send({ journey_id: j.body.journey.id, origin: { latitude: 34.9858, longitude: 135.7588 } });
    expect(res.status).toBe(201);
    const call = journeyCalls.at(-1)!;
    expect(call).toMatchObject({ user_id: u.id, destination_id: 'kyoto', travellers: 3, activity: 'trekking' });
    expect(call.waypoints).toHaveLength(2);
    expect(Date.parse(call.travel_start)).toBeGreaterThan(Date.now());
  });
  it("cannot assess another traveller's journey", async () => {
    const a = await signIn('owner@example.test');
    const b = await signIn('intruder@example.test');
    const j = await request(app).post('/api/journeys').set(as(a.token)).send(journey);
    const res = await request(app).post('/api/v1/assessments/journey').set(as(b.token)).send({ journey_id: j.body.journey.id });
    expect(res.status).toBe(404);
  });
  it('requires location consent for the current location, then stores it with an expiry', async () => {
    const u = await signIn('gps@example.test');
    const j = await request(app).post('/api/journeys').set(as(u.token)).send(journey);
    const body = { journey_id: j.body.journey.id, current_location: { latitude: 34.98, longitude: 135.76, accuracy_m: 12 } };
    const denied = await request(app).post('/api/v1/assessments/journey').set(as(u.token)).send(body);
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('location_consent_required');
    await request(app).put('/api/profile').set(as(u.token)).send({ location_consent: true, location_retention_days: 7 });
    expect((await request(app).post('/api/v1/assessments/journey').set(as(u.token)).send(body)).status).toBe(201);
    const { rows } = await db.query(`select expires_at - recorded_at as ttl from public.journey_locations where user_id = $1`, [u.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].ttl.days).toBe(7);
  });
  it('validates the request', async () => {
    const u = await signIn('trav@example.test');
    const bad = await request(app).post('/api/v1/assessments/journey').set(as(u.token))
      .send({ destination_id: 'kyoto', origin: { latitude: 0, longitude: 0 }, travel_start: new Date().toISOString() });
    expect(bad.status).toBe(400);
    const noStart = await request(app).post('/api/v1/assessments/journey').set(as(u.token)).send({ destination_id: 'kyoto' });
    expect(noStart.status).toBe(400);
    const unknown = await request(app).post('/api/v1/assessments/journey').set(as(u.token))
      .send({ destination_id: 'kyoto', travel_start: new Date().toISOString(), hack: true });
    expect(unknown.status).toBe(400);
  });
});

describe('incidents', () => {
  const report = { category: 'natural_hazard', hazard_type: 'flood', title: 'Road flooded near the river', latitude: 34.99,
    longitude: 135.77, destination_id: 'kyoto' };

  it('travellers create and read their own incidents; SOS is critical', async () => {
    const u = await signIn('reporter@example.test');
    const res = await request(app).post('/api/v1/incidents').set(as(u.token)).send(report);
    expect(res.status).toBe(201);
    expect(res.body.incident).toMatchObject({ status: 'open', priority: 'normal', verified: false });
    const sos = await request(app).post('/api/v1/incidents').set(as(u.token)).send({ category: 'medical', title: 'SOS', is_sos: true });
    expect(sos.body.incident.priority).toBe('critical');
    const one = await request(app).get(`/api/v1/incidents/${res.body.incident.id}`).set(as(u.token));
    expect(one.status).toBe(200);
    expect(one.body.incident.updates).toEqual([]);
  });
  it('other travellers cannot see it, list all, or change status', async () => {
    const u = await signIn('reporter2@example.test');
    const other = await signIn('nosy@example.test');
    const inc = (await request(app).post('/api/v1/incidents').set(as(u.token)).send(report)).body.incident;
    expect((await request(app).get(`/api/v1/incidents/${inc.id}`).set(as(other.token))).status).toBe(404);
    expect((await request(app).get('/api/v1/incidents?scope=all').set(as(other.token))).status).toBe(403);
    expect((await request(app).patch(`/api/v1/incidents/${inc.id}/status`).set(as(u.token)).send({ status: 'resolved' })).status).toBe(403);
  });
  it('responders move incidents through valid transitions, verify them and notify the reporter', async () => {
    const u = await signIn('reporter3@example.test');
    const r = await signIn('responder@example.test');
    await db.query(`update public.profiles set role = 'responder' where id = $1`, [r.id]);
    const inc = (await request(app).post('/api/v1/incidents').set(as(u.token)).send(report)).body.incident;
    const ack = await request(app).patch(`/api/v1/incidents/${inc.id}/status`).set(as(r.token))
      .send({ status: 'acknowledged', verified: true, note: 'Confirmed by local police' });
    expect(ack.status).toBe(200);
    expect(ack.body.incident).toMatchObject({ status: 'acknowledged', verified: true });
    expect((await request(app).patch(`/api/v1/incidents/${inc.id}/status`).set(as(r.token)).send({ status: 'closed' })).status).toBe(200);
    const reopen = await request(app).patch(`/api/v1/incidents/${inc.id}/status`).set(as(r.token)).send({ status: 'open' });
    expect(reopen.status).toBe(409);
    expect(reopen.body.error.code).toBe('invalid_transition');
    const all = await request(app).get('/api/v1/incidents?scope=all').set(as(r.token));
    expect(all.body.incidents.some((i: any) => i.id === inc.id)).toBe(true);
    const seen = await request(app).get(`/api/v1/incidents/${inc.id}`).set(as(u.token));
    expect(seen.body.incident.updates.map((x: any) => x.status)).toEqual(['acknowledged', 'closed']);
    const { rows } = await db.query(`select count(*)::int as n from public.notifications where user_id = $1 and kind = 'incident_update'`, [u.id]);
    expect(rows[0].n).toBe(2);
  });
  it('rejects invalid reports', async () => {
    const u = await signIn('reporter@example.test');
    expect((await request(app).post('/api/v1/incidents').set(as(u.token)).send({ ...report, latitude: 95 })).status).toBe(400);
    expect((await request(app).post('/api/v1/incidents').set(as(u.token)).send({ ...report, longitude: undefined })).status).toBe(400);
    expect((await request(app).post('/api/v1/incidents').set(as(u.token)).send({ ...report, status: 'resolved' })).status).toBe(400);
  });
});

describe('alerts', () => {
  it('lists own and destination-wide alerts only; acknowledges own; deduplicates active alerts', async () => {
    const me = await signIn('alerts-me@example.test');
    const other = await signIn('alerts-other@example.test');
    const ins = (user: string | null, key: string) => db.query(
      `insert into public.safety_alerts (user_id, destination_id, level, title, body, recommended_action, dedup_key, expires_at)
       values ($1, 'kyoto', 'HIGH', 'Heavy rain', 'Body', 'Avoid riverbanks', $2, now() + interval '2 hours') returning id`,
      [user, key]);
    const mine = (await ins(me.id, 'k1')).rows[0].id;
    await ins(null, 'broadcast-1');
    await ins(other.id, 'k2');
    await expect(ins(me.id, 'k1')).rejects.toThrow(/duplicate key/);
    const list = await request(app).get('/api/v1/alerts').set(as(me.token));
    expect(list.body.alerts.map((a: any) => a.destination_wide).sort()).toEqual([false, true]);
    const ack = await request(app).post(`/api/v1/alerts/${mine}/acknowledge`).set(as(me.token));
    expect(ack.body.alert.status).toBe('acknowledged');
    const theirs = (await db.query(`select id from public.safety_alerts where user_id = $1`, [other.id])).rows[0].id;
    expect((await request(app).post(`/api/v1/alerts/${theirs}/acknowledge`).set(as(me.token))).status).toBe(404);
  });
});

describe('risk-service client', () => {
  const cfg = { RISK_SERVICE_URL: 'http://risk.test', RISK_SERVICE_TOKEN: 'x'.repeat(40), RISK_SERVICE_TIMEOUT_MS: 50 };
  it('sends the service token and validates responses', async () => {
    let auth = '';
    const ok = createRiskService(cfg, (async (_u: any, init: any) => { auth = init.headers.Authorization;
      return new Response(JSON.stringify(FIXTURE), { status: 200 }); }) as any);
    await expect(ok.assessDestination('kyoto')).resolves.toMatchObject({ destination_id: 'kyoto' });
    expect(auth).toBe(`Bearer ${'x'.repeat(40)}`);
  });
  it('rejects malformed responses as 502 and times out as 504', async () => {
    const bad = createRiskService(cfg, (async () => new Response(JSON.stringify({ ...FIXTURE, factors: [] }), { status: 200 })) as any);
    await expect(bad.assessDestination('kyoto')).rejects.toMatchObject({ status: 502, code: 'risk_service_invalid_response' });
    const slow = createRiskService(cfg, ((_u: any, init: any) => new Promise((_, rej) =>
      init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))))) as any);
    await expect(slow.assessDestination('kyoto')).rejects.toMatchObject({ status: 504 });
    const down = createRiskService(cfg, (async () => { throw new TypeError('fetch failed'); }) as any);
    await expect(down.assessDestination('kyoto')).rejects.toMatchObject({ status: 503 });
  });
});

describe('place-card mapping', () => {
  it('never draws data reliability as a risk bar and labels journey-only factors', () => {
    const shaped = toPlaceShape(FIXTURE, FIXTURE.weather);
    expect(shaped.factors).toHaveLength(8);
    expect(shaped.factors.find(f => f.key === 'data_reliability')).toMatchObject({ value: null });
    expect(shaped.factors.find(f => f.key === 'route_exposure')).toMatchObject({ value: null, status: 'unavailable' });
    expect(shaped.model_version).toMatch(/^scoring-v1/);
    expect(shaped.hazard_outlook).toBeNull();                 // assessments from before the climatologies
  });
  it('passes the cyclone and flood outlook through, dropping malformed entries', () => {
    const outlook = (p: number) => ({ p_period: p, period_days: 7, scope: 'destination', period_start: '2026-11-23T00:00:00Z',
      period_end: '2026-11-30T00:00:00Z', p_week: p, annual_rate: 0.5, peak_week_start: '20 Aug', p_peak_week: 0.05,
      monthly_p_week: Array(12).fill(0.01), years: [1985, 2021], model: 'dfo-climatology', definition: 'x' });
    const withInputs = (inputs: Record<string, unknown>) => ({ ...FIXTURE, factors: FIXTURE.factors.map((f: any) =>
      f.key === 'historical_incident_risk' ? { ...f, inputs: { ...f.inputs, ...inputs } } : f) });
    const shaped = toPlaceShape(withInputs({ flood: outlook(0.02), cyclone: null,
      climatology_unavailable: { cyclone: 'outside the cyclone climatology\'s area' } }), null);
    expect(shaped.hazard_outlook).toMatchObject({ flood: { p_period: 0.02, peak_week_start: '20 Aug' }, cyclone: null,
      unavailable: { cyclone: expect.stringContaining('outside') } });
    // a probability above 1 or a short monthly profile is not shown
    const bad = toPlaceShape(withInputs({ flood: { ...outlook(1.5) }, cyclone: { ...outlook(0.1), monthly_p_week: [0.1] } }), null);
    expect(bad.hazard_outlook).toBeNull();
  });
  it('/api/places serves the engine result when available', async () => {
    const { token } = await signIn('places@example.test');
    const res = await request(app).get('/api/places/kyoto/assessment').set(as(token));
    expect(res.status).toBe(200);
    expect(res.body.assessment.model_version).toMatch(/^scoring-v1/);
  });
});

describe('push dispatch', () => {
  it('sends pending warnings to opted-in users and drops invalid tokens', async () => {
    const u = await signIn('push@example.test');
    await db.query(`update public.profiles set notification_preferences = '{"in_app": true, "web_push": true, "min_risk_level": "HIGH"}' where id = $1`, [u.id]);
    await db.query(`insert into public.device_tokens (user_id, platform, token) values ($1, 'fcm', 'good-token-123'), ($1, 'fcm', 'dead-token-456')`, [u.id]);
    await db.query(`insert into public.notifications (user_id, kind, title, body, risk_level) values
      ($1, 'risk_warning', 'High risk', 'b', 'HIGH'), ($1, 'risk_warning', 'Moderate', 'b', 'MODERATE')`, [u.id]);
    const sent: string[] = [];
    const sender: PushSender = { send: async token => { sent.push(token); return token.startsWith('dead') ? 'invalid_token' : 'sent'; } };
    const r = await dispatchPending(db, sender);
    expect(r.sent).toBeGreaterThanOrEqual(1);
    expect(sent).toEqual(['good-token-123', 'dead-token-456']); // MODERATE is below the user's minimum
    const { rows } = await db.query(`select token from public.device_tokens where user_id = $1`, [u.id]);
    expect(rows.map(x => x.token)).toEqual(['good-token-123']);
  });
});

describe('helpers', () => {
  it('converts destination wall-clock time to UTC', () => {
    expect(zonedIso('2027-01-15', '09:00', 'Asia/Tokyo')).toBe('2027-01-15T00:00:00.000Z');
    expect(zonedIso('2027-07-15', '09:00', 'Europe/Paris')).toBe('2027-07-15T07:00:00.000Z');
  });
});
