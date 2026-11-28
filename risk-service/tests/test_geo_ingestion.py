"""Geometry, solar position, provider parsers (on real recorded responses), HTTP resilience, data quality."""
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from shapely.geometry import LineString, Point

from app.geospatial.geometry import distance_m, geodesic_circle, geodesic_m, parse_geojson, route_hazard_overlay, valid_coordinate
from app.geospatial.solar import darkness_fraction, solar_elevation
from app.ingestion import gdacs, open_meteo, usgs
from app.ingestion.http import FetchResult, HttpClient, ProviderError
from app.processing.data_quality import freshness_score, merge_duplicate_hazards, weather_internal_agreement
from tests.conftest import NOW, fixture, hazard


# ------------------------------------------------------------------ geometry
def test_geodesic_paris_london():
    assert geodesic_m(48.8566, 2.3522, 51.5074, -0.1278) == pytest.approx(343_900, rel=0.005)


def test_circle_has_true_radius_and_contains_centre():
    c = geodesic_circle(60.0, 10.0, 10_000)  # high latitude: degrees would be badly distorted
    assert c.contains(Point(10.0, 60.0))
    assert distance_m(Point(10.0, 60.0 + 20_000 / 111_320), c) == pytest.approx(10_000, rel=0.01)


def test_overlay_length():
    circle = geodesic_circle(0.5, 0.5, 5_000)
    line = LineString([(0.3, 0.5), (0.7, 0.5)])
    ov = route_hazard_overlay(line, [("z", circle)])
    assert ov["exposed_m"] == pytest.approx(10_000, rel=0.01) and ov["per_hazard_m"]["z"] == pytest.approx(10_000, rel=0.01)


def test_invalid_coordinates_and_geojson():
    assert not valid_coordinate(0, 0) and not valid_coordinate(91, 0) and valid_coordinate(35, 135)
    assert parse_geojson({"type": "Polygon", "coordinates": []}) is None
    bowtie = {"type": "Polygon", "coordinates": [[[0, 0], [1, 1], [1, 0], [0, 1], [0, 0]]]}
    assert parse_geojson(bowtie).is_valid  # self-intersecting input repaired


# ------------------------------------------------------------------ solar
def test_solar_day_night_and_polar_night():
    assert solar_elevation(34.99, 135.78, datetime(2026, 11, 22, 3, tzinfo=timezone.utc)) > 20      # Kyoto noon
    assert solar_elevation(34.99, 135.78, datetime(2026, 11, 22, 15, tzinfo=timezone.utc)) < -30    # Kyoto midnight
    noon = datetime(2026, 12, 21, 11, tzinfo=timezone.utc)
    assert darkness_fraction(69.65, 18.96, noon - timedelta(hours=1), noon + timedelta(hours=1)) == 1.0  # Tromsø


# ------------------------------------------------------------------ open-meteo (real response)
def test_parse_real_open_meteo():
    body = fixture("open_meteo_kyoto.json")
    fr = FetchResult("open-meteo-forecast", "u", body, datetime.now(timezone.utc))
    s = open_meteo.parse_forecast(body, 34.9986, 135.785, fr)
    assert s.timezone == "Asia/Tokyo" and s.utc_offset_s == 32400
    assert len(s.hourly) == 23 * 24 and len(s.daily_precip_mm) == 23  # 7 past + 16 forecast days
    assert s.current.temperature_c is not None and s.sunrise and s.sunset


def test_open_meteo_rejects_invalid_values_and_future_time():
    body = fixture("open_meteo_kyoto.json")
    body["current"]["wind_gusts_10m"] = 999
    fr = FetchResult("open-meteo-forecast", "u", body, datetime.now(timezone.utc))
    assert open_meteo.parse_forecast(body, 35, 135.8, fr).current.wind_gust_ms is None
    body["current"]["time"] = int((datetime.now(timezone.utc) + timedelta(hours=3)).timestamp())
    with pytest.raises(ProviderError):
        open_meteo.parse_forecast(body, 35, 135.8, fr)


# ------------------------------------------------------------------ gdacs (real Typhoon Bebinca 2024)
def test_parse_real_gdacs_cyclone_with_wind_buffers():
    f = fixture("gdacs_tc.json")
    ev = gdacs.parse_event(f["event"], NOW)
    assert ev.hazard_type == "cyclone" and ev.alert_level == "orange" and ev.severity_class == "severe"
    ev = gdacs.apply_footprint(ev, f["geometry"])
    assert ev.has_footprint and {z[0] for z in ev.zones} == {"moderate", "severe", "extreme"}
    red = next(g for c, g, _ in ev.zones if c == "extreme")
    green = next(g for c, g, _ in ev.zones if c == "moderate")
    assert green.area > red.area  # gale buffer encloses the hurricane-force core


def test_gdacs_inverted_dates_repaired():
    f = fixture("gdacs_tc.json")["event"]
    f["properties"] = {**f["properties"], "iscurrent": "false", "fromdate": "2024-09-10T00:00:00", "todate": "2024-09-09T00:00:00"}
    ev = gdacs.parse_event(f, NOW)
    assert ev.valid_to >= ev.valid_from


