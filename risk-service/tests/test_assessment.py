"""Category rules (scoring-v2), critical override, missing data, journey dimensions, confidence, destination score,
explanations."""
from datetime import timedelta

from shapely.geometry import Point

from app.risk_engine.aggregation.config import load_scoring
from app.risk_engine import confidence
from app.risk_engine.aggregation import destination_score
from app.risk_engine.aggregation.destination import aggregate, composite
from app.risk_engine.explanations.builder import build
from app.risk_engine.journey_context.accessibility import assess_access
from app.risk_engine.journey_context.assessor import assess_journey
from app.services.destination_service import compute_factors
from app.services.journey_service import safer_route
from tests.conftest import NOW, TimedWeather, access, ctx, facilities, hazard, remote, route, terrain, weather

CFG = load_scoring("scoring-v2")
BANDS = CFG["journey"]["access_bands_minutes"]


def destination(c):
    fs = compute_factors(c)
    return aggregate(c, fs, CFG), fs


# ------------------------------------------------------------------ destination
def test_calm_destination_low_complete():
    agg, fs = destination(ctx())
    assert agg.category == "LOW" and agg.status == "COMPLETE" and len(fs) == 8


def test_severe_storm_not_diluted_by_calm_factors():
    agg, fs = destination(ctx(weather=weather(hourly={3: {"wind_gust_ms": 26.0}})))
    assert agg.category == "HIGH"
    assert agg.composite_index < 0.5  # the averaged index is low — which is why it does not set the category


def test_active_flood_inside_footprint_high():
    agg, _ = destination(ctx(hazards=[hazard(footprint_m=20_000)]))
    assert agg.category == "HIGH"


def test_critical_override_verified_red_alert():
    agg, _ = destination(ctx(hazards=[hazard(footprint_m=20_000, alert_level="red", severity_class="extreme")]))
    assert agg.category == "CRITICAL" and agg.critical_override
    assert agg.rationale[0].startswith("Critical override")


def test_unverified_red_does_not_override():
    agg, _ = destination(ctx(hazards=[hazard(footprint_m=20_000, alert_level="red", severity_class="extreme", verified=False)]))
    assert agg.category == "HIGH" and not agg.critical_override


def test_red_alert_far_away_does_not_override():
    agg, _ = destination(ctx(hazards=[hazard(lat=37.0, footprint_m=20_000, alert_level="red", severity_class="extreme")]))
    assert agg.category == "LOW" and not agg.critical_override


def test_all_primary_data_missing_gives_no_category_never_low():
    c = ctx(weather=None, hazards=None, hazard_sources_ok=[], hazard_sources_failed=["gdacs", "usgs-earthquakes"])
    agg, fs = destination(c)
    assert agg.category is None and agg.status == "INCOMPLETE"
    e = build(c, fs, agg.category, agg.status, agg.rationale)
    assert "could not be assessed" in e["recommended_action"]


def test_one_primary_missing_is_partial():
    agg, _ = destination(ctx(weather=None))
    assert agg.category == "LOW" and agg.status == "PARTIAL" and "weather_severity" in agg.missing


def test_stale_weather_is_partial():
    agg, _ = destination(ctx(weather=weather(observed_age_min=300)))
    assert agg.status == "PARTIAL"


def test_composite_excludes_unavailable():
    _, fs = destination(ctx(weather=None))
    idx, coverage = composite(fs, CFG)
    assert coverage < 1 and idx is not None


def test_explanation_built_from_inputs():
    c = ctx(hazards=[hazard(footprint_m=20_000)])
    agg, fs = destination(c)
    e = build(c, fs, agg.category, agg.status, agg.rationale)
    assert e["hazard_detected"].startswith("Flood in Japan")
    assert "inside the affected area" in e["location"]
    assert "flooded roads" in e["recommended_action"]
    assert "not the probability" in e["disclaimer"]
    assert {x["factor"] for x in e["contributing_inputs"]} >= {"hazard_severity", "hazard_exposure"}


# ------------------------------------------------------------------ journey
def journey_ctx(start_offset_h, activity, travellers=1, w=None, hazards=None, r=None, fac=None):
    start = NOW + timedelta(hours=start_offset_h)
    r = r or route()
    w = w or weather()
    tw = [TimedWeather(Point(r.geometry.coords[0]), start, w), TimedWeather(Point(r.geometry.coords[-1]), start + timedelta(minutes=30), w)]
    return ctx(mode="journey", window_start=start, window_end=start + timedelta(hours=3), route=r, route_weather=tw,
               weather=w, activity=activity, travellers=travellers, hazards=hazards or [],
               facilities=fac if fac is not None else facilities())


