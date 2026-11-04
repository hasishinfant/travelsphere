-- Row Level Security (spec §10 "Database Security")
-- Travellers see only their own data; responders/admins see operational data.
-- Writes to environment data, assessments and model records are server-only
-- (no policy for `authenticated` → denied; the backend writes as the table owner).

alter table public.profiles                 enable row level security;
alter table public.journeys                 enable row level security;
alter table public.itinerary_items          enable row level security;
alter table public.risk_zones               enable row level security;
alter table public.environment_observations enable row level security;
alter table public.model_versions           enable row level security;
alter table public.risk_assessments         enable row level security;
alter table public.incidents                enable row level security;
alter table public.incident_updates         enable row level security;
alter table public.notifications            enable row level security;
alter table public.device_tokens            enable row level security;
alter table public.feedback                 enable row level security;

-- profiles -----------------------------------------------------------------
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_staff());
create policy profiles_insert_own on public.profiles for insert to authenticated
  with check (id = auth.uid() and role = 'traveller');
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- journeys -----------------------------------------------------------------
create policy journeys_owner_all on public.journeys for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
create policy journeys_staff_read on public.journeys for select to authenticated
  using (public.is_staff());

-- itinerary_items (ownership via the parent journey) ------------------------
create policy itinerary_owner_all on public.itinerary_items for all to authenticated
  using (exists (select 1 from public.journeys j where j.id = journey_id and j.user_id = auth.uid()))
  with check (exists (select 1 from public.journeys j where j.id = journey_id and j.user_id = auth.uid()));
create policy itinerary_staff_read on public.itinerary_items for select to authenticated
  using (public.is_staff());

-- risk zones: everyone signed in can read active zones; admins manage --------
create policy risk_zones_read on public.risk_zones for select to authenticated
  using (active or public.is_staff());
create policy risk_zones_admin_write on public.risk_zones for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- environment observations / model versions: read-only for signed-in users --
create policy environment_read on public.environment_observations for select to authenticated using (true);
create policy model_versions_read on public.model_versions for select to authenticated using (true);

-- risk assessments: own + staff; inserted only by the backend ----------------
create policy assessments_read on public.risk_assessments for select to authenticated
  using (user_id = auth.uid() or public.is_staff());

-- incidents ------------------------------------------------------------------
create policy incidents_insert_own on public.incidents for insert to authenticated
  with check (reporter_id = auth.uid() and status = 'open');
create policy incidents_read on public.incidents for select to authenticated
  using (reporter_id = auth.uid() or public.is_staff());
create policy incidents_staff_update on public.incidents for update to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- incident updates: visible with the incident; reporters may add notes only --
create policy incident_updates_read on public.incident_updates for select to authenticated
  using (exists (select 1 from public.incidents i
                 where i.id = incident_id and (i.reporter_id = auth.uid() or public.is_staff())));
create policy incident_updates_reporter_note on public.incident_updates for insert to authenticated
  with check (author_id = auth.uid() and status is null and exists (
    select 1 from public.incidents i where i.id = incident_id and i.reporter_id = auth.uid()));
create policy incident_updates_staff_insert on public.incident_updates for insert to authenticated
  with check (author_id = auth.uid() and public.is_staff());

-- notifications: own; users may only acknowledge -----------------------------
create policy notifications_read_own on public.notifications for select to authenticated
  using (user_id = auth.uid());
create policy notifications_ack_own on public.notifications for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- device tokens: own --------------------------------------------------------
create policy device_tokens_own on public.device_tokens for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- feedback: own write/read, staff read --------------------------------------
create policy feedback_insert_own on public.feedback for insert to authenticated
  with check (user_id = auth.uid());
create policy feedback_read on public.feedback for select to authenticated
  using (user_id = auth.uid() or public.is_staff());

-- Column-level guard: travellers can acknowledge notifications but not rewrite them
revoke update on public.notifications from authenticated;
grant update (acknowledged_at) on public.notifications to authenticated;
