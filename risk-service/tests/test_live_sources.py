"""Official warnings (MeteoAlarm, NWS) and official travel advice (US State Dept, UK FCDO)."""
from datetime import datetime, timedelta, timezone

import httpx
import pytest
import respx

from app.ingestion import advisories, warnings
from app.ingestion.http import set_http
from app.risk_engine.aggregation import destination_score
from app.schemas.domain import Destination
from app.services.destination_service import compute_factors
from tests.conftest import ctx

from tests.conftest import NOW  # the shared test clock
PARIS = Destination(id="paris", name="Paris, France", latitude=48.8584, longitude=2.2945, country_code="FR")
NYC = Destination(id="new-york", name="New York City", latitude=40.758, longitude=-73.9855, country_code="US")


def ma_warning(severity="Moderate", colour="yellow", code="FR101", area="Paris", msg="Alert", hours=6, typ="1; Wind"):
    return {"alert": {"identifier": f"id-{code}-{severity}", "msgType": msg, "status": "Actual", "sent": NOW.isoformat(),
                      "info": [{"language": "en-GB", "event": f"{colour} wind warning", "severity": severity,
                                "headline": f"{colour.title()} wind warning for {area}",
                                "onset": NOW.isoformat(), "expires": (NOW + timedelta(hours=hours)).isoformat(),
                                "senderName": "Météo-France",
                                "parameter": [{"valueName": "awareness_level", "value": f"2; {colour}; {severity}"},
                                              {"valueName": "awareness_type", "value": typ}],
                                "area": [{"areaDesc": area, "geocode": [{"valueName": "NUTS3", "value": code}]}]}]}}


def test_meteoalarm_matches_the_destination_region_only():
    body = {"warnings": [ma_warning(), ma_warning(code="FR831", area="Corse-du-Sud", severity="Severe", colour="orange")]}
    ws = warnings.parse_meteoalarm(body, PARIS, NOW)
    assert len(ws) == 1
    w = ws[0]
    assert (w.source_id, w.severity_class, w.alert_level, w.hazard_type) == ("meteoalarm", "moderate", "yellow", "wind")
    assert w.verified and not w.has_footprint and "Météo-France" in w.severity_text


def test_meteoalarm_ignores_cancelled_expired_and_green():
    body = {"warnings": [ma_warning(msg="Cancel"), ma_warning(hours=-1),
                         ma_warning(severity="Minor", colour="green")]}
    assert warnings.parse_meteoalarm(body, PARIS, NOW) == []


def test_meteoalarm_orange_is_severe_and_raises_the_risk_level():
    from app.risk_engine.aggregation.config import load_scoring
    from app.risk_engine.aggregation.destination import aggregate
    w = warnings.parse_meteoalarm({"warnings": [ma_warning(severity="Severe", colour="orange")]}, PARIS, NOW)
    from shapely.geometry import Point
    c = ctx(destination=PARIS, location=Point(PARIS.longitude, PARIS.latitude), hazards=w,
            hazard_sources_ok=["gdacs", "usgs-earthquakes", "meteoalarm"])
    fs = compute_factors(c)
    hz = {f.key: f for f in fs}["hazard_severity"]
    assert hz.severity_class == "severe"
    assert aggregate(c, fs, load_scoring("scoring-v2")).category == "HIGH"


def test_nws_point_alerts():
    body = {"features": [{"properties": {"id": "urn:1", "status": "Actual", "messageType": "Alert",
                                          "severity": "Severe", "event": "Winter Storm Warning",
                                          "headline": "Winter Storm Warning until 6 PM", "sent": NOW.isoformat(),
                                          "onset": NOW.isoformat(), "ends": (NOW + timedelta(hours=8)).isoformat(),
                                          "areaDesc": "New York (Manhattan)"}},
                         {"properties": {"id": "urn:2", "status": "Test", "severity": "Extreme", "event": "Test"}}]}
    ws = warnings.parse_nws(body, NYC, NOW)
    assert [(w.severity_class, w.hazard_type, w.alert_level) for w in ws] == [("severe", "cold", "orange")]


def test_destinations_without_a_feed_say_why():
    assert warnings.source_for(Destination(id="tokyo", name="Tokyo", latitude=35.6, longitude=139.7)) is None
    assert "28 May 2026" in warnings.NOT_COVERED["tokyo"]


@pytest.fixture
def http():
    set_http(None)
    yield
    set_http(None)


async def test_advisories_use_fips_codes_and_the_more_cautious_source(http):
    with respx.mock(assert_all_called=False) as r:
        r.get(advisories.STATE_URL).mock(return_value=httpx.Response(200, json=[
            {"Title": "Iceland - Level 1: Exercise Normal Precautions", "Category": "['IC']", "Link": "x"},
            {"Title": "India - Level 2: Exercise Increased Caution", "Category": "['IN']", "Link": "y"}]))
        r.get("https://www.gov.uk/api/content/foreign-travel-advice/india").mock(return_value=httpx.Response(200, json={
            "public_updated_at": "2026-09-01T00:00:00Z", "details": {"alert_status": ["avoid_all_travel_to_parts"]}}))
        r.get("https://www.gov.uk/api/content/foreign-travel-advice/iceland").mock(return_value=httpx.Response(200, json={
            "details": {"alert_status": []}}))
        iceland = advisories.combine([p for p in (await advisories.state_dept("IS"), await advisories.fcdo("IS")) if p])
        india = advisories.combine([p for p in (await advisories.state_dept("IN"), await advisories.fcdo("IN")) if p])
        uk_fcdo = await advisories.fcdo("GB")
    assert iceland["value"] == 0.0
    assert india["value"] == 0.5 and "more cautious" in india["explanation"]   # FCDO parts (0.5) > State L2 (0.33)
    assert uk_fcdo is None                                                      # FCDO has no page for the UK


def test_destination_score_uses_the_advisory_as_safety_index():
    fs = compute_factors(ctx())
    with_adv = destination_score.compute(fs, {"available": True, "value": 1 / 3, "explanation": "US State Department Level 2"})
    without = destination_score.compute(fs, None)
    s = next(c for c in with_adv["components"] if c["key"] == "safety_index")
    assert s["score"] == pytest.approx(66.7, abs=0.1) and not with_adv["provisional"]
    assert without["provisional"] and next(c for c in without["components"] if c["key"] == "safety_index")["score"] is None