def run_journey(c, fac=None):
    c.access = assess_access(c.subject, c.facilities, None, BANDS, 25_000)
    fs = compute_factors(c)
    return assess_journey(c, fs, c.access, CFG), fs


def test_same_destination_different_travellers_different_results():
    stormy_evening = weather(hourly={i: {"weather_code": 95, "precipitation_mm": 9.0} for i in range(8, 14)})
    day_museum, _ = run_journey(journey_ctx(1, "indoor", w=stormy_evening))     # 13:00, clear at that hour
    night_trek, _ = run_journey(journey_ctx(9, "trekking", w=stormy_evening))   # 21:00, thunderstorm, after dark
    assert day_museum["category"] == "LOW"
    assert night_trek["category"] == "HIGH"
    assert any("exposed outdoor activity" in r for r in night_trek["rationale"])


def test_route_through_active_flood_high_and_dimensions_filled():
    res, fs = run_journey(journey_ctx(1, "sightseeing", hazards=[hazard(footprint_m=3_000)]))
    assert res["category"] == "HIGH"
    d = res["dimensions"]
    assert set(d) == {"hazard", "exposure", "journey_context", "response_capacity"}
    assert d["exposure"]["hazard_exposure"]["value"] > 0.3 and d["response_capacity"]["access"]["class"] == "adequate"


def test_poor_access_raises_category():
    w = weather(hourly={i: {"precipitation_mm": 9.0} for i in range(0, 6)})  # heavy rain → moderate
    with_care, _ = run_journey(journey_ctx(1, "sightseeing", w=w))
    no_care, _ = run_journey(journey_ctx(1, "sightseeing", w=w, fac=[]))
    assert with_care["category"] == "MODERATE"
    assert no_care["category"] == "HIGH" and any("emergency care" in r for r in no_care["rationale"])


def test_darkness_on_remote_ground_is_moderate_but_not_in_a_city():
    remote_trek = journey_ctx(9, "trekking")
    remote_trek.remoteness = remote(town_km=18)
    res, _ = run_journey(remote_trek)
    assert res["category"] == "MODERATE" and any("remote or steep ground" in r for r in res["rationale"])
    city, _ = run_journey(journey_ctx(9, "trekking"))   # 1.5 km from Kyoto, flat
    assert city["category"] == "LOW"


def test_journey_critical_override_on_route():
    res, _ = run_journey(journey_ctx(1, "indoor", hazards=[hazard(footprint_m=3_000, alert_level="red", severity_class="extreme")]))
    assert res["category"] == "CRITICAL" and res["critical_override"]


def test_journey_without_weather_or_hazards_incomplete():
    c = journey_ctx(1, "sightseeing")
    c.weather, c.route_weather, c.hazards = None, [], None
    res, _ = run_journey(c)
    assert res["category"] is None and res["status"] == "INCOMPLETE"


def test_safer_route_recommended_when_alternative_avoids_hazard():
    flood = hazard(footprint_m=3_000)
    primary = route()
    detour = route(coords=((135.70, 34.99), (135.78, 35.06), (135.86, 34.99)), duration_s=2400)
    s = safer_route(primary, [detour], [flood], NOW, NOW + timedelta(hours=2), 0.25)
    assert s["available"] and s["exposure_reduction"] == 1.0 and s["extra_minutes"] == 10.0
    none = safer_route(primary, [], [flood], NOW, NOW + timedelta(hours=2), 0.25)
    assert not none["available"]


def test_access_bands():
    a = assess_access(Point(135.785, 34.9986), facilities(2), [12.0], BANDS, 25_000)
    assert a["class"] == "adequate" and a["precision"] == "osrm-routed"
    b = assess_access(Point(135.785, 34.9986), facilities(2), [95.0], BANDS, 25_000)
    assert b["class"] == "limited"
    c = assess_access(Point(135.785, 34.9986), None, None, BANDS, 25_000, "overpass: HTTP 504")
    assert c["class"] == "unknown"


