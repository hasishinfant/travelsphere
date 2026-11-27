"""Each of the eight factors, including threshold boundaries, missing and stale data."""
from datetime import timedelta

import pytest

from app.risk_engine import confidence, population
from app.risk_engine.factors import (activity_timing as time_factor, emergency_access, hazard_exposure, hazard_severity,
                                     historical_incident_risk, remoteness, terrain, weather_severity as ws)
from app.services.destination_service import compute_factors
from tests.conftest import NOW, access, ctx, hazard, history, place, remote, route, weather
from tests.conftest import terrain as dem

KYOTO_LAT_ = 34.9986


# ------------------------------------------------------------------ 1 weather severity
@pytest.mark.parametrize("mm,cls", [(2.4, "none"), (2.5, "minor"), (7.6, "minor"), (7.7, "moderate"), (16, "severe"), (50, "extreme")])
def test_rain_thresholds(mm, cls):
    assert ws.rain_class(mm) == cls


@pytest.mark.parametrize("ms,cls", [(10.7, "none"), (10.8, "minor"), (17.2, "moderate"), (24.5, "severe"), (32.7, "extreme")])
def test_gust_thresholds_beaufort(ms, cls):
    assert ws.gust_class(ms) == cls


@pytest.mark.parametrize("c,heat,cold", [(26.9, "none", "none"), (27, "minor", "none"), (32, "moderate", "none"),
                                         (39, "severe", "none"), (51, "extreme", "none"), (-10, "none", "minor"),
                                         (-28, "none", "moderate"), (-40, "none", "severe"), (-48, "none", "extreme")])
def test_heat_and_cold_thresholds(c, heat, cold):
    assert ws.heat_class(c) == heat and ws.cold_class(c) == cold


def test_wmo_codes_and_fog():
    assert ws.code_class(95) == "moderate" and ws.code_class(99) == "severe" and ws.code_class(2) == "none"
    assert ws.visibility_class(400) == "moderate" and ws.visibility_class(999) == "minor" and ws.visibility_class(5000) == "none"


def test_weather_calm_is_measured_none():
    f = ws.compute(ctx())
    assert f.status == "measured" and f.severity_class == "none" and f.value == 0


def test_weather_worst_driver_in_window_wins():
    f = ws.compute(ctx(weather=weather(hourly={5: {"precipitation_mm": 20.0, "weather_code": 65}, 8: {"wind_gust_ms": 18.0}})))
    assert f.severity_class == "severe"
    assert "Very heavy rain 20 mm/h" in f.explanation
    assert [d["class"] for d in f.inputs["drivers"]][:2] == ["severe", "moderate"]


def test_weather_outside_window_ignored():
    f = ws.compute(ctx(weather=weather(hourly={30: {"precipitation_mm": 60.0}})))  # 30 h ahead, window is 24 h
    assert f.severity_class == "none"


def test_weather_missing_is_unavailable_not_zero():
    f = ws.compute(ctx(weather=None, weather_error="open-meteo: HTTP 503"))
    assert f.status == "unavailable" and f.value is None and "503" in f.explanation


def test_weather_stale_flagged():
    f = ws.compute(ctx(weather=weather(observed_age_min=200)))
    assert f.data_quality.is_stale


def test_weather_beyond_forecast_horizon():
    c = ctx(mode="journey", window_start=NOW + timedelta(days=30), window_end=NOW + timedelta(days=30, hours=3))
    f = ws.compute(c)
    assert f.status == "unavailable" and "forecast horizon" in f.explanation


def test_weather_out_of_range_values_reported_missing():
    f = ws.compute(ctx(weather=weather(current={"wind_gust_ms": None}, hourly={i: {"wind_gust_ms": None} for i in range(72)})))
    assert "wind_gust_ms" in f.data_quality.missing_fields


# ------------------------------------------------------------------ 2 hazard severity
def test_hazard_inside_footprint_uses_alert_class():
    f = hazard_severity.compute(ctx(hazards=[hazard(footprint_m=20_000)]))
    assert f.severity_class == "severe" and f.inputs["affecting"][0]["distance_m"] == 0


def test_hazard_footprint_elsewhere_does_not_affect():
    f = hazard_severity.compute(ctx(hazards=[hazard(lat=36.0, footprint_m=20_000)]))  # ~110 km north
    assert f.severity_class == "none"


def test_point_hazard_within_radius_counts_beyond_does_not():
    near = hazard(id="EQ-1", hazard_type="earthquake", lat=KYOTO_LAT + 0.3, severity_class="moderate", source_id="usgs-earthquakes")
    far = hazard(id="EQ-2", hazard_type="earthquake", lat=KYOTO_LAT + 1.0, severity_class="extreme", source_id="usgs-earthquakes")
    f = hazard_severity.compute(ctx(hazards=[near, far]))
    assert f.severity_class == "moderate"


