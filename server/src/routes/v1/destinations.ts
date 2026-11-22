import { Router } from 'express';
import type { Db } from '../../db.js';
import { HttpError, parse, route } from '../../http.js';
import type { RiskService } from '../../integrations/riskService.js';
import { destinationExists, getOrAssessDestination } from '../../services/assessments.js';
import { DEST_ID, Page, pageMeta } from './common.js';

export function destinationsRouter(db: Db, risk: RiskService, maxAgeMin: number) {
  const r = Router();

  r.get('/', route(async (_req, res) => {
    const { rows } = await db.query(
      `select d.id, d.name, d.country_code, d.latitude, d.longitude, d.timezone,
              a.risk_category, a.assessment_status, a.data_reliability, a.assessed_at
       from public.destinations d
       left join lateral (select risk_category, assessment_status, data_reliability, assessed_at
                          from public.destination_assessments x where x.destination_id = d.id
                          order by assessed_at desc limit 1) a on true
       where d.active order by d.name`);
    res.json({ destinations: rows });
  }));

  const ensure = async (raw: unknown) => {
    const id = parse(DEST_ID, raw);
    if (!(await destinationExists(db, id))) throw new HttpError(404, 'not_found', 'Unknown destination');
    return id;
  };

  // Overall destination safety (served from the latest assessment while fresh, otherwise recomputed)
  r.get('/:id/safety', route(async (req, res) => {
    const id = await ensure(req.params.id);
    const a = await getOrAssessDestination(db, risk, id, maxAgeMin);
    const { factors, ...rest } = a as typeof a & { factors: unknown[] };
    res.json({ assessment: rest, factors_count: factors.length });
  }));

  // The eight individual factor results of the latest assessment
  r.get('/:id/factors', route(async (req, res) => {
    const id = await ensure(req.params.id);
    const a = await getOrAssessDestination(db, risk, id, maxAgeMin);
    res.json({ destination_id: id, assessment_id: a.id, assessed_at: a.assessed_at, scoring_version: a.scoring_version,
      factors: a.factors });
  }));

  r.get('/:id/history', route(async (req, res) => {
    const id = await ensure(req.params.id);
    const q = parse(Page, req.query);
    const { rows } = await db.query(
      `select assessment_id, risk_category, previous_category, composite_index, data_reliability, assessment_status,
              scoring_version, assessed_at
       from public.assessment_history where subject_type = 'destination' and destination_id = $1
       order by assessed_at desc limit $2 offset $3`, [id, q.limit, q.offset]);
    res.json({ destination_id: id, history: rows, page: pageMeta(q.limit, q.offset, rows.length) });
  }));

  return r;
}

