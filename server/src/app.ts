import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
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
) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({
    origin: (origin, cb) => cb(null, !origin || config.corsOrigins.includes(origin)),
    allowedHeaders: ['Authorization', 'Content-Type'],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
  }));
  app.use(express.json({ limit: '256kb' }));

  const generalLimiter = rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: 'draft-8', legacyHeaders: false });
  const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false });
  app.use('/api', generalLimiter);

  // Health — reports which modes are active so nothing is mistaken for production
  app.get('/api/health', route(async (_req, res) => {
    const database = (await dbHealthy(db)) ? 'connected' : 'unavailable';
    res.status(database === 'connected' ? 200 : 503).json({
      status: database === 'connected' ? 'ok' : 'degraded',
      version: API_VERSION,
      auth_mode: config.AUTH_MODE,
      database,
    });
  }));

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
  app.use('/api/places', auth, placesRouter(db, weather));

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'not_found', 'No such endpoint')));
  app.use(errorHandler);
  return app;
}