def test_cyclone_local_wind_zone_class():
    from app.geospatial.geometry import geodesic_circle
    h = hazard(id="TC-1", hazard_type="cyclone", footprint_m=200_000, severity_class="extreme", alert_level="red")
    h.zones = [("moderate", geodesic_circle(KYOTO_LAT, KYOTO_LON, 200_000), "≥60 km/h"),
               ("extreme", geodesic_circle(KYOTO_LAT - 1.5, KYOTO_LON, 30_000), "≥120 km/h")]
    f = hazard_severity.compute(ctx(hazards=[h]))
    assert f.severity_class == "moderate"  # inside the gale buffer, not the hurricane-force core


def test_expired_hazard_ignored():
    h = hazard(footprint_m=20_000, valid_from=NOW - timedelta(days=5), valid_to=NOW - timedelta(days=2), is_current=False)
    assert hazard_severity.compute(ctx(hazards=[h])).severity_class == "none"


def test_hazard_feeds_down_is_unavailable():
    f = hazard_severity.compute(ctx(hazards=None, hazard_sources_ok=[], hazard_sources_failed=["gdacs", "usgs-earthquakes"]))
    assert f.status == "unavailable" and "cannot be ruled out" in f.explanation


def test_one_feed_down_is_reported():
    f = hazard_severity.compute(ctx(hazard_sources_ok=["gdacs"], hazard_sources_failed=["usgs-earthquakes"]))
    assert f.status == "measured" and "source:usgs-earthquakes" in f.data_quality.missing_fields


# ------------------------------------------------------------------ 3 hazard exposure (proximity + route share)
def test_distance_inside_is_zero_and_proximity_one():
    f = hazard_exposure.compute(ctx(hazards=[hazard(footprint_m=10_000)]))
    assert f.raw_value == 0 and f.value == 1


def test_distance_linear_proximity():
    f = hazard_exposure.compute(ctx(hazards=[hazard(lat=KYOTO_LAT + 25_000 / 111_000)]))  # ~25 km, R = 50 km
    assert 24_000 < f.raw_value < 26_000 and f.value == pytest.approx(0.5, abs=0.03)


def test_distance_no_hazards():
    f = hazard_exposure.compute(ctx())
    assert f.value == 0 and f.raw_value is None


def test_exposure_for_destination_has_no_route_part():
    f = hazard_exposure.compute(ctx())
    assert f.status == "measured" and "exposed_fraction" not in f.inputs


# The test route runs along lat 34.99, ~955 m south of the circle centre (34.9986): chord = 2·sqrt(R² − d²)
OFFSET_M = (KYOTO_LAT_ - 34.99) * 111_000
CHORD_M = 2 * (3_000 ** 2 - OFFSET_M ** 2) ** 0.5


def test_route_exposure_fraction_through_circle():
    r = route()  # ~14.6 km east-west line through Kyoto
    f = hazard_exposure.compute(ctx(mode="journey", route=r, hazards=[hazard(footprint_m=3_000)]))
    assert f.inputs["exposed_m"] == pytest.approx(CHORD_M, rel=0.01)
    assert f.inputs["exposed_fraction"] == pytest.approx(CHORD_M / r.distance_m, rel=0.01)
    assert f.inputs["exposed_minutes"] == pytest.approx(30 * f.inputs["exposed_fraction"], rel=0.01)
    assert f.value == 1.0 and f.raw_value == 0          # the route crosses the footprint: proximity 1


def test_overlapping_footprints_counted_once():
    a, b = hazard(id="A", footprint_m=3_000), hazard(id="B", footprint_m=3_000)
    f = hazard_exposure.compute(ctx(mode="journey", route=route(), hazards=[a, b]))
    assert f.inputs["exposed_m"] == pytest.approx(CHORD_M, rel=0.01)


def test_route_clear():
    f = hazard_exposure.compute(ctx(mode="journey", route=route(), hazards=[hazard(lat=36, footprint_m=3_000)]))
    assert f.inputs["exposed_fraction"] == 0 and "does not cross" in f.explanation and f.value < 0.1


# ------------------------------------------------------------------ 5 activity and timing
def test_night_trek_is_moderate():
    start = NOW + timedelta(hours=9)  # 21:00 Kyoto
    f = time_factor.compute(ctx(mode="journey", window_start=start, window_end=start + timedelta(hours=3), activity="trekking"))
    assert f.severity_class == "moderate" and f.raw_value == 1.0