# ------------------------------------------------------------------ scoring-v2 amplifiers
def test_steep_terrain_raises_minor_wind_for_open_air_activity():
    breezy = weather(hourly={i: {"wind_gust_ms": 12.0} for i in range(0, 30)})   # Beaufort 6 → minor
    flat, _ = destination(ctx(weather=breezy))
    cliff, fs = destination(ctx(weather=breezy, terrain=terrain(rise_m=120)))     # 40 % slope → severe terrain
    assert flat.category == "LOW"
    assert cliff.category == "MODERATE" and any("terrain" in r for r in cliff.rationale)
    indoor, _ = destination(ctx(weather=breezy, terrain=terrain(rise_m=120), activity="indoor"))
    assert indoor.category == "LOW"


def test_amplifiers_raise_one_step_only():
    stormy = weather(hourly={i: {"precipitation_mm": 9.0} for i in range(0, 30)})  # heavy rain → moderate
    c = ctx(weather=stormy, terrain=terrain(rise_m=120), remoteness=remote(town_km=80), access=access(fac=[]),
            activity="trekking")
    agg, _ = destination(c)
    assert len(agg.decision["amplifiers"]) == 3
    assert agg.category == "HIGH"                     # moderate + one step, never CRITICAL from amplifiers


def test_remoteness_alone_never_raises_the_category():
    agg, fs = destination(ctx(remoteness=remote(town_km=80), access=access(fac=[]), activity="trekking"))
    assert agg.category == "LOW"
    by = {f.key: f for f in fs}
    assert by["remoteness"].severity_class == "severe" and by["emergency_access"].severity_class == "moderate"


def test_hazard_history_never_escalates():
    from tests.conftest import history
    floods = [hazard(external_id=str(i), valid_from=NOW - timedelta(days=200 * i), valid_to=NOW - timedelta(days=200 * i - 5),
                     footprint_m=20_000) for i in range(1, 12)]
    agg, fs = destination(ctx(history=history(events=floods)))
    assert {f.key: f for f in fs}["historical_incident_risk"].severity_class in ("severe", "extreme")
    assert agg.category == "LOW"


def test_eight_factors_in_four_dimensions():
    from app.schemas.factors import FACTOR_DIMENSION, FACTOR_ORDER
    _, fs = destination(ctx())
    assert [f.key for f in fs] == FACTOR_ORDER and len(fs) == 8
    assert sorted(set(FACTOR_DIMENSION.values())) == ["exposure", "hazard", "journey_context", "response_capacity"]


# ------------------------------------------------------------------ confidence
def test_confidence_high_with_full_current_data():
    c = ctx()
    conf = confidence.compute(c, compute_factors(c))
    assert conf["level"] == "high" and 80 <= conf["score"] <= 100 and not conf["missing_factors"]


def test_confidence_capped_low_without_a_primary_hazard_factor():
    c = ctx(weather=None)
    conf = confidence.compute(c, compute_factors(c))
    assert conf["level"] == "low" and any("capped at low" in x for x in conf["caps"])


def test_confidence_capped_medium_when_stale():
    c = ctx(weather=weather(observed_age_min=300))
    conf = confidence.compute(c, compute_factors(c))
    assert conf["level"] in ("medium", "low")


def test_confidence_does_not_change_the_category():
    good, poor = ctx(), ctx(terrain=None, remoteness=None, access=None)
    a1, f1 = destination(good)
    a2, f2 = destination(poor)
    assert a1.category == a2.category == "LOW"
    assert confidence.compute(poor, f2)["score"] < confidence.compute(good, f1)["score"]


# ------------------------------------------------------------------ destination score
def test_destination_score_is_provisional_without_advisories():
    _, fs = destination(ctx())
    s = destination_score.compute(fs)
    assert s["provisional"] and s["components"][0]["score"] is None
    assert 0 <= s["score"] <= 100 and s["band"] in ("Low", "Moderate", "High", "Excellent")
    assert abs(s["weight_available"] - 0.4 / 0.6) < 1e-3


def test_destination_score_refuses_with_too_little_data():
    _, fs = destination(ctx(remoteness=None, access=None))
    s = destination_score.compute(fs)
    assert s["score"] is None


def test_destination_score_lower_for_remote_place_far_from_care():
    _, near = destination(ctx())
    _, far = destination(ctx(remoteness=remote(town_km=90), access=access(fac=[])))
    assert destination_score.compute(far)["score"] < destination_score.compute(near)["score"]
