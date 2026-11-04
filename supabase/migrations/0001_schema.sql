-- TravelSphere schema (spec §10)
-- Runs unchanged on Supabase Postgres. For a plain local Postgres, apply
-- supabase/local/00_auth_shim.sql first (it creates the auth schema/roles Supabase provides).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- profiles — one row per auth user
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id                       uuid primary key references auth.users (id) on delete cascade,
  email                    text,
  full_name                text check (char_length(full_name) between 1 and 120),
  home_airport             char(3) check (home_airport ~ '^[A-Z]{3}$'),
  home_city                text check (char_length(home_city) <= 80),
  role                     text not null default 'traveller'
                             check (role in ('traveller', 'responder', 'admin')),
  notification_preferences jsonb not null default
                             '{"in_app": true, "web_push": false, "min_risk_level": "MODERATE"}'::jsonb,
  location_consent         boolean not null default false,
  location_retention_days  smallint not null default 30 check (location_retention_days between 0 and 365),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- Create a profile automatically when an auth user is created
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, nullif(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Role helpers used by RLS policies (security definer avoids recursive RLS on profiles)
create or replace function public.current_role_name()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.current_role_name() in ('responder', 'admin'), false)
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.current_role_name() = 'admin', false)
$$;

-- Travellers may not change their own role
create or replace function public.guard_profile_role()
returns trigger language plpgsql as $$
begin
  if new.role is distinct from old.role and not public.is_admin() and auth.uid() is not null then
    raise exception 'only administrators can change roles' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger profiles_guard_role before update on public.profiles
  for each row execute function public.guard_profile_role();

-- ---------------------------------------------------------------------------
-- journeys and itinerary_items
-- ---------------------------------------------------------------------------
create table if not exists public.journeys (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles (id) on delete cascade,
  title            text check (char_length(title) <= 120),
  destination_id   text not null check (destination_id ~ '^[a-z0-9-]{2,40}$'),
  destination_name text not null check (char_length(destination_name) between 1 and 120),
  latitude         double precision check (latitude between -90 and 90),
  longitude        double precision check (longitude between -180 and 180),
  start_date       date not null,
  end_date         date not null,
  travellers       smallint not null default 1 check (travellers between 1 and 20),
  budget           text check (budget in ('low', 'medium', 'luxury')),
  interests        text[] not null default '{}',
  status           text not null default 'planned'
                     check (status in ('planned', 'active', 'completed', 'cancelled')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint journeys_dates check (end_date >= start_date),
  constraint journeys_coords check ((latitude is null) = (longitude is null))
);
create index if not exists journeys_user_start_idx on public.journeys (user_id, start_date);
create trigger journeys_updated_at before update on public.journeys
  for each row execute function public.set_updated_at();

create table if not exists public.itinerary_items (
  id                       uuid primary key default gen_random_uuid(),
  journey_id               uuid not null references public.journeys (id) on delete cascade,
  day_number               smallint not null check (day_number between 1 and 60),
  position                 smallint not null default 0 check (position >= 0),
  title                    text not null check (char_length(title) between 1 and 160),
  description              text check (char_length(description) <= 1000),
  category                 text check (char_length(category) <= 40),
  activity_type            text not null default 'sightseeing'
                             check (activity_type in ('sightseeing', 'trekking', 'water', 'transit',
                                                      'dining', 'shopping', 'indoor', 'other')),
  latitude                 double precision check (latitude between -90 and 90),
  longitude                double precision check (longitude between -180 and 180),
  planned_start            timestamptz,
  planned_duration_minutes integer check (planned_duration_minutes between 0 and 1440),
  created_at               timestamptz not null default now(),
  constraint itinerary_items_coords check ((latitude is null) = (longitude is null))
);
create index if not exists itinerary_items_journey_idx on public.itinerary_items (journey_id, day_number, position);

-- ---------------------------------------------------------------------------
-- Geospatial and environmental data
-- ---------------------------------------------------------------------------
-- Zones are circles (centre + radius). PostGIS polygons can be added later via `geometry jsonb`.
create table if not exists public.risk_zones (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 120),
  hazard_type text not null check (hazard_type in ('flood', 'landslide', 'wildfire', 'storm', 'heat',
                                                   'avalanche', 'crime', 'restricted', 'other')),
  severity    text not null check (severity in ('LOW', 'MODERATE', 'HIGH')),
  latitude    double precision not null check (latitude between -90 and 90),
  longitude   double precision not null check (longitude between -180 and 180),
  radius_m    integer not null check (radius_m between 10 and 200000),
  geometry    jsonb,
  source      text not null check (char_length(source) between 1 and 200),
  valid_from  timestamptz,
  valid_to    timestamptz,
  active      boolean not null default true,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  constraint risk_zones_validity check (valid_to is null or valid_from is null or valid_to > valid_from)
);
create index if not exists risk_zones_active_idx on public.risk_zones (active, latitude, longitude);