def test_night_indoor_is_minor_daylight_none_outside_season():
    from app.schemas.domain import Destination
    paris = Destination(id="paris", name="Paris", latitude=48.8584, longitude=2.2945, timezone="Europe/Paris")
    from shapely.geometry import Point
    noon = NOW.replace(hour=11)  # 12:00 Paris
    day = time_factor.compute(ctx(mode="journey", destination=paris, location=Point(2.2945, 48.8584),
                                  window_start=noon, window_end=noon + timedelta(hours=2), activity="indoor"))
    night = time_factor.compute(ctx(mode="journey", destination=paris, location=Point(2.2945, 48.8584),
                                    window_start=noon + timedelta(hours=11), window_end=noon + timedelta(hours=13), activity="indoor"))
    assert day.severity_class == "none" and night.severity_class == "minor"


def test_cyclone_season_basins():
    from datetime import datetime, timezone
    assert time_factor.cyclone_season(25.8, -80.2, datetime(2026, 9, 1, tzinfo=timezone.utc))[0] == "North Atlantic"
    assert time_factor.cyclone_season(25.8, -80.2, datetime(2026, 1, 15, tzinfo=timezone.utc)) is None
    assert time_factor.cyclone_season(-8.3, 115.2, datetime(2026, 1, 15, tzinfo=timezone.utc))[0] == "Australian region"
    assert time_factor.cyclone_season(48.9, 2.3, datetime(2026, 9, 1, tzinfo=timezone.utc)) is None


def test_lead_time_beyond_horizon_noted():
    start = NOW + timedelta(days=40)
    f = time_factor.compute(ctx(mode="journey", window_start=start, window_end=start + timedelta(hours=2)))
    assert f.inputs["beyond_forecast_horizon"] is True


# ------------------------------------------------------------------ 6 historical incident risk
def _hist_event(i, t="flood", src="gdacs", alert="orange", years_ago=1.0):
    return hazard(id=f"H{i}", hazard_type=t, source_id=src, alert_level=alert, valid_from=NOW - timedelta(days=365 * years_ago),
                  valid_to=NOW - timedelta(days=365 * years_ago - 3), is_current=False)


def test_historical_rate_and_return_period():
    events = [_hist_event(i) for i in range(5)]  # 5 in 10 years → 0.5/yr → return period 2 yr → severe
    f = historical_incident_risk.compute(ctx(history=history(events)))
    assert f.raw_value == pytest.approx(0.5, rel=0.01) and f.severity_class == "severe"
    assert f.inputs["p_at_least_one_per_year"] == pytest.approx(1 - 2.718281828 ** -0.5, abs=0.002)


def test_historical_excludes_gdacs_quakes_and_green_and_duplicates():
    events = [_hist_event(1, t="earthquake"), _hist_event(2, alert="green"), _hist_event(3), _hist_event(3)]
    f = historical_incident_risk.compute(ctx(history=history(events)))
    assert f.inputs["events_total"] == 1


def test_historical_trip_window_probability_smaller():
    events = [_hist_event(i) for i in range(10)]
    c = ctx(mode="journey", window_start=NOW + timedelta(days=1), window_end=NOW + timedelta(days=6), history=history(events))
    f = historical_incident_risk.compute(c)
    assert f.inputs["p_at_least_one_during_trip"] < f.inputs["p_at_least_one_per_year"]


def test_historical_unavailable():
    f = historical_incident_risk.compute(ctx(history=history(events=None)))
    assert f.status == "unavailable"


@pytest.mark.parametrize("rate,cls", [(0, "none"), (0.009, "none"), (0.01, "minor"), (0.05, "moderate"), (0.2, "severe"), (1, "extreme")])
def test_return_period_classes(rate, cls):
    assert historical_incident_risk.return_period_class(rate) == cls


# ------------------------------------------------------------------ 4 terrain
@pytest.mark.parametrize("pct,cls", [(9.9, "none"), (10, "minor"), (15, "moderate"), (30, "severe"), (60, "extreme")])
def test_fao_slope_classes(pct, cls):
    assert terrain.slope_class(pct) == cls


def test_terrain_slope_from_dem_rings():
    f = terrain.compute(ctx(terrain=dem(rise_m=60)))          # 60 m over 300 m = 20 %
    assert f.status == "measured" and f.raw_value == 20.0 and f.severity_class == "moderate"
    assert f.inputs["max_relief_m"] == 60


def test_configured_cliffs_raise_flat_ground_to_minor():
    from app.schemas.domain import Destination
    santorini = Destination(id="s", name="Santorini", latitude=36.46, longitude=25.38, terrain=["cliffs", "coastal"])
    f = terrain.compute(ctx(destination=santorini, terrain=dem(rise_m=3)))
    assert f.severity_class == "minor" and "cliffs" in f.explanation


def test_terrain_unavailable_without_dem_or_configuration():
    f = terrain.compute(ctx(terrain=None, terrain_error="copernicus-dem: HTTP 503"))
    assert f.status == "unavailable" and "HTTP 503" in f.explanation


