-- RLS acceptance tests. Run against a database with the shim + migrations applied:
--   psql -v ON_ERROR_STOP=1 -d <db> -f supabase/tests/rls_test.sql
-- Every check raises an exception on failure, so a clean run = all policies hold.
-- Everything runs inside a transaction that is rolled back.

begin;

-- fixtures (as table owner)
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'alice@test.local', '{"full_name":"Alice"}'),
  ('00000000-0000-0000-0000-00000000000b', 'bob@test.local',   '{"full_name":"Bob"}'),
  ('00000000-0000-0000-0000-00000000000c', 'rita@test.local',  '{"full_name":"Rita Responder"}');
update public.profiles set role = 'responder' where id = '00000000-0000-0000-0000-00000000000c';

do $$ begin
  if (select count(*) from public.profiles where email like '%@test.local') <> 3 then
    raise exception 'FAIL: handle_new_user trigger did not create profiles';
  end if;
end $$;

-- helper to act as a user
create or replace function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid::text, true);
  execute 'set local role authenticated';
end $$;

-- ---------------------------------------------------------------- Alice
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');

insert into public.journeys (user_id, destination_id, destination_name, start_date, end_date)
values ('00000000-0000-0000-0000-00000000000a', 'paris', 'Paris, France', '2027-01-10', '2027-01-15');

insert into public.itinerary_items (journey_id, day_number, title)
select id, 1, 'Eiffel Tower' from public.journeys;

insert into public.incidents (reporter_id, category, title)
values ('00000000-0000-0000-0000-00000000000a', 'medical', 'Twisted ankle on stairs');

do $$ begin
  -- cannot create a journey for someone else
  begin
    insert into public.journeys (user_id, destination_id, destination_name, start_date, end_date)
    values ('00000000-0000-0000-0000-00000000000b', 'rome', 'Rome', '2027-01-10', '2027-01-12');
    raise exception 'FAIL: inserted a journey for another user';
  exception when insufficient_privilege then null; end;

  -- cannot promote herself
  begin
    update public.profiles set role = 'admin' where id = auth.uid();
    raise exception 'FAIL: traveller changed own role';
  exception when insufficient_privilege then null; end;

  -- cannot open an incident pre-resolved
  begin
    insert into public.incidents (reporter_id, category, title, status)
    values (auth.uid(), 'other', 'Fake resolved', 'resolved');
    raise exception 'FAIL: reporter set a non-open status';
  exception when insufficient_privilege then null; end;

  -- cannot change incident status (staff only) — update silently affects 0 rows
  update public.incidents set status = 'closed';
  if exists (select 1 from public.incidents where status = 'closed') then
    raise exception 'FAIL: traveller closed an incident';
  end if;

  -- cannot write risk assessments (server-only)
  begin
    insert into public.risk_assessments (user_id, risk_level, method, recommended_action, data_status, model_version)
    values (auth.uid(), 'LOW', 'rules', 'x', 'CURRENT', 'rules-v1');
    raise exception 'FAIL: traveller inserted a risk assessment';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- ---------------------------------------------------------------- Bob
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
do $$ begin
  if exists (select 1 from public.journeys) then raise exception 'FAIL: Bob can see Alice''s journey'; end if;
  if exists (select 1 from public.itinerary_items) then raise exception 'FAIL: Bob can see Alice''s itinerary'; end if;
  if exists (select 1 from public.incidents) then raise exception 'FAIL: Bob can see Alice''s incident'; end if;
  if (select count(*) from public.profiles) <> 1 then raise exception 'FAIL: Bob can see other profiles'; end if;
  update public.journeys set title = 'hijacked';
  delete from public.itinerary_items;
end $$;
reset role;

do $$ begin
  if exists (select 1 from public.journeys where title = 'hijacked') then raise exception 'FAIL: Bob updated Alice''s journey'; end if;
  if not exists (select 1 from public.itinerary_items) then raise exception 'FAIL: Bob deleted Alice''s itinerary'; end if;
end $$;

-- ---------------------------------------------------------------- Responder
select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
do $$ begin
  if (select count(*) from public.incidents) <> 1 then raise exception 'FAIL: responder cannot see incidents'; end if;
  update public.incidents set status = 'acknowledged';
  if not exists (select 1 from public.incidents where status = 'acknowledged') then
    raise exception 'FAIL: responder could not update incident status';
  end if;
  insert into public.incident_updates (incident_id, author_id, status, note)
  select id, auth.uid(), 'acknowledged', 'On our way' from public.incidents;
  -- responders are staff but not admins: cannot manage risk zones
  begin
    insert into public.risk_zones (name, hazard_type, severity, latitude, longitude, radius_m, source)
    values ('Test zone', 'flood', 'HIGH', 1, 1, 500, 'test');
    raise exception 'FAIL: responder created a risk zone';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- ---------------------------------------------------------------- Alice sees the update
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
do $$ begin
  if not exists (select 1 from public.incident_updates where note = 'On our way') then
    raise exception 'FAIL: reporter cannot see responder update';
  end if;
end $$;
reset role;

select 'RLS tests passed' as result;
rollback;
