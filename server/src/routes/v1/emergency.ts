// Emergency support helpers: nearby facilities (OpenStreetMap) and an honest capability report.
// Coordinates arrive in the request body (not the URL) so they don't end up in access logs.
import { Router } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import type { Db } from '../../db.js';
import { HttpError, parse, route } from '../../http.js';
import type { RiskService } from '../../integrations/riskService.js';

export const RADII = [2000, 5000, 10000, 25000] as const;

const NearbyQuery = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radius_m: z.number().int().refine(r => (RADII as readonly number[]).includes(r), `radius_m must be one of ${RADII.join(', ')}`)
    .default(5000),
}).strict().refine(c => !(c.latitude === 0 && c.longitude === 0), '(0, 0) is not accepted as a location');

const Point = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
}).strict();

export function emergencyRouter(db: Db, risk: RiskService, opts: { pushConfigured: boolean; demoDispatch?: string | null }) {
  const r = Router();
  // Each lookup may reach the public Overpass servers; keep the per-user budget modest
  const lookupLimiter = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false,
    keyGenerator: req => req.user?.id ?? ipKeyGenerator(req.ip ?? '') });

  r.post('/resources', lookupLimiter, route(async (req, res) => {
    const q = parse(NearbyQuery, req.body);
    if (!risk.facilitiesNear) throw new HttpError(503, 'risk_service_unavailable', 'Nearby facility lookup is not available');
    res.json(await risk.facilitiesNear(q.latitude, q.longitude, q.radius_m));
  }));

  // Country at the traveller's position, to pick the emergency-number table. null = unknown → ask the traveller.
  r.post('/country', lookupLimiter, route(async (req, res) => {
    const q = parse(Point, req.body);
    if (!risk.countryAt) throw new HttpError(503, 'risk_service_unavailable', 'Country lookup is not available');
    res.json(await risk.countryAt(q.latitude, q.longitude));
  }));

  // What the emergency workflow can and cannot do on this deployment — the client words its messages from this
  r.get('/capabilities', route(async (_req, res) => {
    const responders = await db.query(`select count(*)::int as n from public.profiles where role in ('responder', 'admin')`)
      .then(x => x.rows[0].n as number).catch(() => null);
    res.json({
      incident_registration: true,
      responder_accounts: responders,
      push_notifications: opts.pushConfigured ? 'configured' : 'not_configured',
      sms: 'not_configured',
      emergency_service_dispatch: 'not_available',
      // DEMO ONLY: every SOS is also texted to one configured stand-in number (masked here)
      demo_dispatch: opts.demoDispatch ? { enabled: true, to_masked: opts.demoDispatch } : { enabled: false },
    });
  }));

  return r;
}