# ------------------------------------------------------------------ 7 access to emergency care
@pytest.mark.parametrize("minutes,cls", [(12, "none"), (60, "none"), (61, "minor"), (120, "minor"), (121, "moderate")])
def test_access_classes(minutes, cls):
    f = emergency_access.compute(ctx(access=access(minutes)))
    assert f.severity_class == cls and f.raw_value == minutes


def test_no_hospital_mapped_is_moderate_and_unknown_is_unavailable():
    assert emergency_access.compute(ctx(access=access(fac=[]))).severity_class == "moderate"
    assert emergency_access.compute(ctx(access=None)).status == "unavailable"


# ------------------------------------------------------------------ 8 remoteness
@pytest.mark.parametrize("km,cls", [(10, "none"), (10.1, "minor"), (25, "minor"), (50, "moderate"), (50.1, "severe")])
def test_remoteness_bands(km, cls):
    f = remoteness.compute(ctx(remoteness=remote(km)))
    assert f.severity_class == cls and f.value == pytest.approx(min(km, 100) / 100, abs=1e-3)


def test_remoteness_unavailable_without_geonames():
    f = remoteness.compute(ctx(remoteness={"error": "GeoNames settlement file not installed"}))
    assert f.status == "unavailable" and "GeoNames" in f.explanation


def test_nearest_settlement_real_geonames_file():
    from app.geospatial import settlements
    if not settlements.available():
        pytest.skip("GeoNames cities1000.zip not installed")
    t = settlements.nearest(48.8584, 2.2945, 5_000)              # Eiffel Tower
    assert t["country"] == "FR" and t["distance_m"] < 6_000
    far = settlements.nearest(64.0, -18.0, 5_000)                 # Icelandic highlands
    assert far["distance_m"] > 50_000


# ------------------------------------------------------------------ population context (not a factor)
def test_population_not_exposed_without_hazard():
    p = population.context(ctx())
    assert p["exposed_residents"] == 0 and p["locality_population"] == 1_463_723 and p["population_density_per_km2"] is None


def test_population_exposed_inside_hazard():
    p = population.context(ctx(hazards=[hazard(footprint_m=20_000)]))
    assert p["class"] == "extreme" and p["exposed_residents"] == 1_463_723


def test_population_unknown_while_exposed_is_unavailable():
    assert population.context(ctx(hazards=[hazard(footprint_m=20_000)], place_info=None))["available"] is False


def test_travellers_and_traveller_hours_separate_from_residents():
    c = ctx(mode="journey", route=route(), travellers=3, hazards=[hazard(lat=36, footprint_m=3_000)])
    p = population.context(c, route_exposed_minutes=20)
    assert p["travellers_exposed"] == 3 and p["traveller_hours_exposed"] == 1.0 and p["exposed_residents"] == 0


@pytest.mark.parametrize("n,cls", [(0, "none"), (999, "minor"), (99_999, "moderate"), (999_999, "severe"), (1_000_000, "extreme")])
def test_population_bands(n, cls):
    assert population.population_class(n) == cls


# ------------------------------------------------------------------ confidence (not a factor)
def _conf(c):
    return confidence.compute(c, compute_factors(c))


def test_confidence_is_evidence_quality_not_hazard():
    good = _conf(ctx())
    assert good["value"] > 0.8
    # A severe hazard with excellent data must not lower confidence
    assert _conf(ctx(hazards=[hazard(footprint_m=20_000)]))["value"] >= good["value"] - 0.05


def test_confidence_drops_with_missing_and_stale_data():
    good = _conf(ctx())["value"]
    missing = _conf(ctx(weather=None, history=history(events=None)))
    stale = _conf(ctx(weather=weather(observed_age_min=170)))
    assert missing["value"] < good and "Weather severity" in missing["explanation"]
    assert stale["value"] < good and stale["components"]["freshness"] < 0.2


KYOTO_LAT, KYOTO_LON = 34.9986, 135.785


def test_terrain_ignores_the_surface_model_in_built_up_areas():
    from app.schemas.domain import Destination
    nyc = Destination(id="new-york", name="New York", latitude=40.758, longitude=-73.9855, setting="urban")
    f = terrain.compute(ctx(destination=nyc, terrain=dem(rise_m=115)))         # skyscrapers read as a 38 % slope
    assert f.severity_class == "none" and f.status == "configured" and "buildings" in f.explanation
    big_town = remote(town_km=1.0, population=1_463_723)                      # a city of 1.46 M, 1 km away
    assert terrain.compute(ctx(terrain=dem(rise_m=115), remoteness=big_town)).severity_class == "none"
    village = remote(town_km=40)
    assert terrain.compute(ctx(terrain=dem(rise_m=115), remoteness=village)).severity_class == "severe"
