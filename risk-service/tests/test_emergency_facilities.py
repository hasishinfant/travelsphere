"""Nearby emergency facilities: OSM parsing, privacy rounding, distance filtering, failure reporting, country lookup."""
import asyncio

import pytest

from app.geospatial import countries
from app.ingestion import overpass
from app.ingestion.http import ProviderError
from app.schemas.domain import Facility
from app.services import data


def test_parse_keeps_mapped_phone_and_never_invents_one():
    body = {"elements": [
        {"type": "node", "id": 1, "lat": 48.85, "lon": 2.35,
         "tags": {"amenity": "hospital", "name": "Hôpital A", "emergency": "yes", "phone": "+33 1 23 45 67 89;+33 1 00"}},
        {"type": "way", "id": 2, "center": {"lat": 48.86, "lon": 2.36},
         "tags": {"amenity": "clinic", "healthcare": "clinic", "contact:phone": "01 42 00 00 00"}},
        {"type": "node", "id": 3, "lat": 48.87, "lon": 2.37, "tags": {"amenity": "police", "phone": "n/a"}},
        {"type": "node", "id": 4, "lat": 48.88, "lon": 2.38, "tags": {"amenity": "cafe"}},
    ]}
    out = overpass.parse(body)
    assert [f.osm_id for f in out] == ["n1", "w2", "n3"]
    assert out[0].phone == "+33 1 23 45 67 89" and out[0].has_emergency is True
    assert out[1].phone == "01 42 00 00 00" and out[1].healthcare == "clinic"
    # A clinic without an emergency tag is "unknown", never assumed to have an emergency department
    assert out[1].has_emergency is None
    assert out[2].phone is None  # "n/a" is not a phone number
    assert all(f.retrieved_at is not None for f in out)


@pytest.fixture
def no_db(monkeypatch):
    stored = []
    monkeypatch.setattr(data.repo, "cached_facilities", lambda *a, **k: None)
    monkeypatch.setattr(data.repo, "store_facilities", lambda *a, **k: stored.append(a))
    monkeypatch.setattr(data.repo, "record_source", lambda *a, **k: None)
    return stored


def test_nearby_queries_a_rounded_centre_and_filters_by_true_distance(monkeypatch, no_db):
    calls = []

    async def fake_fetch(lat, lon, radius_m):
        calls.append((lat, lon, radius_m))
        return [Facility("n1", "hospital", "Near", 48.8571, 2.3522, True),
                Facility("n2", "police", "Far", 48.90, 2.35)]  # ~4.8 km away

    monkeypatch.setattr(data.overpass, "fetch_facilities", fake_fetch)
    out = asyncio.run(data.nearby_facilities(48.856613, 2.352222, 2000))
    # Third parties and the cache see the 0.01° cell and a 1 km margin, not the exact position
    assert calls == [(48.86, 2.35, 3000)]
    assert no_db[0][:3] == (48.86, 2.35, 3000)
    assert [f["osm_id"] for f in out["facilities"]] == ["n1"]
    assert out["facilities"][0]["distance_m"] < 100
    assert out["error"] is None and out["cached"] is False
    assert "OpenStreetMap" in out["source"]


def test_nearby_reports_failure_instead_of_an_empty_area(monkeypatch, no_db):
    async def down(*a):
        raise ProviderError("overpass", "all mirrors busy")

    monkeypatch.setattr(data.overpass, "fetch_facilities", down)
    out = asyncio.run(data.nearby_facilities(35.0, 135.77, 5000))
    assert out["facilities"] == []
    assert "busy" in out["error"]
    assert no_db == []  # a failure is not cached as "no facilities here"


def test_nearby_empty_area_is_not_an_error(monkeypatch, no_db):
    async def none(*a):
        return []

    monkeypatch.setattr(data.overpass, "fetch_facilities", none)
    out = asyncio.run(data.nearby_facilities(-75.0, 0.5, 5000))
    assert out["facilities"] == [] and out["error"] is None


@pytest.mark.skipif(not countries.COUNTRIES_ZIP.exists(), reason="Natural Earth admin-0 file not downloaded")
def test_country_lookup():
    assert countries.country_at(48.85, 2.35) == "FR"
    assert countries.country_at(-8.65, 115.2) == "ID"
    assert countries.country_at(30.0, -40.0) is None  # open ocean


def test_country_lookup_without_boundary_file(tmp_path):
    assert countries.country_at(48.85, 2.35, path=tmp_path / "missing.zip") is None
