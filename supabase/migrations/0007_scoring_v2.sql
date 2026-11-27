-- 0007 — scoring-v2: eight risk factors in four dimensions, confidence and destination score kept separate.
--
-- Factors (risk-service/app/schemas/factors.py):
--   hazard            weather_severity, hazard_severity
--   exposure          hazard_exposure (replaces distance_to_hazard + route_exposure), terrain (new: Copernicus DEM)
--   journey context   activity_timing (replaces time_factor), historical_incident_risk
--   response capacity emergency_access (was computed but not a factor), remoteness (new: GeoNames)
-- Removed as factors: population_exposure (now context only) and data_reliability (now the separate confidence).
-- Rows written under scoring-v1 keep their old keys, so the check accepts both sets.

alter table public.factor_assessments drop constraint if exists factor_assessments_factor_key_check;
alter table public.factor_assessments add constraint factor_assessments_factor_key_check check (factor_key in (
  -- scoring-v2
  'weather_severity', 'hazard_severity', 'hazard_exposure', 'terrain', 'activity_timing', 'historical_incident_risk',
  'emergency_access', 'remoteness',
  -- scoring-v1 (historical rows only)
  'distance_to_hazard', 'route_exposure', 'time_factor', 'population_exposure', 'data_reliability'));

-- Confidence in the assessment (evidence quality, 0–100 + level) and the destination score (Tourist Confidence Score).
-- data_reliability stays as the 0–1 confidence value for existing readers.
alter table public.destination_assessments add column if not exists confidence jsonb;
alter table public.destination_assessments add column if not exists destination_score jsonb;
alter table public.destination_assessments add column if not exists population jsonb;
alter table public.journey_assessments add column if not exists confidence jsonb;
alter table public.journey_assessments add column if not exists population jsonb;

insert into public.data_sources (id, name, kind, credibility_tier, url, licence, max_age_minutes) values
  ('copernicus-dem', 'Copernicus DEM GLO-90 via the Open-Meteo Elevation API', 'reanalysis', 'scientific',
   'https://api.open-meteo.com/v1/elevation', 'Copernicus DEM licence (free, attribution)', 5256000),
  ('geonames', 'GeoNames cities1000 (populated places ≥ 1 000 inhabitants)', 'population', 'community',
   'https://download.geonames.org/export/dump/', 'CC BY 4.0', 525600)
on conflict (id) do nothing;

insert into public.model_versions (id, kind, description, status, is_active) values
  ('scoring-v2', 'scoring',
   'Eight risk factors in four dimensions (hazard, exposure, journey context, response capacity). Category: hazard '
   || 'base class, one-step amplifiers (exposed activity, hazardous terrain, weak response capacity), context floor, '
   || 'critical override. Confidence (evidence quality) and the destination score are computed separately. '
   || 'Thresholds from published definitions where they exist; amplifier rules and weights not validated.',
   'active', true)
on conflict (id) do nothing;
update public.model_versions set status = 'retired', is_active = false where id = 'scoring-v1';
