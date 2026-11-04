-- Assessments can be about a catalogue place (not only a journey)
alter table public.risk_assessments add column if not exists place_id text
  check (place_id ~ '^[a-z0-9-]{2,40}$');
create index if not exists risk_assessments_place_idx on public.risk_assessments (place_id, created_at desc);

-- Observations are tagged with the place they were fetched for (lookup + freshness checks)
alter table public.environment_observations add column if not exists place_id text
  check (place_id ~ '^[a-z0-9-]{2,40}$');
create index if not exists environment_observations_place_idx
  on public.environment_observations (place_id, observed_at desc);

-- Coverage-based confidence: how many of the 8 factors had real data
alter table public.risk_assessments add column if not exists factors_available smallint
  check (factors_available between 0 and 8);

update public.model_versions
   set description = 'Deterministic 8-factor rule baseline. Thresholds from published definitions '
                  || '(AMS heavy rain 7.6 mm/h, Beaufort gale 17.2 m/s, WMO thunderstorm codes). Not calibrated.'
 where id = 'rules-v1';
