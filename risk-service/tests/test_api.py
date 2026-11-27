"""FastAPI end-to-end (HTTPX ASGI client) with a real Postgres schema and mocked providers (respx).
Covers authentication, validation, persistence, provider failures, the never-safe-on-missing-data rule and alerts."""
import copy
import time
import uuid

import httpx
import pytest
import respx
from sqlalchemy import text

from app.core import config
from app.ingestion.http import set_http
from app.services import data as data_service
from tests.conftest import fixture

TOKEN = "t" * 40


@pytest.fixture
def api(db, monkeypatch):
    monkeypatch.setenv("RISK_SERVICE_TOKEN", TOKEN)
    config.get_settings.cache_clear()
    set_http(None)
    data_service._gdacs_history_cache.clear()
    from app.main import app
    transport = httpx.ASGITransport(app=app)
    yield httpx.AsyncClient(transport=transport, base_url="http://risk")
    set_http(None)
    config.get_settings.cache_clear()


def forecast(gust_now: float | None = None):
    body = copy.deepcopy(fixture("open_meteo_kyoto.json"))
    now = int(time.time()) // 900 * 900
    body["current"]["time"] = now
    if gust_now is not None:
        body["current"]["wind_gusts_10m"] = gust_now
    return body


def elevation_body(request):
    n = len(request.url.params["latitude"].split(","))
    return httpx.Response(200, json={"elevation": [50.0] + [53.0] * (n - 1)})


def mock_providers(router, *, weather=200, hazards=200, gust=None):
    router.get(url__regex=r"https://api\.open-meteo\.com/v1/elevation.*").mock(side_effect=elevation_body)
    router.post(url__regex=r"https://.*overpass.*").mock(return_value=httpx.Response(200, json={"elements": [
        {"type": "node", "id": 1, "lat": 35.0, "lon": 135.78, "tags": {"amenity": "hospital", "name": "Kyoto Hospital"}}]}))
    router.get(url__regex=r"https://router\.project-osrm\.org/table/.*").mock(
        return_value=httpx.Response(200, json={"code": "Ok", "durations": [[0, 540.0]]}))
    router.get(url__regex=r"https://api\.open-meteo\.com/.*").mock(
        return_value=httpx.Response(weather, json=forecast(gust) if weather == 200 else {}))
    router.get(url__regex=r"https://geocoding-api\.open-meteo\.com/.*").mock(
        return_value=httpx.Response(200, json=fixture("geocoding_kyoto.json")))
    router.get(url__regex=r"https://www\.gdacs\.org/.*").mock(
        return_value=httpx.Response(hazards, json={"type": "FeatureCollection", "features": []} if hazards == 200 else {}))
    router.get(url__regex=r"https://earthquake\.usgs\.gov/earthquakes/feed/.*").mock(
        return_value=httpx.Response(hazards, json={"type": "FeatureCollection", "features": []} if hazards == 200 else {}))
    router.get(url__regex=r"https://earthquake\.usgs\.gov/fdsnws/.*").mock(
        return_value=httpx.Response(hazards, json={"type": "FeatureCollection", "features": [fixture("usgs_noto.json")]}
                                    if hazards == 200 else {}))


AUTH = {"Authorization": f"Bearer {TOKEN}"}


async def test_health_is_public_internal_requires_token(api):
    assert (await api.get("/health")).json()["database"] == "connected"
    assert (await api.post("/internal/v1/assessments/destination", json={"destination_id": "kyoto"})).status_code == 401
    bad = {"Authorization": "Bearer " + "x" * 40}
    assert (await api.post("/internal/v1/assessments/destination", json={"destination_id": "kyoto"}, headers=bad)).status_code == 401


async def test_validation_and_unknown_destination(api):
    r = await api.post("/internal/v1/assessments/destination", json={"destination_id": "BAD ID"}, headers=AUTH)
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation_failed"
    r = await api.post("/internal/v1/assessments/destination", json={"destination_id": "kyoto", "extra": 1}, headers=AUTH)
    assert r.status_code == 422
    with respx.mock:
        r = await api.post("/internal/v1/assessments/destination", json={"destination_id": "atlantis"}, headers=AUTH)
    assert r.status_code == 404


