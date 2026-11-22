-- Risk intelligence schema: destinations, data sources, hazards, indicators, factor/destination/journey
-- assessments, alerts, history, emergency facilities. Destination and journey assessments are kept separate.
--
-- PostGIS: enabled when the extension is available (Supabase: yes). Geography columns and GiST indexes are then
-- added at the end of this file. Without PostGIS (plain local Postgres) the lat/lng columns + B-tree indexes are
-- used and exact geometry is computed in the Python service (Shapely/PyProj). GeoJSON is always stored in `geometry`.

-- ---------------------------------------------------------------------------
-- destinations (replaces the hard-coded place profiles; ids match the app catalogue)
-- ---------------------------------------------------------------------------
create table if not exists public.destinations (
  id                  text primary key check (id ~ '^[a-z0-9-]{2,40}$'),
  name                text not null check (char_length(name) between 1 and 120),
  country_code        char(2) check (country_code ~ '^[A-Z]{2}$'),
  latitude            double precision not null check (latitude between -90 and 90),
  longitude           double precision not null check (longitude between -180 and 180),
  timezone            text,
  -- Spatial scope of a destination assessment (a scope parameter, not a hazard threshold)
  assessment_radius_m integer not null default 50000 check (assessment_radius_m between 1000 and 300000),
  default_activity    text not null default 'sightseeing'
                        check (default_activity in ('sightseeing', 'trekking', 'water', 'transit',
                                                    'dining', 'shopping', 'indoor', 'other')),
  setting             text check (setting in ('urban', 'island', 'rural', 'remote')),
  terrain             text[] not null default '{}',
  active              boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists destinations_latlng_idx on public.destinations (latitude, longitude);
create trigger destinations_updated_at before update on public.destinations
  for each row execute function public.set_updated_at();

insert into public.destinations (id, name, country_code, latitude, longitude, timezone, default_activity, setting, terrain) values
  ('paris',     'Paris, France',        'FR', 48.8584,   2.2945, 'Europe/Paris',        'sightseeing', 'urban',  '{}'),
  ('london',    'London, UK',           'GB', 51.5055,  -0.0754, 'Europe/London',       'sightseeing', 'urban',  '{}'),
  ('rome',      'Rome, Italy',          'IT', 41.8902,  12.4922, 'Europe/Rome',         'sightseeing', 'urban',  '{}'),
  ('santorini', 'Santorini, Greece',    'GR', 36.4618,  25.3753, 'Europe/Athens',       'sightseeing', 'island', '{cliffs,coastal,volcanic}'),
  ('tokyo',     'Tokyo, Japan',         'JP', 35.6595, 139.7005, 'Asia/Tokyo',          'sightseeing', 'urban',  '{}'),
  ('kyoto',     'Kyoto, Japan',         'JP', 34.9986, 135.7850, 'Asia/Tokyo',          'sightseeing', 'urban',  '{}'),
  ('bali',      'Bali, Indonesia',      'ID', -8.2752, 115.1668, 'Asia/Makassar',       'sightseeing', 'rural',  '{coastal,volcanic}'),
  ('new-york',  'New York City, USA',   'US', 40.7580, -73.9855, 'America/New_York',    'sightseeing', 'urban',  '{}'),
  ('iceland',   'Reykjavík, Iceland',   'IS', 63.6156, -19.9886, 'Atlantic/Reykjavik',  'trekking',    'remote', '{waterfall,coastal,glacial-river}'),
  ('bengaluru', 'Bengaluru, India',     'IN', 12.9791,  77.5913, 'Asia/Kolkata',        'sightseeing', 'urban',  '{}')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- data_sources — every provider, its credibility tier and health
-- ---------------------------------------------------------------------------
create table if not exists public.data_sources (
  id                   text primary key check (id ~ '^[a-z0-9-]{2,60}$'),
  name                 text not null,
  kind                 text not null check (kind in ('weather', 'hazard', 'routing', 'facilities',
                                                       'population', 'incidents', 'reanalysis', 'configured')),
  credibility_tier     text not null check (credibility_tier in ('official', 'scientific', 'community', 'configured')),
  url                  text,
  licence              text,
  requires_credentials boolean not null default false,
  max_age_minutes      integer not null check (max_age_minutes > 0),
  last_success_at      timestamptz,
  last_failure_at      timestamptz,
  last_error           text,
  consecutive_failures integer not null default 0,
  updated_at           timestamptz not null default now()
);

insert into public.data_sources (id, name, kind, credibility_tier, url, licence, max_age_minutes) values
  ('open-meteo-forecast', 'Open-Meteo Forecast API', 'weather', 'scientific', 'https://api.open-meteo.com', 'CC BY 4.0', 90),
  ('open-meteo-archive', 'Open-Meteo Historical Weather (ERA5)', 'reanalysis', 'scientific', 'https://archive-api.open-meteo.com', 'CC BY 4.0', 525600),
  ('open-meteo-geocoding', 'Open-Meteo Geocoding (GeoNames)', 'population', 'community', 'https://geocoding-api.open-meteo.com', 'CC BY 4.0', 525600),
  ('gdacs', 'GDACS — Global Disaster Alert and Coordination System (UN/EC JRC)', 'hazard', 'official', 'https://www.gdacs.org', 'GDACS terms of use', 180),
  ('usgs-earthquakes', 'USGS Earthquake Hazards Program', 'hazard', 'official', 'https://earthquake.usgs.gov', 'Public domain (US Government)', 60),
  ('osrm', 'OSRM routing (OpenStreetMap)', 'routing', 'community', 'https://router.project-osrm.org', 'ODbL (data), BSD (software)', 10080),
  ('overpass', 'OpenStreetMap via Overpass API', 'facilities', 'community', 'https://overpass-api.de', 'ODbL', 43200),
  ('travelsphere-incidents', 'TravelSphere incident reports', 'incidents', 'community', null, null, 525600),
  ('travelsphere-config', 'TravelSphere configured data (risk zones, destination profiles)', 'configured', 'configured', null, null, 525600)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- hazard_events — normalised hazards from all providers (active and historical)
-- ---------------------------------------------------------------------------
create table if not exists public.hazard_events (
  id             uuid primary key default gen_random_uuid(),
  source_id      text not null references public.data_sources (id),
  external_id    text not null check (char_length(external_id) between 1 and 200),
  hazard_type    text not null check (hazard_type in ('flood', 'landslide', 'wildfire', 'cyclone', 'earthquake',
                                                      'volcano', 'drought', 'storm', 'heat', 'tsunami', 'other')),
  title          text not null check (char_length(title) between 1 and 300),
  alert_level    text check (alert_level in ('green', 'yellow', 'orange', 'red')),
  severity_class text not null check (severity_class in ('none', 'minor', 'moderate', 'severe', 'extreme')),
  severity_value numeric,
  severity_unit  text,
  severity_text  text,
  latitude       double precision not null check (latitude between -90 and 90),
  longitude      double precision not null check (longitude between -180 and 180),
  geometry       jsonb,               -- GeoJSON (Point or affected-area polygon)
  geometry_kind  text not null default 'point' check (geometry_kind in ('point', 'polygon', 'line')),
  country        text,
  valid_from     timestamptz not null,
  valid_to       timestamptz,
  is_current     boolean not null default true,
  verified       boolean not null default true,  -- official sources; configured zones/incidents may be unverified
  url            text,
  observed_at    timestamptz not null,
  retrieved_at   timestamptz not null default now(),
  raw            jsonb,
  unique (source_id, external_id),
  constraint hazard_events_validity check (valid_to is null or valid_to >= valid_from)
);
create index if not exists hazard_events_current_idx on public.hazard_events (is_current, valid_to);
create index if not exists hazard_events_latlng_idx on public.hazard_events (latitude, longitude);
create index if not exists hazard_events_type_time_idx on public.hazard_events (hazard_type, valid_from desc);

-- ---------------------------------------------------------------------------
-- safety_indicators — normalised measurements per destination (weather, population, facilities …)
-- ---------------------------------------------------------------------------
create table if not exists public.safety_indicators (
  id             uuid primary key default gen_random_uuid(),
  destination_id text not null references public.destinations (id) on delete cascade,
  indicator      text not null check (indicator ~ '^[a-z0-9_]{2,60}$'),
  value          numeric,
  unit           text,
  value_json     jsonb,
  source_id      text not null references public.data_sources (id),
  observed_at    timestamptz not null,
  retrieved_at   timestamptz not null default now(),
  quality        jsonb not null default '{}'::jsonb,
  unique (destination_id, indicator, source_id, observed_at)
);
create index if not exists safety_indicators_lookup_idx
  on public.safety_indicators (destination_id, indicator, observed_at desc);

-- ---------------------------------------------------------------------------
-- model registry: rule scoring configs and ML models
-- ---------------------------------------------------------------------------
alter table public.model_versions drop constraint if exists model_versions_kind_check;
alter table public.model_versions add constraint model_versions_kind_check check (kind in ('rules', 'ml', 'scoring'));
alter table public.model_versions add column if not exists status text not null default 'active'
  check (status in ('experimental', 'active', 'retired'));
alter table public.model_versions add column if not exists config jsonb not null default '{}'::jsonb;
alter table public.model_versions add column if not exists features text[] not null default '{}';
alter table public.model_versions add column if not exists dataset jsonb not null default '{}'::jsonb;
alter table public.model_versions add column if not exists artifact_sha256 text;

-- ---------------------------------------------------------------------------
-- destination_assessments + journey_assessments (separate by design)
-- ---------------------------------------------------------------------------
create table if not exists public.destination_assessments (
  id                 uuid primary key default gen_random_uuid(),
  destination_id     text not null references public.destinations (id) on delete cascade,
  risk_category      text check (risk_category in ('LOW', 'MODERATE', 'HIGH', 'CRITICAL')), -- null = not assessable
  composite_index    numeric(5, 4) check (composite_index between 0 and 1),
  assessment_status  text not null check (assessment_status in ('COMPLETE', 'PARTIAL', 'INCOMPLETE')),
  data_coverage      numeric(5, 4) not null check (data_coverage between 0 and 1),
  data_reliability   numeric(5, 4) check (data_reliability between 0 and 1),
  missing_indicators text[] not null default '{}',
  active_warnings    jsonb not null default '[]'::jsonb,
  critical_override  boolean not null default false,
  explanation        jsonb not null,
  scoring_version    text not null references public.model_versions (id),
  engine_version     text not null,
  ml_signal          jsonb,
  inputs_hash        text not null,
  assessed_at        timestamptz not null default now()
);
create index if not exists destination_assessments_dest_time_idx
  on public.destination_assessments (destination_id, assessed_at desc);

create table if not exists public.journey_assessments (
  id                uuid primary key default gen_random_uuid(),
  journey_id        uuid references public.journeys (id) on delete cascade,
  user_id           uuid not null references public.profiles (id) on delete cascade,
  destination_id    text references public.destinations (id) on delete set null,
  destination_assessment_id uuid references public.destination_assessments (id) on delete set null,
  risk_category     text check (risk_category in ('LOW', 'MODERATE', 'HIGH', 'CRITICAL')),
  assessment_status text not null check (assessment_status in ('COMPLETE', 'PARTIAL', 'INCOMPLETE')),
  data_reliability  numeric(5, 4) check (data_reliability between 0 and 1),
  dimensions        jsonb not null,   -- hazard / exposure / journey_context / response_accessibility
  route             jsonb,            -- summary + simplified geometry of the assessed route
  safer_route       jsonb,
  activity          text,
  travel_start      timestamptz,
  travel_end        timestamptz,
  travellers        smallint check (travellers between 1 and 20),
  missing_indicators text[] not null default '{}',
  critical_override boolean not null default false,
  explanation       jsonb not null,
  scoring_version   text not null references public.model_versions (id),
  engine_version    text not null,
  assessed_at       timestamptz not null default now()
);
create index if not exists journey_assessments_journey_idx on public.journey_assessments (journey_id, assessed_at desc);
create index if not exists journey_assessments_user_idx on public.journey_assessments (user_id, assessed_at desc);

create table if not exists public.factor_assessments (
  id                        uuid primary key default gen_random_uuid(),
  destination_assessment_id uuid references public.destination_assessments (id) on delete cascade,
  journey_assessment_id     uuid references public.journey_assessments (id) on delete cascade,
  factor_key     text not null check (factor_key in ('weather_severity', 'hazard_severity', 'distance_to_hazard',
                   'route_exposure', 'time_factor', 'historical_incident_risk', 'population_exposure', 'data_reliability')),
  status         text not null check (status in ('measured', 'derived', 'configured', 'not_applicable', 'unavailable')),
  value          numeric(5, 4) check (value between 0 and 1),
  severity_class text check (severity_class in ('none', 'minor', 'moderate', 'severe', 'extreme')),
  raw_value      numeric,
  unit           text,
  inputs         jsonb not null default '{}'::jsonb,
  source_ids     text[] not null default '{}',
  explanation    text not null,
  data_quality   jsonb not null default '{}'::jsonb,
  observed_at    timestamptz,
  computed_at    timestamptz not null default now(),
  constraint factor_assessments_one_parent
    check ((destination_assessment_id is null) <> (journey_assessment_id is null))
);
create index if not exists factor_assessments_dest_idx on public.factor_assessments (destination_assessment_id);
create index if not exists factor_assessments_journey_idx on public.factor_assessments (journey_assessment_id);

-- ---------------------------------------------------------------------------
-- journey_locations — traveller positions (consent-gated, retention-limited)
-- ---------------------------------------------------------------------------
create table if not exists public.journey_locations (
  id          uuid primary key default gen_random_uuid(),
  journey_id  uuid not null references public.journeys (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  latitude    double precision not null check (latitude between -90 and 90),
  longitude   double precision not null check (longitude between -180 and 180),
  accuracy_m  numeric(8, 1) check (accuracy_m >= 0),
  source      text not null check (source in ('gps', 'planned', 'manual')),
  recorded_at timestamptz not null default now(),
  expires_at  timestamptz not null
);
create index if not exists journey_locations_journey_idx on public.journey_locations (journey_id, recorded_at desc);
create index if not exists journey_locations_expiry_idx on public.journey_locations (expires_at);

-- ---------------------------------------------------------------------------
-- safety_alerts — warnings generated from assessments (delivered via notifications)
-- ---------------------------------------------------------------------------
create table if not exists public.safety_alerts (
  id                        uuid primary key default gen_random_uuid(),
  user_id                   uuid references public.profiles (id) on delete cascade,  -- null = destination-wide
  destination_id            text references public.destinations (id) on delete cascade,
  journey_id                uuid references public.journeys (id) on delete cascade,
  destination_assessment_id uuid references public.destination_assessments (id) on delete set null,
  journey_assessment_id     uuid references public.journey_assessments (id) on delete set null,
  hazard_event_id           uuid references public.hazard_events (id) on delete set null,
  level          text not null check (level in ('MODERATE', 'HIGH', 'CRITICAL')),
  title          text not null check (char_length(title) between 1 and 160),
  body           text not null check (char_length(body) <= 2000),
  recommended_action text not null,
  dedup_key      text not null,
  status         text not null default 'active' check (status in ('active', 'acknowledged', 'expired', 'resolved')),
  issued_at      timestamptz not null default now(),
  expires_at     timestamptz not null,
  acknowledged_at timestamptz,
  constraint safety_alerts_expiry check (expires_at > issued_at)
);
create unique index if not exists safety_alerts_dedup_idx
  on public.safety_alerts (coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid), dedup_key)
  where status = 'active';
create index if not exists safety_alerts_user_idx on public.safety_alerts (user_id, status, issued_at desc);
create index if not exists safety_alerts_dest_idx on public.safety_alerts (destination_id, status);

alter table public.notifications add column if not exists safety_alert_id uuid
  references public.safety_alerts (id) on delete cascade;

-- ---------------------------------------------------------------------------
-- assessment_history — compact, append-only timeline for both assessment kinds
-- ---------------------------------------------------------------------------
create table if not exists public.assessment_history (
  id                uuid primary key default gen_random_uuid(),
  subject_type      text not null check (subject_type in ('destination', 'journey')),
  destination_id    text references public.destinations (id) on delete cascade,
  journey_id        uuid references public.journeys (id) on delete cascade,
  user_id           uuid references public.profiles (id) on delete cascade,
  assessment_id     uuid not null,
  risk_category     text check (risk_category in ('LOW', 'MODERATE', 'HIGH', 'CRITICAL')),
  previous_category text check (previous_category in ('LOW', 'MODERATE', 'HIGH', 'CRITICAL')),
  composite_index   numeric(5, 4),
  data_reliability  numeric(5, 4),
  assessment_status text not null,
  scoring_version   text not null,
  assessed_at       timestamptz not null,
  constraint assessment_history_subject check (
    (subject_type = 'destination' and destination_id is not null) or
    (subject_type = 'journey' and user_id is not null))
);
create index if not exists assessment_history_dest_idx on public.assessment_history (destination_id, assessed_at desc);
create index if not exists assessment_history_journey_idx on public.assessment_history (journey_id, assessed_at desc);

-- ---------------------------------------------------------------------------
-- emergency_facilities — cached OSM hospitals / police / fire stations
-- ---------------------------------------------------------------------------
create table if not exists public.emergency_facilities (
  osm_id       text primary key,
  kind         text not null check (kind in ('hospital', 'clinic', 'police', 'fire_station')),
  name         text,
  latitude     double precision not null check (latitude between -90 and 90),
  longitude    double precision not null check (longitude between -180 and 180),
  has_emergency boolean,
  retrieved_at timestamptz not null default now()
);
create index if not exists emergency_facilities_latlng_idx on public.emergency_facilities (latitude, longitude);

-- Areas already searched (so "no facilities found" is cached too, not re-queried every time)
create table if not exists public.facility_searches (
  cell_key     text primary key,   -- rounded lat/lng + radius
  latitude     double precision not null,
  longitude    double precision not null,
  radius_m     integer not null,
  result_count integer not null,
  searched_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- incidents: link to destinations / hazards, verification (used as historical evidence only when verified)
-- ---------------------------------------------------------------------------
alter table public.incidents add column if not exists destination_id text references public.destinations (id) on delete set null;
alter table public.incidents add column if not exists hazard_type text check (hazard_type in ('flood', 'landslide', 'wildfire',
  'cyclone', 'earthquake', 'volcano', 'drought', 'storm', 'heat', 'tsunami', 'other'));
alter table public.incidents add column if not exists verified boolean not null default false;
alter table public.incidents add column if not exists verified_by uuid references public.profiles (id) on delete set null;
alter table public.incidents add column if not exists assigned_to uuid references public.profiles (id) on delete set null;
create index if not exists incidents_dest_idx on public.incidents (destination_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- Scoring configuration registry
-- ---------------------------------------------------------------------------
insert into public.model_versions (id, kind, description, status, is_active) values
  ('scoring-v1', 'scoring',
   'Eight-factor destination + journey scoring baseline. Primary-hazard (max) categorisation, equal-weight composite '
   || 'index, critical override for verified red alerts. Thresholds from published definitions; weights not validated.',
   'active', true)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.destinations            enable row level security;
alter table public.data_sources            enable row level security;
alter table public.hazard_events           enable row level security;
alter table public.safety_indicators       enable row level security;
alter table public.destination_assessments enable row level security;
alter table public.journey_assessments     enable row level security;
alter table public.factor_assessments      enable row level security;
alter table public.journey_locations       enable row level security;
alter table public.safety_alerts           enable row level security;
alter table public.assessment_history      enable row level security;
alter table public.emergency_facilities    enable row level security;
alter table public.facility_searches       enable row level security;

-- Public safety information: readable by every signed-in user; written only by the services (table owner)
create policy destinations_read on public.destinations for select to authenticated using (active or public.is_staff());
create policy destinations_admin on public.destinations for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy data_sources_read on public.data_sources for select to authenticated using (true);
create policy hazard_events_read on public.hazard_events for select to authenticated using (true);
create policy safety_indicators_read on public.safety_indicators for select to authenticated using (true);
create policy destination_assessments_read on public.destination_assessments for select to authenticated using (true);
create policy emergency_facilities_read on public.emergency_facilities for select to authenticated using (true);

-- Journey assessments and their factors: owner + staff
create policy journey_assessments_read on public.journey_assessments for select to authenticated
  using (user_id = auth.uid() or public.is_staff());
create policy factor_assessments_read on public.factor_assessments for select to authenticated
  using (
    destination_assessment_id is not null
    or exists (select 1 from public.journey_assessments ja
               where ja.id = journey_assessment_id and (ja.user_id = auth.uid() or public.is_staff())));

-- Journey locations: owner writes/reads own (consent checked by the API), staff read
create policy journey_locations_owner on public.journey_locations for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and exists (
    select 1 from public.journeys j where j.id = journey_id and j.user_id = auth.uid()));
create policy journey_locations_staff_read on public.journey_locations for select to authenticated
  using (public.is_staff());

-- Alerts: own + destination-wide broadcasts; users may only acknowledge their own
create policy safety_alerts_read on public.safety_alerts for select to authenticated
  using (user_id = auth.uid() or user_id is null or public.is_staff());
create policy safety_alerts_ack_own on public.safety_alerts for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke update on public.safety_alerts from authenticated;
grant update (status, acknowledged_at) on public.safety_alerts to authenticated;

-- History: destination rows public; journey rows owner + staff
create policy assessment_history_read on public.assessment_history for select to authenticated
  using (subject_type = 'destination' or user_id = auth.uid() or public.is_staff());

-- ---------------------------------------------------------------------------
-- Optional PostGIS acceleration
-- ---------------------------------------------------------------------------
do $postgis$
begin
  if exists (select 1 from pg_available_extensions where name = 'postgis') then
    create extension if not exists postgis;
    execute 'alter table public.destinations add column if not exists geog geography(Point, 4326)
               generated always as (ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography) stored';
    execute 'create index if not exists destinations_geog_idx on public.destinations using gist (geog)';
    execute 'alter table public.hazard_events add column if not exists geog geography(Geometry, 4326)';
    execute 'create index if not exists hazard_events_geog_idx on public.hazard_events using gist (geog)';
    execute 'create or replace function public.hazard_events_set_geog() returns trigger language plpgsql as $f$
             begin
               new.geog := coalesce(
                 case when new.geometry is not null
                      then ST_SetSRID(ST_GeomFromGeoJSON(new.geometry::text), 4326)::geography end,
                 ST_SetSRID(ST_MakePoint(new.longitude, new.latitude), 4326)::geography);
               return new;
             exception when others then
               new.geog := ST_SetSRID(ST_MakePoint(new.longitude, new.latitude), 4326)::geography;
               return new;
             end $f$';
    execute 'drop trigger if exists hazard_events_geog on public.hazard_events';
    execute 'create trigger hazard_events_geog before insert or update of geometry, latitude, longitude
               on public.hazard_events for each row execute function public.hazard_events_set_geog()';
    execute 'alter table public.emergency_facilities add column if not exists geog geography(Point, 4326)
               generated always as (ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography) stored';
    execute 'create index if not exists emergency_facilities_geog_idx on public.emergency_facilities using gist (geog)';
    execute 'alter table public.incidents add column if not exists geog geography(Point, 4326)
               generated always as (case when latitude is null then null
                 else ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography end) stored';
    execute 'create index if not exists incidents_geog_idx on public.incidents using gist (geog)';
    raise notice 'PostGIS enabled: geography columns and GiST indexes created';
  else
    raise notice 'PostGIS not available: using lat/lng B-tree indexes; geometry computed in the risk service';
  end if;
end
$postgis$;
