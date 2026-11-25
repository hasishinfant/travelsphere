import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import type { Config } from './config.js';
import type { Db } from './db.js';
import { dbHealthy } from './db.js';
import { createVerifier, requireAuth, type TokenVerifier } from './auth.js';
import { errorHandler, HttpError, parse, route } from './http.js';
import { profileRouter } from './routes/profile.js';
import { journeysRouter } from './routes/journeys.js';
import { placesRouter } from './routes/places.js';
import { WeatherService } from './services/weather.js';
import { createRiskService, type RiskService } from './integrations/riskService.js';
import { destinationsRouter } from './routes/v1/destinations.js';
import { assessmentsRouter, journeyAssessmentRouter } from './routes/v1/assessments.js';
import { incidentsRouter } from './routes/v1/incidents.js';
import { emergencyRouter } from './routes/v1/emergency.js';
import { alertsRouter, devicesRouter } from './routes/v1/alerts.js';
import { hotelsRouter } from './routes/v1/hotels.js';
import { createLiteApi, type HotelProvider } from './integrations/liteapi.js';

export const API_VERSION = '0.1.0';

const DevSession = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  full_name: z.string().trim().min(1).max(120).optional(),
}).strict();

export function createApp(
  config: Config,
  db: Db,
  verifier: TokenVerifier = createVerifier(config),
  weather: WeatherService = new WeatherService(db),
  risk: RiskService = createRiskService(config),
  hotels: HotelProvider | null = config.LITEAPI_API_KEY
    ? createLiteApi({ apiKey: config.LITEAPI_API_KEY, env: config.LITEAPI_ENV, timeoutMs: config.LITEAPI_TIMEOUT_MS })
    : null,
) {
  const app = express();
  const pushConfigured = Boolean(config.FCM_PROJECT_ID && config.FCM_SERVICE_ACCOUNT_JSON);
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({
    origin: (origin, cb) => cb(null, !origin || config.corsOrigins.includes(origin)),
    allowedHeaders: ['Authorization', 'Content-Type'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  }));
  app.use(express.json({ limit: '256kb' }));

  const generalLimiter = rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: 'draft-8', legacyHeaders: false });
  const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false });
  app.use('/api', generalLimiter);

  // Health — reports which modes are active so nothing is mistaken for production
  const health = route(async (_req, res) => {
    const [dbOk, riskHealth] = await Promise.all([dbHealthy(db), risk.health()]);
    const database = dbOk ? 'connected' : 'unavailable';
    res.status(dbOk ? 200 : 503).json({
      status: dbOk && riskHealth ? 'ok' : 'degraded',
      version: API_VERSION,
      auth_mode: config.AUTH_MODE,
      database,
      risk_service: riskHealth ? { status: riskHealth.status, engine_version: riskHealth.engine_version } : 'unavailable',
      hotels: hotels ? `configured (${hotels.env})` : 'not_configured',
      push: pushConfigured ? 'configured' : 'not_configured',
    });
  });
  app.get('/api/health', health);
  app.get('/api/v1/health', health);

  // Local development sign-in (no password; refused outside AUTH_MODE=local, which is refused in production)
  if (config.AUTH_MODE === 'local' && verifier.issueLocal) {
    app.post('/api/auth/dev-session', authLimiter, route(async (req, res) => {
      const body = parse(DevSession, req.body);
      const { rows } = await db.query(
        `insert into auth.users (email, raw_user_meta_data) values ($1, jsonb_build_object('full_name', $2::text))
         on conflict (email) do update set email = excluded.email
         returning id, email`,
        [body.email, body.full_name ?? body.email.split('@')[0]],
      );
      const user = rows[0];
      const token = await verifier.issueLocal!({ id: user.id, email: user.email });
      res.status(201).json({ token, user: { id: user.id, email: user.email }, mode: 'local-dev' });
    }));
  }

  const auth = requireAuth(verifier);
  app.use('/api/profile', auth, profileRouter(db));
  app.use('/api/journeys', auth, journeysRouter(db));
  app.use('/api/places', auth, placesRouter(db, weather, risk, config.ASSESSMENT_MAX_AGE_MIN));

  // Versioned API (risk intelligence, incidents, alerts)
  const assessLimiter = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false,
    keyGenerator: req => req.user?.id ?? ipKeyGenerator(req.ip ?? '') });
  app.use('/api/v1/destinations', auth, destinationsRouter(db, risk, config.ASSESSMENT_MAX_AGE_MIN));
  app.use('/api/v1/assessments', auth, (req, res, next) => (req.method === 'POST' ? assessLimiter(req, res, next) : next()),
    assessmentsRouter(db, risk, config.ASSESSMENT_MAX_AGE_MIN));
  app.use('/api/v1/journeys', auth, journeyAssessmentRouter(db));
  app.use('/api/v1/incidents', auth, incidentsRouter(db));
  app.use('/api/v1/emergency', auth, emergencyRouter(db, risk, { pushConfigured }));
  app.use('/api/v1/alerts', auth, alertsRouter(db));
  app.use('/api/v1/devices', auth, devicesRouter(db));
  app.use('/api/v1/hotels', auth, hotelsRouter(db, hotels, { allowLiveBookings: config.LITEAPI_ALLOW_LIVE_BOOKINGS }));

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'not_found', 'No such endpoint')));
  app.use(errorHandler);
  return app;
}
