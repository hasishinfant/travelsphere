-- RLS acceptance tests for the risk-intelligence tables (migration 0004).
--   psql -v ON_ERROR_STOP=1 -d <db> -f supabase/tests/rls_risk_test.sql
-- Each check raises on failure; everything is rolled back.
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'ann@test.local'),
  ('00000000-0000-0000-0000-0000000000b2', 'ben@test.local'),
  ('00000000-0000-0000-0000-0000000000c3', 'rhea@test.local');
update public.profiles set role = 'responder' where id = '00000000-0000-0000-0000-0000000000c3';

create or replace function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid::text, true);
  execute 'set local role authenticated';
end $$;

-- fixtures written by the services (table owner)
insert into public.journeys (id, user_id, destination_id, destination_name, start_date, end_date) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'kyoto', 'Kyoto', '2027-01-10', '2027-01-12');
insert into public.destination_assessments (id, destination_id, risk_category, assessment_status, data_coverage, explanation,
  scoring_version, engine_version, inputs_hash)
values ('20000000-0000-0000-0000-000000000001', 'kyoto', 'LOW', 'COMPLETE', 1, '{}', 'scoring-v1', 't', 'h');
insert into public.journey_assessments (id, journey_id, user_id, destination_id, risk_category, assessment_status,
  dimensions, explanation, scoring_version, engine_version)
values ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1',
  'kyoto', 'HIGH', 'COMPLETE', '{}', '{}', 'scoring-v1', 't');
insert into public.factor_assessments (journey_assessment_id, factor_key, status, explanation)
values ('30000000-0000-0000-0000-000000000001', 'route_exposure', 'derived', 'x');
insert into public.factor_assessments (destination_assessment_id, factor_key, status, explanation)
values ('20000000-0000-0000-0000-000000000001', 'weather_severity', 'measured', 'x');
insert into public.safety_alerts (id, user_id, destination_id, level, title, body, recommended_action, dedup_key, expires_at) values
  ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'kyoto', 'HIGH', 't', 'b', 'a', 'k1', now() + interval '1 hour'),
  ('40000000-0000-0000-0000-000000000002', null, 'kyoto', 'HIGH', 't', 'b', 'a', 'k2', now() + interval '1 hour');

-- ---------------------------------------------------------------- Ben (another traveller)
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');
do $$ begin
  if not exists (select 1 from public.destination_assessments) then raise exception 'FAIL: destination assessments not public'; end if;
  if exists (select 1 from public.journey_assessments) then raise exception 'FAIL: Ben sees Ann''s journey assessment'; end if;
  if exists (select 1 from public.factor_assessments where journey_assessment_id is not null) then
    raise exception 'FAIL: Ben sees Ann''s journey factors'; end if;
  if not exists (select 1 from public.factor_assessments where destination_assessment_id is not null) then
    raise exception 'FAIL: destination factors not visible'; end if;
  if (select count(*) from public.safety_alerts) <> 1 then raise exception 'FAIL: Ben should only see the broadcast alert'; end if;
  begin
    insert into public.journey_locations (journey_id, user_id, latitude, longitude, source, expires_at)
    values ('10000000-0000-0000-0000-000000000001', auth.uid(), 35, 135.7, 'gps', now() + interval '1 day');
    raise exception 'FAIL: Ben stored a location on Ann''s journey';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.hazard_events (source_id, external_id, hazard_type, title, severity_class, latitude, longitude, valid_from, observed_at)
    values ('gdacs', 'fake', 'flood', 'Fake flood', 'extreme', 35, 135, now(), now());
    raise exception 'FAIL: traveller wrote a hazard event';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.destination_assessments (destination_id, assessment_status, data_coverage, explanation, scoring_version, engine_version, inputs_hash)
    values ('kyoto', 'COMPLETE', 1, '{}', 'scoring-v1', 't', 'h');
    raise exception 'FAIL: traveller wrote an assessment';
  exception when insufficient_privilege then null; end;
  update public.safety_alerts set status = 'acknowledged' where id = '40000000-0000-0000-0000-000000000002';
end $$;
reset role;
do $$ begin
  if (select status from public.safety_alerts where id = '40000000-0000-0000-0000-000000000002') <> 'active' then
    raise exception 'FAIL: a traveller acknowledged a broadcast alert for everyone'; end if;
end $$;

-- ---------------------------------------------------------------- Ann (owner)
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
do $$ begin
  if not exists (select 1 from public.journey_assessments) then raise exception 'FAIL: Ann cannot see her journey assessment'; end if;
  insert into public.journey_locations (journey_id, user_id, latitude, longitude, source, expires_at)
  values ('10000000-0000-0000-0000-000000000001', auth.uid(), 35, 135.7, 'gps', now() + interval '1 day');
  update public.safety_alerts set status = 'acknowledged', acknowledged_at = now() where id = '40000000-0000-0000-0000-000000000001';
  begin
    update public.safety_alerts set level = 'MODERATE' where id = '40000000-0000-0000-0000-000000000001';
    raise exception 'FAIL: Ann rewrote an alert level';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- ---------------------------------------------------------------- Rhea (responder)
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c3');
do $$ begin
  if not exists (select 1 from public.journey_assessments) then raise exception 'FAIL: responder cannot see journey assessments'; end if;
  if not exists (select 1 from public.journey_locations) then raise exception 'FAIL: responder cannot see journey locations'; end if;
end $$;
reset role;

select 'Risk RLS tests passed' as result;
rollback;