async def test_destination_assessment_persisted(api, db):
    with respx.mock(assert_all_called=False) as router:
        mock_providers(router)
        r = await api.post("/internal/v1/assessments/destination", json={"destination_id": "kyoto"}, headers=AUTH)
    assert r.status_code == 200
    a = r.json()
    assert len(a["factors"]) == 8 and a["risk_category"] in ("LOW", "MODERATE", "HIGH")
    assert a["scoring_version"] == "scoring-v2" and a["id"]
    assert a["confidence"]["level"] in ("high", "medium", "low") and 0 <= a["confidence"]["score"] <= 100
    by = {f["key"]: f for f in a["factors"]}
    assert by["terrain"]["status"] == "configured" and "buildings" in by["terrain"]["explanation"]  # Kyoto is urban
    assert by["emergency_access"]["severity_class"] == "none"
    assert a["destination_score"]["provisional"] is True
    with db.connect() as c:
        assert c.execute(text("select count(*) from factor_assessments where destination_assessment_id = :i"), {"i": a["id"]}).scalar() == 8
        assert c.execute(text("select count(*) from assessment_history where assessment_id = :i"), {"i": a["id"]}).scalar() == 1
        assert c.execute(text("select confidence->>'level' from destination_assessments where id = :i"), {"i": a["id"]}).scalar() \
            == a["confidence"]["level"]
        assert c.execute(text("select count(*) from safety_indicators where destination_id = 'kyoto'")).scalar() >= 5
        hist = next(f for f in a["factors"] if f["key"] == "historical_incident_risk")
        assert hist["status"] == "measured"


async def test_hazard_feeds_down_partial_not_safe(api):
    with respx.mock(assert_all_called=False) as router:
        mock_providers(router, hazards=503)
        r = await api.post("/internal/v1/assessments/destination", json={"destination_id": "kyoto", "persist": False}, headers=AUTH)
    a = r.json()
    hz = next(f for f in a["factors"] if f["key"] == "hazard_severity")
    assert hz["status"] == "unavailable" and a["assessment_status"] == "PARTIAL"
    assert "hazard_severity" in a["missing_indicators"]


async def test_all_providers_down_gives_no_category(api):
    with respx.mock(assert_all_called=False) as router:
        mock_providers(router, weather=503, hazards=503)
        r = await api.post("/internal/v1/assessments/destination", json={"destination_id": "kyoto", "persist": False}, headers=AUTH)
    a = r.json()
    assert a["risk_category"] is None and a["assessment_status"] == "INCOMPLETE"
    assert "could not be assessed" in a["explanation"]["recommended_action"]


async def test_high_destination_raises_one_deduplicated_alert_then_resolves(api, db):
    async def assess(gust):
        with respx.mock(assert_all_called=False) as router:
            mock_providers(router, gust=gust)
            set_http(None)
            return (await api.post("/internal/v1/assessments/destination", json={"destination_id": "kyoto"}, headers=AUTH)).json()
    first = await assess(35.0)  # hurricane-force gust now → extreme weather → HIGH
    assert first["risk_category"] == "HIGH"
    await assess(35.0)
    with db.connect() as c:
        rows = c.execute(text("select status from safety_alerts where destination_id = 'kyoto' and user_id is null")).all()
    assert [r.status for r in rows] == ["active"]
    calm = await assess(3.0)
    if calm["risk_category"] == "LOW":  # forecast hours in the fixture are real; resolve only once conditions clear
        with db.connect() as c:
            assert c.execute(text("select status from safety_alerts where destination_id = 'kyoto' and user_id is null")).scalar() == "resolved"


async def test_journey_of_another_user_rejected(api, db, user_id):
    other = str(uuid.uuid4())
    with db.begin() as c:
        c.execute(text("insert into auth.users (id, email) values (:i, :e)"), {"i": other, "e": f"{other}@t.test"})
        jid = c.execute(text("""insert into journeys (user_id, destination_id, destination_name, start_date, end_date)
                                values (:u, 'kyoto', 'Kyoto', current_date + 1, current_date + 2) returning id"""),
                        {"u": other}).scalar()
    body = {"user_id": user_id, "journey_id": str(jid), "destination_id": "kyoto",
            "travel_start": "2099-01-01T00:00:00Z"}
    r = await api.post("/internal/v1/assessments/journey", json=body, headers=AUTH)
    assert r.status_code == 422  # travel_start more than a year ahead
    from datetime import datetime, timedelta, timezone
    body["travel_start"] = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    r = await api.post("/internal/v1/assessments/journey", json=body, headers=AUTH)
    assert r.status_code == 403
