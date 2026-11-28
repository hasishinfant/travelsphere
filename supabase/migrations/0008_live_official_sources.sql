-- 0008 — official live sources: national weather-service warnings and government travel advice.

alter table public.data_sources drop constraint if exists data_sources_kind_check;
alter table public.data_sources add constraint data_sources_kind_check check (kind in ('weather', 'hazard', 'routing',
  'facilities', 'population', 'incidents', 'reanalysis', 'configured', 'advisory'));

insert into public.data_sources (id, name, kind, credibility_tier, url, licence, max_age_minutes) values
  ('meteoalarm', 'MeteoAlarm — official warnings of European national weather services (EUMETNET)', 'hazard', 'official',
   'https://feeds.meteoalarm.org', 'MeteoAlarm terms of use (attribution)', 60),
  ('nws', 'US National Weather Service alerts', 'hazard', 'official', 'https://api.weather.gov',
   'Public domain (US Government)', 30),
  ('us-state-dept-advisories', 'US Department of State travel advisories', 'advisory', 'official',
   'https://cadataapi.state.gov/api/TravelAdvisories', 'Public domain (US Government)', 10080),
  ('fcdo-travel-advice', 'UK FCDO foreign travel advice (GOV.UK content API)', 'advisory', 'official',
   'https://www.gov.uk/foreign-travel-advice', 'Open Government Licence v3.0', 10080)
on conflict (id) do nothing;