# ------------------------------------------------------------------ usgs (real 2024 Noto earthquake)
def test_parse_real_usgs_pager_red():
    ev = usgs.parse_feature(fixture("usgs_noto.json"), NOW, active=False)
    assert ev.severity_value == 7.5 and ev.alert_level == "red" and ev.severity_class == "extreme"


@pytest.mark.parametrize("m,cls", [(4.5, "minor"), (5.0, "moderate"), (6.2, "severe"), (7.0, "extreme")])
def test_usgs_magnitude_classes(m, cls):
    assert usgs.magnitude_class(m) == cls


# ------------------------------------------------------------------ geocoding (real)
async def test_lookup_place_prefers_populated_place(monkeypatch):
    from app.ingestion import http as http_mod
    async def fake(self, *a, **k):
        return FetchResult("open-meteo-geocoding", "u", fixture("geocoding_kyoto.json"), NOW)
    monkeypatch.setattr(http_mod.HttpClient, "get_json", fake)
    info = await open_meteo.lookup_place("Kyoto", 34.9986, 135.785)
    assert info.feature_code.startswith("PPL") and info.population > 1_000_000


# ------------------------------------------------------------------ http client resilience
def client(handler) -> HttpClient:
    return HttpClient(timeout_s=2, retries=2, transport=httpx.MockTransport(handler), max_backoff_s=0.01, min_interval_s={})


async def test_retries_then_succeeds_and_caches():
    calls = []
    def handler(req):
        calls.append(1)
        return httpx.Response(503) if len(calls) < 3 else httpx.Response(200, json={"ok": True})
    c = client(handler)
    r = await c.get_json("x", "https://p.test/a", ttl_s=60)
    assert r.data == {"ok": True} and r.attempts == 3 and not r.from_cache
    again = await c.get_json("x", "https://p.test/a", ttl_s=60)
    assert again.from_cache and len(calls) == 3


async def test_rate_limited_then_gives_up():
    c = client(lambda req: httpx.Response(429, headers={"Retry-After": "0"}))
    with pytest.raises(ProviderError, match="429"):
        await c.get_json("x", "https://p.test/b")


async def test_client_errors_not_retried_and_timeouts_reported():
    calls = []
    c = client(lambda req: (calls.append(1), httpx.Response(404))[1])
    with pytest.raises(ProviderError, match="404"):
        await c.get_json("x", "https://p.test/c")
    assert len(calls) == 1
    def boom(req):
        raise httpx.ReadTimeout("slow", request=req)
    with pytest.raises(ProviderError, match="network error"):
        await client(boom).get_json("x", "https://p.test/d")


# ------------------------------------------------------------------ data quality
def test_duplicate_quake_merged_with_magnitude_agreement_and_precautionary_class():
    g = hazard(id="EQ-9", hazard_type="earthquake", severity_class="minor", severity_value=6.1, alert_level="green")
    u = hazard(id="us123", source_id="usgs-earthquakes", hazard_type="earthquake", severity_class="severe", severity_value=6.2)
    events, checks = merge_duplicate_hazards([g, u, g])
    assert len(events) == 1 and events[0].severity_class == "severe"
    assert checks[0]["agree"] is True


def test_magnitude_disagreement_flagged():
    g = hazard(id="EQ-9", hazard_type="earthquake", severity_value=5.0)
    u = hazard(id="us1", source_id="usgs-earthquakes", hazard_type="earthquake", severity_value=5.6)
    assert merge_duplicate_hazards([g, u])[1][0]["agree"] is False


def test_freshness_and_weather_agreement():
    assert freshness_score("usgs-earthquakes", NOW - timedelta(minutes=30), NOW) == (1.0, False)
    score, stale = freshness_score("usgs-earthquakes", NOW - timedelta(minutes=90), NOW)
    assert stale and score == pytest.approx(0.5)
    assert weather_internal_agreement(1, 12.0) is False and weather_internal_agreement(63, 3.0) is True


async def test_http_cache_expires_by_wall_clock_not_monotonic(monkeypatch):
    """time.monotonic() stops while a Mac sleeps; cached weather must still expire after its TTL in real time."""
    import httpx, respx, time as _time
    from app.ingestion.http import HttpClient
    calls = {"n": 0}
    def handler(_req):
        calls["n"] += 1
        return httpx.Response(200, json={"n": calls["n"]})
    client = HttpClient()
    with respx.mock(assert_all_called=False) as r:
        r.get("https://example.test/w").mock(side_effect=handler)
        t0 = _time.time()
        monkeypatch.setattr(_time, "time", lambda: t0)
        first = await client.get_json("open-meteo-forecast", "https://example.test/w", ttl_s=600)
        monkeypatch.setattr(_time, "time", lambda: t0 + 6 * 3600)      # 6 h later on the wall clock
        monkeypatch.setattr(_time, "monotonic", lambda: 0.0)            # …but the monotonic clock did not move
        second = await client.get_json("open-meteo-forecast", "https://example.test/w", ttl_s=600)
    await client.close()
    assert first.data == {"n": 1} and second.data == {"n": 2} and not second.from_cache