create table if not exists public.environment_observations (
  id             uuid primary key default gen_random_uuid(),
  latitude       double precision not null check (latitude between -90 and 90),
  longitude      double precision not null check (longitude between -180 and 180),
  observed_at    timestamptz not null,
  fetched_at     timestamptz not null default now(),
  source         text not null,
  rainfall_mm_h  numeric(6, 2) check (rainfall_mm_h between 0 and 500),
  temperature_c  numeric(5, 2) check (temperature_c between -90 and 65),
  wind_speed_ms  numeric(5, 2) check (wind_speed_ms between 0 and 120),
  humidity_pct   numeric(5, 2) check (humidity_pct between 0 and 100),
  conditions     text,
  raw            jsonb,
  constraint environment_observations_order check (observed_at <= fetched_at + interval '5 minutes')
);
create index if not exists environment_observations_loc_time_idx
  on public.environment_observations (latitude, longitude, observed_at desc);

-- ---------------------------------------------------------------------------
-- Model registry and risk assessments
-- ---------------------------------------------------------------------------
create table if not exists public.model_versions (
  id          text primary key check (id ~ '^[a-z0-9._-]{3,60}$'),
  kind        text not null check (kind in ('rules', 'ml')),
  description text,
  metrics     jsonb not null default '{}'::jsonb,
  trained_at  timestamptz,
  is_active   boolean not null default false,
  created_at  timestamptz not null default now()
);

