-- Emergency workflow: server-side storage for the emergency forms, SOS idempotency, responder alerts,
-- delivery logging, facility phone numbers and minimal location retention.
-- See docs/EMERGENCY_SYSTEM_AUDIT.md.

-- ---------------------------------------------------------------------------
-- incidents: categories for the lost-document and local-help forms, structured form fields, idempotency
-- ---------------------------------------------------------------------------
alter table public.incidents drop constraint if exists incidents_category_check;
alter table public.incidents add constraint incidents_category_check check (category in (
  'medical', 'accident', 'natural_hazard', 'unsafe_location', 'lost_traveller', 'security', 'other',
  'lost_documents', 'assistance'));

-- Form fields that have no column of their own (assistance type, urgency, insurance, document type, ...).
-- Validated per category by the API; readable only by the reporter and staff (incidents RLS).
alter table public.incidents add column if not exists details jsonb not null default '{}'::jsonb;
alter table public.incidents drop constraint if exists incidents_details_object;
alter table public.incidents add constraint incidents_details_object
  check (jsonb_typeof(details) = 'object' and pg_column_size(details) <= 8192);

-- Client-generated key: a retried or double-tapped submission returns the incident already created
alter table public.incidents add column if not exists client_request_id uuid;
create unique index if not exists incidents_client_request_idx
  on public.incidents (reporter_id, client_request_id) where client_request_id is not null;

-- ---------------------------------------------------------------------------
-- Minimal location retention: precise coordinates of finished incidents are coarsened to ~1 km after
-- 30 days. Coarse points still count as (verified) historical evidence for the risk engine.
-- ---------------------------------------------------------------------------
alter table public.incidents add column if not exists location_coarsened_at timestamptz;

create or replace function public.coarsen_incident_locations(older_than interval default interval '30 days')
returns integer language sql as $$
  with done as (
    update public.incidents
       set latitude = round(latitude::numeric, 2)::double precision,
           longitude = round(longitude::numeric, 2)::double precision,
           location_accuracy_m = greatest(coalesce(location_accuracy_m, 0), 1000),
           location_coarsened_at = now()
     where status in ('resolved', 'closed') and latitude is not null and location_coarsened_at is null
       and updated_at < now() - older_than
    returning 1)
  select count(*)::integer from done;
$$;
revoke all on function public.coarsen_incident_locations(interval) from public;

-- ---------------------------------------------------------------------------
-- notifications: responder alerts for new incidents, and honest delivery logging
--   delivery_status 'sent' means the push service ACCEPTED the message, not that a person saw it.
-- ---------------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('risk_warning', 'incident_update', 'incident_alert', 'system'));
alter table public.notifications add column if not exists delivery_error text
  check (char_length(delivery_error) <= 500);
alter table public.notifications add column if not exists delivery_attempted_at timestamptz;

-- ---------------------------------------------------------------------------
-- emergency_facilities: phone and healthcare tags, only when OpenStreetMap has them
-- ---------------------------------------------------------------------------
alter table public.emergency_facilities add column if not exists phone text check (char_length(phone) <= 64);
alter table public.emergency_facilities add column if not exists healthcare text check (char_length(healthcare) <= 64);
-- Cached searches predate the phone column: forget them so the next lookup refetches with phone numbers
delete from public.facility_searches;
