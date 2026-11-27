import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { loadConfig } from '../src/config.js';
import { createPool, type Db } from '../src/db.js';
import { createApp } from '../src/app.js';
import { createVerifier } from '../src/auth.js';
import { HttpError } from '../src/http.js';
import { createRiskService, DestinationAssessmentSchema, type JourneyAssessmentInput, type RiskService }
  from '../src/integrations/riskService.js';
import { dispatchPending, type PushSender } from '../src/integrations/fcm.js';
import { toPlaceShape } from '../src/services/assessments.js';
import { zonedIso } from '../src/routes/v1/common.js';
import { composeMessage, createDemoDispatcher, maskNumber } from '../src/integrations/demoDispatch.js';

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
      dimensions: { hazard: {}, exposure: {}, journey_context: {}, response_capacity: { access: { class: 'adequate' } } },
      route: null, safer_route: { available: false }, activity: input.activity ?? 'sightseeing',
      travellers: input.travellers ?? 1, travel_start: input.travel_start, travel_end: input.travel_start } as any;
  },
};

// Same account creation as POST /api/auth/dev-session, without its per-IP sign-in rate limit (20 per 15 min)
const verifier = createVerifier(config);
const signIn = async (email: string) => {
  const { rows } = await db.query(
    `insert into auth.users (email, raw_user_meta_data) values ($1, '{}') on conflict (email) do update set email = excluded.email
     returning id`, [email]);
  return { token: await verifier.issueLocal!({ id: rows[0].id, email }), id: rows[0].id as string };
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
    expect(safety.body.assessment).toMatchObject({ destination_id: 'kyoto', scoring_version: 'scoring-v2' });
    expect(safety.body.assessment.confidence).toMatchObject({ level: 'high', score: 86 });
    expect(safety.body.assessment.destination_score).toMatchObject({ provisional: true, band: 'Excellent' });
    expect(safety.body.assessment.explanation.disclaimer).toMatch(/not the probability/);
    const factors = await request(app).get('/api/v1/destinations/kyoto/factors').set(as(token));
    expect(factors.body.factors).toHaveLength(8);
    expect(factors.body.factors.map((f: any) => f.key)).toEqual(['weather_severity', 'hazard_severity', 'hazard_exposure',
      'terrain', 'activity_timing', 'historical_incident_risk', 'emergency_access', 'remoteness']);
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
  it('never serves a fresh assessment stored by an older scoring version', async () => {
    const { token } = await signIn('dest@example.test');
    await db.query(
      `insert into public.destination_assessments (destination_id, risk_category, composite_index, assessment_status,
         data_coverage, data_reliability, explanation, scoring_version, engine_version, inputs_hash)
       values ('rome', 'HIGH', 0.9, 'COMPLETE', 1, 0.9, $1, 'scoring-v1', 'old', 'h')`, [JSON.stringify(FIXTURE.explanation)]);
    const res = await request(app).get('/api/v1/destinations/rome/safety').set(as(token));
    expect(res.status).toBe(200);
    expect(res.body.assessment).toMatchObject({ scoring_version: 'scoring-v2', source: 'computed' });
  });
  it('serves a fresh stored assessment without calling the engine, and paginates history', async () => {
    const { token } = await signIn('dest@example.test');
    const { rows } = await db.query(
      `insert into public.destination_assessments (destination_id, risk_category, composite_index, assessment_status,
         data_coverage, data_reliability, explanation, scoring_version, engine_version, inputs_hash)
       values ('santorini', 'MODERATE', 0.3, 'COMPLETE', 1, 0.9, $1, 'scoring-v2', 'test', 'h') returning id`,
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

describe('emergency workflow', () => {
  const uuid = () => crypto.randomUUID();

  it('creates an SOS once per client request id, marks it critical and alerts responder accounts', async () => {
    const u = await signIn('sos@example.test');
    const r = await signIn('sos-responder@example.test');
    await db.query(`update public.profiles set role = 'responder' where id = $1`, [r.id]);
    const body = { category: 'other', title: 'SOS', is_sos: true, latitude: 48.8566, longitude: 2.3522,
      location_accuracy_m: 25, client_request_id: uuid(), details: { location_status: 'captured' } };
    const first = await request(app).post('/api/v1/incidents').set(as(u.token)).send(body);
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ duplicate: false, incident: { status: 'open', priority: 'critical', is_sos: true } });
    expect(first.body.incident.reference).toMatch(/^INC-/);
    expect(first.body.responder_accounts).toBeGreaterThanOrEqual(1);
    // A double tap / retry with the same key returns the same incident instead of a second one
    const again = await request(app).post('/api/v1/incidents').set(as(u.token)).send(body);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ duplicate: true, incident: { id: first.body.incident.id } });
    const { rows } = await db.query(`select count(*)::int as n from public.incidents where reporter_id = $1`, [u.id]);
    expect(rows[0].n).toBe(1);
    const alerts = await db.query(
      `select title, body from public.notifications where user_id = $1 and kind = 'incident_alert' and incident_id = $2`,
      [r.id, first.body.incident.id]);
    expect(alerts.rows).toHaveLength(1); // not duplicated by the retry
    expect(alerts.rows[0].title).toMatch(/^SOS INC-/);
    expect(alerts.rows[0].body).not.toMatch(/48\.8|2\.35/); // no coordinates in push payloads
  });

  it('stores the medical, lost-document and local-help forms with validated details', async () => {
    const u = await signIn('forms@example.test');
    const med = await request(app).post('/api/v1/incidents').set(as(u.token)).send({
      category: 'medical', title: 'Medical: injury', description: 'Twisted ankle on the stairs, cannot walk',
      details: { assistance_type: 'injury', urgency: 'immediate', location_text: 'Hotel lobby', contact_number: '+33 6 12 34 56 78',
        contact_preference: 'phone', conditions_or_allergies: 'Penicillin' } });
    expect(med.status).toBe(201);
    expect(med.body.incident).toMatchObject({ category: 'medical', priority: 'high',
      details: { urgency: 'immediate', conditions_or_allergies: 'Penicillin' } });
    const doc = await request(app).post('/api/v1/incidents').set(as(u.token)).send({
      category: 'lost_documents', title: 'Lost passport', description: 'Stolen bag at the station',
      details: { document_type: 'passport', issuing_country: 'India', incident_date: '2026-11-24', police_report_filed: false } });
    expect(doc.status).toBe(201);
    expect(doc.body.incident).toMatchObject({ category: 'lost_documents', priority: 'normal' });
    const help = await request(app).post('/api/v1/incidents').set(as(u.token)).send({
      category: 'assistance', title: 'Local help: translation', description: 'Need help explaining to a pharmacist',
      details: { assistance_type: 'translation', urgency: 'medium' } });
    expect(help.status).toBe(201);
    const mine = await request(app).get('/api/v1/incidents').set(as(u.token));
    expect(mine.body.incidents.map((i: any) => i.category).sort()).toEqual(['assistance', 'lost_documents', 'medical']);
  });

  it('rejects invalid form details', async () => {
    const u = await signIn('forms-bad@example.test');
    const post = (b: object) => request(app).post('/api/v1/incidents').set(as(u.token)).send(b);
    expect((await post({ category: 'lost_documents', title: 'Lost passport', details: { issuing_country: 'India' } })).status).toBe(400);
    expect((await post({ category: 'medical', title: 'Medical', details: { urgency: 'whenever' } })).status).toBe(400);
    expect((await post({ category: 'medical', title: 'Medical', details: { unknown_field: 1 } })).status).toBe(400);
    expect((await post({ category: 'medical', title: 'Medical', details: { contact_number: 'call me' } })).status).toBe(400);
    expect((await post({ category: 'other', title: 'SOS', is_sos: true, client_request_id: 'not-a-uuid' })).status).toBe(400);
    expect((await post({ category: 'helicopter', title: 'SOS' })).status).toBe(400);
  });

  it('lets only the reporter add a location to an active incident', async () => {
    const u = await signIn('loc@example.test');
    const other = await signIn('loc-other@example.test');
    const r = await signIn('loc-responder@example.test');
    await db.query(`update public.profiles set role = 'responder' where id = $1`, [r.id]);
    const inc = (await request(app).post('/api/v1/incidents').set(as(u.token))
      .send({ category: 'other', title: 'SOS', is_sos: true, details: { location_status: 'timeout' } })).body.incident;
    expect(inc.latitude).toBeNull();
    const loc = { latitude: 35.0116, longitude: 135.7681, location_accuracy_m: 40 };
    expect((await request(app).post(`/api/v1/incidents/${inc.id}/location`).set(as(other.token)).send(loc)).status).toBe(404);
    const ok = await request(app).post(`/api/v1/incidents/${inc.id}/location`).set(as(u.token)).send(loc);
    expect(ok.status).toBe(200);
    expect(ok.body.incident).toMatchObject({ latitude: 35.0116, longitude: 135.7681, details: { location_status: 'captured' } });
    await request(app).patch(`/api/v1/incidents/${inc.id}/status`).set(as(r.token)).send({ status: 'resolved', note: 'Traveller safe' });
    const detail = await request(app).get(`/api/v1/incidents/${inc.id}`).set(as(u.token));
    expect(detail.body.incident.updates.map((x: any) => [x.note, x.by_responder]))
      .toEqual([['Reporter updated the location', false], ['Traveller safe', true]]);
    expect((await request(app).post(`/api/v1/incidents/${inc.id}/location`).set(as(u.token)).send(loc)).status).toBe(409);
  });

  it('only assigns incidents to responder accounts', async () => {
    const u = await signIn('assign@example.test');
    const r = await signIn('assign-responder@example.test');
    await db.query(`update public.profiles set role = 'responder' where id = $1`, [r.id]);
    const inc = (await request(app).post('/api/v1/incidents').set(as(u.token)).send({ category: 'other', title: 'Help' })).body.incident;
    const bad = await request(app).patch(`/api/v1/incidents/${inc.id}/status`).set(as(r.token)).send({ status: 'acknowledged', assigned_to: u.id });
    expect(bad.status).toBe(400);
    const good = await request(app).patch(`/api/v1/incidents/${inc.id}/status`).set(as(r.token)).send({ status: 'acknowledged', assigned_to: r.id });
    expect(good.body.incident).toMatchObject({ status: 'acknowledged', assigned_to: r.id });
  });

  it('coarsens precise locations of incidents finished more than 30 days ago', async () => {
    const u = await signIn('retention@example.test');
    const inc = (await request(app).post('/api/v1/incidents').set(as(u.token))
      .send({ category: 'other', title: 'Old', latitude: 12.971599, longitude: 77.594566 })).body.incident;
    await db.query(`update public.incidents set status = 'closed' where id = $1`, [inc.id]);
    await db.query(`alter table public.incidents disable trigger incidents_updated_at`);
    await db.query(`update public.incidents set updated_at = now() - interval '31 days' where id = $1`, [inc.id]);
    await db.query(`alter table public.incidents enable trigger incidents_updated_at`);
    await db.query('select public.coarsen_incident_locations()');
    const { rows } = await db.query(`select latitude, longitude, location_accuracy_m::float as acc from public.incidents where id = $1`, [inc.id]);
    expect(rows[0]).toEqual({ latitude: 12.97, longitude: 77.59, acc: 1000 });
  });

  it('reports capabilities honestly', async () => {
    const u = await signIn('caps@example.test');
    const res = await request(app).get('/api/v1/emergency/capabilities').set(as(u.token));
    expect(res.body).toMatchObject({ incident_registration: true, push_notifications: 'not_configured', sms: 'not_configured',
      emergency_service_dispatch: 'not_available' });
    expect(typeof res.body.responder_accounts).toBe('number');
  });

  it('looks up nearby facilities through the risk service, with validation', async () => {
    const seen: number[][] = [];
    const risk: RiskService = { ...fakeRisk, facilitiesNear: async (lat, lon, r) => {
      seen.push([lat, lon, r]);
      return { facilities: [{ osm_id: 'n1', kind: 'hospital', name: 'A', latitude: 48.857, longitude: 2.352, distance_m: 50,
        phone: null, healthcare: 'hospital', has_emergency: null, retrieved_at: new Date().toISOString() }],
        radius_m: r, source: 'OpenStreetMap', licence: 'ODbL', cached: false, country_code: 'FR', error: null };
    } };
    const app2 = createApp(config, db, undefined, undefined, risk);
    const u = await signIn('nearby@example.test');
    const ok = await request(app2).post('/api/v1/emergency/resources').set(as(u.token)).send({ latitude: 48.8566, longitude: 2.3522 });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ country_code: 'FR', facilities: [{ osm_id: 'n1', phone: null }] });
    expect(seen).toEqual([[48.8566, 2.3522, 5000]]);
    expect((await request(app2).post('/api/v1/emergency/resources').set(as(u.token)).send({ latitude: 48.8, longitude: 2.3, radius_m: 777 })).status).toBe(400);
    expect((await request(app2).post('/api/v1/emergency/resources').set(as(u.token)).send({ latitude: 0, longitude: 0 })).status).toBe(400);
    expect((await request(app2).post('/api/v1/emergency/resources').send({ latitude: 48.8, longitude: 2.3 })).status).toBe(401);
    // The default fake risk service has no facility lookup → 503, not an empty "nothing nearby"
    expect((await request(app).post('/api/v1/emergency/resources').set(as(u.token)).send({ latitude: 48.8, longitude: 2.3 })).status).toBe(503);
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
  it('returns eight risk factors with dimensions and confidence separately, never as a risk bar', () => {
    const shaped = toPlaceShape(FIXTURE, FIXTURE.weather);
    expect(shaped.factors).toHaveLength(8);
    expect(shaped.factors.find(f => f.key === 'data_reliability')).toBeUndefined();
    expect(shaped.factors.find(f => f.key === 'terrain')).toMatchObject({ dimension: 'exposure', status: 'live' });
    expect(shaped.confidence).toMatchObject({ level: 'high', score: 86 });
    expect(shaped.factors_available).toBe(8);
    expect(shaped.uncertainty).toMatch(/confidence in the data high \(86\/100\)/);
    expect(shaped.model_version).toMatch(/^scoring-v2/);
    expect(shaped.hazard_outlook).toBeNull();                 // assessments from before the climatologies
  });
  it('passes the cyclone and flood outlook through, dropping malformed entries', () => {
    const outlook = (p: number) => ({ p_period: p, period_days: 7, scope: 'destination', period_start: '2026-11-23T00:00:00Z',
      period_end: '2026-11-30T00:00:00Z', p_week: p, annual_rate: 0.5, expected_weeks_per_year: 0.4, peak_week_start: '20 Aug', p_peak_week: 0.05,
      monthly_p_week: Array(12).fill(0.01), years: [1985, 2021], model: 'dfo-climatology', definition: 'x' });
    const withInputs = (inputs: Record<string, unknown>) => ({ ...FIXTURE, factors: FIXTURE.factors.map((f: any) =>
      f.key === 'historical_incident_risk' ? { ...f, inputs: { ...f.inputs, ...inputs } } : f) });
    const shaped = toPlaceShape(withInputs({ flood: outlook(0.02), cyclone: null,
      climatology_unavailable: { cyclone: 'outside the cyclone climatology\'s area' } }), null);
    expect(shaped.hazard_outlook).toMatchObject({ flood: { p_period: 0.02, expected_weeks_per_year: 0.4, peak_week_start: '20 Aug' }, cyclone: null,
      unavailable: { cyclone: expect.stringContaining('outside') } });
    // a probability above 1 or a short monthly profile is not shown
    const bad = toPlaceShape(withInputs({ flood: { ...outlook(1.5) }, cyclone: { ...outlook(0.1), monthly_p_week: [0.1] } }), null);
    expect(bad.hazard_outlook).toBeNull();
  });
  it('/api/places serves the engine result when available', async () => {
    const { token } = await signIn('places@example.test');
    const res = await request(app).get('/api/places/kyoto/assessment').set(as(token));
    expect(res.status).toBe(200);
    expect(res.body.assessment.model_version).toMatch(/^scoring-v2/);
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

describe('incident push delivery', () => {
  it('pushes incident alerts to responders with devices and logs failures; nothing is marked sent without FCM', async () => {
    const r = await signIn('push-responder@example.test');
    await db.query(`update public.profiles set role = 'responder' where id = $1`, [r.id]);
    const u = await signIn('push-reporter@example.test');
    await db.query(`insert into public.device_tokens (user_id, platform, token) values ($1, 'fcm', 'responder-token-1')`, [r.id]);
    const inc = (await request(app).post('/api/v1/incidents').set(as(u.token)).send({ category: 'other', title: 'SOS', is_sos: true })).body.incident;
    const state = async () => (await db.query(
      `select delivery_status, delivery_error from public.notifications where user_id = $1 and incident_id = $2`, [r.id, inc.id])).rows[0];
    // FCM not configured: stays pending (in-app only)
    expect(await dispatchPending(db, null)).toEqual({ sent: 0, failed: 0 });
    expect(await state()).toMatchObject({ delivery_status: 'pending' });
    // FCM rejects: recorded as failed with the reason
    await dispatchPending(db, { send: async () => 'failed' });
    expect(await state()).toMatchObject({ delivery_status: 'failed', delivery_error: 'push not accepted: failed' });
  });
  it('delivers a pending incident alert when FCM accepts it', async () => {
    const r = await signIn('push-responder2@example.test');
    await db.query(`update public.profiles set role = 'responder' where id = $1`, [r.id]);
    await db.query(`insert into public.device_tokens (user_id, platform, token) values ($1, 'fcm', 'responder-token-2')`, [r.id]);
    const u = await signIn('push-reporter2@example.test');
    const inc = (await request(app).post('/api/v1/incidents').set(as(u.token)).send({ category: 'other', title: 'SOS', is_sos: true })).body.incident;
    const sent: Record<string, string>[] = [];
    await dispatchPending(db, { send: async (token, _t, _b, data) => { if (token === 'responder-token-2') sent.push(data!); return 'sent'; } }, 500);
    expect(sent.some(d => d.kind === 'incident_alert' && d.incident_id === inc.id)).toBe(true);
    const { rows } = await db.query(`select delivery_status from public.notifications where user_id = $1 and incident_id = $2`, [r.id, inc.id]);
    expect(rows[0].delivery_status).toBe('sent');
  });
});

describe('helpers', () => {
  it('converts destination wall-clock time to UTC', () => {
    expect(zonedIso('2027-01-15', '09:00', 'Asia/Tokyo')).toBe('2027-01-15T00:00:00.000Z');
    expect(zonedIso('2027-07-15', '09:00', 'Europe/Paris')).toBe('2027-07-15T07:00:00.000Z');
  });
});


describe('demo SOS dispatch (demo only)', () => {
  const NUMBER = '+910000000000';   // placeholder — never a real number in the repo
  it('texts the SOS with type, hotel stay and location to the stand-in number, and records it', async () => {
    const calls: string[][] = [];
    const dispatcher = createDemoDispatcher({ number: NUMBER, transport: 'macos-messages', production: false },
      (file, args, cb) => { calls.push([file, ...args]); cb(null, '', ''); });
    const demoApp = createApp(config, db, undefined, undefined, fakeRisk, null, dispatcher);
    const u = await signIn('demo-sos@example.test');
    await db.query(`update public.profiles set full_name = 'Demo Traveller' where id = $1`, [u.id]);
    await db.query(`insert into public.hotel_bookings (user_id, provider_booking_id, client_reference, hotel_id, hotel_name, city,
      country_code, checkin, checkout, rooms, guests, price, currency, status, sandbox, holder_name, holder_email)
      values ($1, 'pb-1', 'TS-DEMO-0001', 'h1', 'Lalit Ashok', 'Bengaluru', 'IN', current_date, current_date + 2, 1, 1, 100, 'INR',
      'CONFIRMED', true, 'Demo Traveller', 'demo@example.test')`, [u.id]);
    const res = await request(demoApp).post('/api/v1/incidents').set(as(u.token)).send({
      category: 'medical', title: 'SOS: Medical emergency', is_sos: true, latitude: 12.9791, longitude: 77.5913,
      location_accuracy_m: 15, client_request_id: crypto.randomUUID(),
      details: { emergency_type: 'medical', location_status: 'captured', contact_number: '+91 90000 00000' } });
    expect(res.status).toBe(201);
    expect(res.body.demo_dispatch).toMatchObject({ status: 'sent', service: 'Ambulance / medical service', to_masked: '+9100•••0000' });
    expect(calls).toHaveLength(1);
    const [file, , , to, message] = calls[0];
    expect(file).toBe('osascript');
    expect(to).toBe(NUMBER);                                      // passed as an argument, not inside the script
    expect(message).toMatch(/MEDICAL EMERGENCY/);
    expect(message).toMatch(/NOT verified/);
    expect(message).toMatch(/Staying at: Lalit Ashok, Bengaluru \(booking TS-DEMO-0001/);
    expect(message).toMatch(/maps\.google\.com\/\?q=12\.97910,77\.59130/);
    const notes = await db.query('select note from public.incident_updates where incident_id = $1', [res.body.incident.id]);
    expect(notes.rows.map(r => r.note).join(' ')).toMatch(/Demo: SOS message sent to the demo Ambulance/);
  });
  it('reports a Messages failure as not sent, and is disabled in production', async () => {
    const failing = createDemoDispatcher({ number: NUMBER, production: false },
      (_f, _a, cb) => cb(new Error('Command failed'), '', "35:39: execution error: Messages got an error: Can't get name of every account. (-1728)"));
    const r = await failing.send({ reference: 'INC-1', emergencyType: 'theft', reporterName: null, contactNumber: null,
      latitude: null, longitude: null, accuracyM: null, stay: null, notes: null, createdAt: new Date() });
    expect(r).toMatchObject({ status: 'failed', service: 'Police' });
    expect(r.error).toMatch(/Messages is not signed in on this Mac/);
    expect(r.whatsapp_url).toMatch(/^https:\/\/wa\.me\/910000000000\?text=TravelSphere%20SOS/);
    expect(createDemoDispatcher({ number: NUMBER, production: true }).enabled).toBe(false);
    expect(maskNumber('+916383000000')).toBe('+9163•••0000');
  });
  it('puts no location line it does not have', () => {
    const m = composeMessage({ reference: 'INC-2', emergencyType: 'fire', reporterName: null, contactNumber: null,
      latitude: null, longitude: null, accuracyM: null, stay: null, notes: null, createdAt: new Date() });
    expect(m).toMatch(/FIRE/);
    expect(m).toMatch(/Live location not shared/);
    expect(m).not.toMatch(/maps\.google/);
  });
});