create table if not exists public.risk_assessments (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.profiles (id) on delete cascade,
  journey_id          uuid references public.journeys (id) on delete cascade,
  itinerary_item_id   uuid references public.itinerary_items (id) on delete set null,
  observation_id      uuid references public.environment_observations (id) on delete set null,
  latitude            double precision check (latitude between -90 and 90),
  longitude           double precision check (longitude between -180 and 180),
  location_accuracy_m numeric(8, 1) check (location_accuracy_m >= 0),
  risk_level          text not null check (risk_level in ('LOW', 'MODERATE', 'HIGH', 'CRITICAL')),
  method              text not null check (method in ('rules', 'ml')),
  reasons             jsonb not null default '[]'::jsonb,
  recommended_action  text not null,
  features            jsonb not null default '{}'::jsonb,
  data_status         text not null check (data_status in ('CURRENT', 'STALE', 'PARTIAL', 'UNAVAILABLE')),
  uncertainty         text,
  model_version       text not null references public.model_versions (id),
  created_at          timestamptz not null default now()
);
create index if not exists risk_assessments_user_time_idx on public.risk_assessments (user_id, created_at desc);
create index if not exists risk_assessments_journey_idx on public.risk_assessments (journey_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Incidents
-- ---------------------------------------------------------------------------
create table if not exists public.incidents (
  id                  uuid primary key default gen_random_uuid(),
  reference           text not null unique default ('INC-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
  reporter_id         uuid not null references public.profiles (id) on delete cascade,
  journey_id          uuid references public.journeys (id) on delete set null,
  category            text not null check (category in ('medical', 'accident', 'natural_hazard', 'unsafe_location',
                                                        'lost_traveller', 'security', 'other')),
  priority            text not null default 'normal' check (priority in ('low', 'normal', 'high', 'critical')),
  status              text not null default 'open'
                        check (status in ('open', 'acknowledged', 'in_progress', 'resolved', 'closed')),
  title               text not null check (char_length(title) between 3 and 160),
  description         text check (char_length(description) <= 4000),
  latitude            double precision check (latitude between -90 and 90),
  longitude           double precision check (longitude between -180 and 180),
  location_accuracy_m numeric(8, 1) check (location_accuracy_m >= 0),
  occurred_at         timestamptz not null default now(),
  is_sos              boolean not null default false,
  attachment_paths    text[] not null default '{}',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint incidents_coords check ((latitude is null) = (longitude is null))
);
create index if not exists incidents_status_priority_idx on public.incidents (status, priority, created_at desc);
create index if not exists incidents_reporter_idx on public.incidents (reporter_id, created_at desc);
create trigger incidents_updated_at before update on public.incidents
  for each row execute function public.set_updated_at();

create table if not exists public.incident_updates (
  id          uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents (id) on delete cascade,
  author_id   uuid references public.profiles (id) on delete set null,
  status      text check (status in ('open', 'acknowledged', 'in_progress', 'resolved', 'closed')),
  note        text check (char_length(note) <= 2000),
  created_at  timestamptz not null default now(),
  constraint incident_updates_content check (status is not null or note is not null)
);
create index if not exists incident_updates_incident_idx on public.incident_updates (incident_id, created_at);

-- ---------------------------------------------------------------------------
-- Notifications, devices, feedback
-- ---------------------------------------------------------------------------
create table if not exists public.notifications (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles (id) on delete cascade,
  assessment_id   uuid references public.risk_assessments (id) on delete set null,
  incident_id     uuid references public.incidents (id) on delete cascade,
  kind            text not null check (kind in ('risk_warning', 'incident_update', 'system')),
  title           text not null check (char_length(title) between 1 and 160),
  body            text not null check (char_length(body) <= 2000),
  risk_level      text check (risk_level in ('LOW', 'MODERATE', 'HIGH', 'CRITICAL')),
  dedup_key       text,
  channel         text not null default 'in_app' check (channel in ('in_app', 'web_push', 'fcm')),
  delivery_status text not null default 'pending' check (delivery_status in ('pending', 'sent', 'failed')),
  acknowledged_at timestamptz,
  expires_at      timestamptz,
  created_at      timestamptz not null default now()
);
-- Same unchanged condition → same dedup_key → one notification per user (alert deduplication)
create unique index if not exists notifications_dedup_idx on public.notifications (user_id, dedup_key)
  where dedup_key is not null;
create index if not exists notifications_user_time_idx on public.notifications (user_id, created_at desc);

create table if not exists public.device_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  platform     text not null check (platform in ('web_push', 'fcm')),
  token        text not null check (char_length(token) between 10 and 4096),
  subscription jsonb,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (user_id, token)
);

create table if not exists public.feedback (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  assessment_id uuid references public.risk_assessments (id) on delete set null,
  incident_id   uuid references public.incidents (id) on delete set null,
  kind          text not null check (kind in ('false_alert', 'helpful', 'incident_outcome', 'general')),
  rating        smallint check (rating between 1 and 5),
  comment       text check (char_length(comment) <= 2000),
  created_at    timestamptz not null default now()
);

-- Baseline model registered so assessments always reference a known version
insert into public.model_versions (id, kind, description, is_active)
values ('rules-v1', 'rules', 'Deterministic rule baseline (prototype thresholds — not calibrated)', true)
on conflict (id) do nothing;
