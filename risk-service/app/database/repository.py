"""All SQL used by the risk service (SQLAlchemy Core, bound parameters only)."""
from __future__ import annotations

import json
import math
from datetime import datetime, timedelta, timezone
from typing import Any

from shapely.geometry import Point, mapping, shape
from sqlalchemy import text

from app.database.session import get_engine, tx
from app.geospatial.geometry import geodesic_circle, geodesic_m, parse_geojson
from app.schemas.domain import Destination, Facility, HazardEvent
from app.schemas.factors import FactorResult


def _bbox(lat: float, lon: float, radius_m: float) -> dict[str, float]:
    dlat = radius_m / 111_320
    dlon = radius_m / (111_320 * max(0.05, math.cos(math.radians(lat))))
    return {"lat0": lat - dlat, "lat1": lat + dlat, "lon0": lon - dlon, "lon1": lon + dlon}


def db_available() -> bool:
    return get_engine() is not None


# ------------------------------------------------------------------ destinations
def _dest(r: Any) -> Destination:
    return Destination(id=r.id, name=r.name, latitude=r.latitude, longitude=r.longitude, country_code=r.country_code,
                       timezone=r.timezone, assessment_radius_m=r.assessment_radius_m, default_activity=r.default_activity,
                       setting=r.setting, terrain=list(r.terrain or []))


def get_destination(dest_id: str) -> Destination | None:
    with tx() as c:
        r = c.execute(text("select * from public.destinations where id = :id and active"), {"id": dest_id}).first()
    return _dest(r) if r else None


def list_destinations() -> list[Destination]:
    with tx() as c:
        return [_dest(r) for r in c.execute(text("select * from public.destinations where active order by id"))]


# ------------------------------------------------------------------ data sources
def record_source(source_id: str, ok: bool, error: str | None = None) -> None:
    if not db_available():
        return
    with tx() as c:
        if ok:
            c.execute(text("""update public.data_sources set last_success_at = now(), consecutive_failures = 0,
                              last_error = null, updated_at = now() where id = :id"""), {"id": source_id})
        else:
            c.execute(text("""update public.data_sources set last_failure_at = now(), last_error = :e,
                              consecutive_failures = consecutive_failures + 1, updated_at = now() where id = :id"""),
                      {"id": source_id, "e": (error or "")[:500]})


def source_status() -> list[dict]:
    with tx() as c:
        return [dict(r._mapping) for r in c.execute(text(
            "select id, name, kind, credibility_tier, max_age_minutes, last_success_at, last_failure_at, last_error, "
            "consecutive_failures from public.data_sources order by id"))]


# ------------------------------------------------------------------ hazards
def upsert_hazards(events: list[HazardEvent]) -> None:
    if not events or not db_available():
        return
    with tx() as c:
        for e in events:
            row = c.execute(text("""
                insert into public.hazard_events (source_id, external_id, hazard_type, title, alert_level, severity_class,
                  severity_value, severity_unit, severity_text, latitude, longitude, geometry, geometry_kind, country,
                  valid_from, valid_to, is_current, verified, url, observed_at, retrieved_at, raw)
                values (:source_id, :external_id, :hazard_type, :title, :alert_level, :severity_class, :severity_value,
                  :severity_unit, :severity_text, :lat, :lon, cast(:geometry as jsonb), :geometry_kind, :country,
                  :valid_from, :valid_to, :is_current, :verified, :url, :observed_at, :retrieved_at, cast(:raw as jsonb))
                on conflict (source_id, external_id) do update set
                  title = excluded.title, alert_level = excluded.alert_level, severity_class = excluded.severity_class,
                  severity_value = excluded.severity_value, severity_text = excluded.severity_text,
                  latitude = excluded.latitude, longitude = excluded.longitude,
                  geometry = coalesce(excluded.geometry, public.hazard_events.geometry),
                  geometry_kind = case when excluded.geometry_kind = 'polygon' then 'polygon' else public.hazard_events.geometry_kind end,
                  valid_from = excluded.valid_from, valid_to = excluded.valid_to, is_current = excluded.is_current,
                  verified = excluded.verified, observed_at = excluded.observed_at, retrieved_at = excluded.retrieved_at,
                  raw = excluded.raw
                returning id"""), {
                "source_id": e.source_id, "external_id": e.external_id, "hazard_type": e.hazard_type, "title": e.title[:300],
                "alert_level": e.alert_level if e.alert_level in ("green", "yellow", "orange", "red") else None,
                "severity_class": e.severity_class,
                "severity_value": e.severity_value, "severity_unit": e.severity_unit, "severity_text": e.severity_text,
                "lat": e.latitude, "lon": e.longitude,
                "geometry": json.dumps(mapping(e.geometry)) if e.has_footprint else None,
                "geometry_kind": e.geometry_kind, "country": e.country, "valid_from": e.valid_from, "valid_to": e.valid_to,
                "is_current": e.is_current, "verified": e.verified, "url": e.url, "observed_at": e.observed_at,
                "retrieved_at": e.retrieved_at,
                "raw": json.dumps({**e.raw, "zones": [{"class": z, "label": l, "geometry": mapping(g)} for z, g, l in e.zones],
                                   "footprint_note": e.footprint_note}, default=str),
            }).first()
            e.db_id = str(row.id)


def _hazard_from_row(r: Any) -> HazardEvent:
    raw = r.raw or {}
    geom = parse_geojson(r.geometry) if r.geometry else None
    ev = HazardEvent(source_id=r.source_id, external_id=r.external_id, hazard_type=r.hazard_type, title=r.title,
                     severity_class=r.severity_class, latitude=r.latitude, longitude=r.longitude,
                     geometry=geom or Point(r.longitude, r.latitude), geometry_kind="polygon" if geom is not None else "point",
                     valid_from=r.valid_from, valid_to=r.valid_to, is_current=r.is_current, verified=r.verified,
                     observed_at=r.observed_at, retrieved_at=r.retrieved_at, alert_level=r.alert_level,
                     severity_value=float(r.severity_value) if r.severity_value is not None else None,
                     severity_unit=r.severity_unit, severity_text=r.severity_text, country=r.country, url=r.url,
                     db_id=str(r.id), raw=raw, footprint_note=raw.get("footprint_note"))
    ev.zones = [(z["class"], shape(z["geometry"]), z["label"]) for z in raw.get("zones") or [] if z.get("geometry")]
    return ev


def cached_active_hazards(source_id: str, lat: float, lon: float, radius_m: float, max_age_min: int) -> list[HazardEvent]:
    """Fallback when a feed is down: active events from this source retrieved recently enough to still be trusted."""
    if not db_available():
        return []
    with tx() as c:
        rows = c.execute(text("""
            select * from public.hazard_events where source_id = :s and is_current
              and retrieved_at > now() - make_interval(mins => :age)
              and latitude between :lat0 and :lat1 and longitude between :lon0 and :lon1"""),
            {"s": source_id, "age": max_age_min, **_bbox(lat, lon, radius_m)}).all()
    return [_hazard_from_row(r) for r in rows]


def retire_missing_current(source_id: str, still_current: list[str]) -> None:
    """Events that disappeared from a provider's current list are no longer active."""
    if not db_available():
        return
    with tx() as c:
        c.execute(text("""update public.hazard_events set is_current = false,
                            valid_to = coalesce(valid_to, now())
                          where source_id = :s and is_current and not (external_id = any(:ids))"""),
                  {"s": source_id, "ids": still_current})


def historical_hazards(lat: float, lon: float, radius_m: float, since: datetime) -> list[HazardEvent]:
    with tx() as c:
        rows = c.execute(text("""
            select * from public.hazard_events where valid_from >= :since and source_id in ('gdacs', 'usgs-earthquakes')
              and latitude between :lat0 and :lat1 and longitude between :lon0 and :lon1"""),
            {"since": since, **_bbox(lat, lon, radius_m)}).all()
    return [_hazard_from_row(r) for r in rows]


def history_loaded(source_id: str, since: datetime) -> bool:
    with tx() as c:
        return bool(c.execute(text("""select exists(select 1 from public.hazard_events where source_id = :s
                                      and valid_from < :since + interval '30 days')"""), {"s": source_id, "since": since}).scalar())


def risk_zones_near(lat: float, lon: float, radius_m: float, now: datetime) -> list[HazardEvent]:
    """Admin-configured circular zones → footprint polygons (buffer built in a local metric projection)."""
    if not db_available():
        return []
    with tx() as c:
        rows = c.execute(text("""
            select * from public.risk_zones where active and (valid_from is null or valid_from <= :now)
              and (valid_to is null or valid_to > :now)
              and latitude between :lat0 and :lat1 and longitude between :lon0 and :lon1"""),
            {"now": now, **_bbox(lat, lon, radius_m)}).all()
    out = []
    type_map = {"storm": "storm", "heat": "heat", "flood": "flood", "landslide": "landslide", "wildfire": "wildfire"}
    for r in rows:
        poly = geodesic_circle(r.latitude, r.longitude, r.radius_m)
        sev = {"LOW": "minor", "MODERATE": "moderate", "HIGH": "severe"}[r.severity]
        out.append(HazardEvent(source_id="travelsphere-config", external_id=str(r.id), hazard_type=type_map.get(r.hazard_type, "other"),
                               title=r.name, severity_class=sev, latitude=r.latitude, longitude=r.longitude, geometry=poly,
                               geometry_kind="polygon", valid_from=r.valid_from or r.created_at, valid_to=r.valid_to,
                               is_current=True, verified=False, observed_at=r.created_at, retrieved_at=now,
                               footprint_note=f"Configured zone, radius {r.radius_m} m ({r.source})", db_id=None))
    return out


def verified_incident_count(lat: float, lon: float, radius_m: float, since: datetime) -> int | None:
    if not db_available():
        return None
    with tx() as c:
        rows = c.execute(text("""select latitude, longitude from public.incidents where verified and latitude is not null
                                 and occurred_at >= :since and latitude between :lat0 and :lat1 and longitude between :lon0 and :lon1"""),
                         {"since": since, **_bbox(lat, lon, radius_m)}).all()
    return sum(geodesic_m(lat, lon, r.latitude, r.longitude) <= radius_m for r in rows)


# ------------------------------------------------------------------ facilities cache
def _cell(lat: float, lon: float, radius_m: int) -> str:
    return f"{round(lat, 2):.2f}:{round(lon, 2):.2f}:{radius_m}"


def cached_facilities(lat: float, lon: float, radius_m: int, max_age_days: int = 30) -> list[Facility] | None:
    if not db_available():
        return None
    with tx() as c:
        hit = c.execute(text("""select 1 from public.facility_searches where cell_key = :k
                                and searched_at > now() - make_interval(days => :d)"""),
                        {"k": _cell(lat, lon, radius_m), "d": max_age_days}).first()
        if not hit:
            return None
        rows = c.execute(text("""select * from public.emergency_facilities
                                 where latitude between :lat0 and :lat1 and longitude between :lon0 and :lon1"""),
                         _bbox(lat, lon, radius_m)).all()
    return [Facility(osm_id=r.osm_id, kind=r.kind, name=r.name, latitude=r.latitude, longitude=r.longitude,
                     has_emergency=r.has_emergency, phone=getattr(r, "phone", None),
                     healthcare=getattr(r, "healthcare", None), retrieved_at=r.retrieved_at) for r in rows]


def store_facilities(lat: float, lon: float, radius_m: int, facilities: list[Facility]) -> None:
    if not db_available():
        return
    with tx() as c:
        for f in facilities:
            c.execute(text("""insert into public.emergency_facilities (osm_id, kind, name, latitude, longitude, has_emergency,
                                phone, healthcare)
                              values (:id, :k, :n, :lat, :lon, :e, :ph, :hc)
                              on conflict (osm_id) do update set kind = excluded.kind, name = excluded.name,
                                latitude = excluded.latitude, longitude = excluded.longitude,
                                has_emergency = excluded.has_emergency, phone = excluded.phone,
                                healthcare = excluded.healthcare, retrieved_at = now()"""),
                      {"id": f.osm_id, "k": f.kind, "n": f.name, "lat": f.latitude, "lon": f.longitude, "e": f.has_emergency,
                       "ph": f.phone, "hc": f.healthcare})
        c.execute(text("""insert into public.facility_searches (cell_key, latitude, longitude, radius_m, result_count)
                          values (:k, :lat, :lon, :r, :n) on conflict (cell_key) do update set
                          result_count = excluded.result_count, searched_at = now()"""),
                  {"k": _cell(lat, lon, radius_m), "lat": round(lat, 2), "lon": round(lon, 2), "r": radius_m,
                   "n": len(facilities)})


# ------------------------------------------------------------------ indicators
def store_indicators(dest_id: str, source_id: str, observed_at: datetime, values: dict[str, tuple[float | None, str]],
                     quality: dict | None = None) -> None:
    if not db_available():
        return
    with tx() as c:
        for name, (v, unit) in values.items():
            c.execute(text("""insert into public.safety_indicators (destination_id, indicator, value, unit, source_id, observed_at, quality)
                              values (:d, :i, :v, :u, :s, :t, cast(:q as jsonb))
                              on conflict (destination_id, indicator, source_id, observed_at) do nothing"""),
                      {"d": dest_id, "i": name, "v": v, "u": unit, "s": source_id, "t": observed_at,
                       "q": json.dumps(quality or {})})


def last_weather_indicator_time(dest_id: str) -> datetime | None:
    with tx() as c:
        return c.execute(text("""select max(observed_at) from public.safety_indicators
                                 where destination_id = :d and source_id = 'open-meteo-forecast'"""), {"d": dest_id}).scalar()


# ------------------------------------------------------------------ assessments
def _factor_params(f: FactorResult) -> dict:
    return {"key": f.key, "status": f.status, "value": f.value, "cls": f.severity_class, "raw": f.raw_value,
            "unit": f.unit, "inputs": json.dumps(f.inputs, default=str), "sources": f.data_quality.sources,
            "expl": f.explanation, "dq": f.data_quality.model_dump_json(), "obs": f.observed_at, "at": f.computed_at}


FACTOR_INSERT = text("""insert into public.factor_assessments
    (destination_assessment_id, journey_assessment_id, factor_key, status, value, severity_class, raw_value, unit, inputs,
     source_ids, explanation, data_quality, observed_at, computed_at)
    values (:da, :ja, :key, :status, :value, :cls, :raw, :unit, cast(:inputs as jsonb), :sources, :expl,
            cast(:dq as jsonb), :obs, :at)""")


def save_destination_assessment(a: dict, factors: list[FactorResult]) -> str:
    with tx() as c:
        prev = c.execute(text("""select risk_category from public.destination_assessments where destination_id = :d
                                 order by assessed_at desc limit 1"""), {"d": a["destination_id"]}).scalar()
        aid = c.execute(text("""insert into public.destination_assessments
            (destination_id, risk_category, composite_index, assessment_status, data_coverage, data_reliability,
             missing_indicators, active_warnings, critical_override, explanation, scoring_version, engine_version,
             ml_signal, inputs_hash, assessed_at, confidence, destination_score, population)
            values (:destination_id, :risk_category, :composite_index, :assessment_status, :data_coverage, :data_reliability,
             :missing, cast(:warnings as jsonb), :critical_override, cast(:explanation as jsonb), :scoring_version,
             :engine_version, cast(:ml as jsonb), :inputs_hash, :assessed_at, cast(:conf as jsonb), cast(:score as jsonb),
             cast(:pop as jsonb)) returning id"""),
            {**a, "missing": a["missing_indicators"], "warnings": json.dumps(a["active_warnings"], default=str),
             "conf": json.dumps(a.get("confidence"), default=str), "score": json.dumps(a.get("destination_score"), default=str),
             "pop": json.dumps(a.get("population"), default=str),
             "explanation": json.dumps(a["explanation"], default=str),
             "ml": json.dumps(a.get("ml_signal"), default=str) if a.get("ml_signal") else None}).scalar()
        for f in factors:
            c.execute(FACTOR_INSERT, {"da": aid, "ja": None, **_factor_params(f)})
        c.execute(text("""insert into public.assessment_history (subject_type, destination_id, assessment_id, risk_category,
            previous_category, composite_index, data_reliability, assessment_status, scoring_version, assessed_at)
            values ('destination', :d, :id, :cat, :prev, :idx, :rel, :st, :sv, :at)"""),
            {"d": a["destination_id"], "id": aid, "cat": a["risk_category"], "prev": prev, "idx": a["composite_index"],
             "rel": a["data_reliability"], "st": a["assessment_status"], "sv": a["scoring_version"], "at": a["assessed_at"]})
    return str(aid)


def save_journey_assessment(a: dict, factors: list[FactorResult]) -> str:
    with tx() as c:
        prev = None
        if a.get("journey_id"):
            prev = c.execute(text("""select risk_category from public.journey_assessments where journey_id = :j
                                     order by assessed_at desc limit 1"""), {"j": a["journey_id"]}).scalar()
        aid = c.execute(text("""insert into public.journey_assessments
            (journey_id, user_id, destination_id, destination_assessment_id, risk_category, assessment_status,
             data_reliability, dimensions, route, safer_route, activity, travel_start, travel_end, travellers,
             missing_indicators, critical_override, explanation, scoring_version, engine_version, assessed_at,
             confidence, population)
            values (:journey_id, :user_id, :destination_id, :destination_assessment_id, :risk_category, :assessment_status,
             :data_reliability, cast(:dimensions as jsonb), cast(:route as jsonb), cast(:safer as jsonb), :activity,
             :travel_start, :travel_end, :travellers, :missing, :critical_override, cast(:explanation as jsonb),
             :scoring_version, :engine_version, :assessed_at, cast(:conf as jsonb), cast(:pop as jsonb)) returning id"""),
            {**a, "dimensions": json.dumps(a["dimensions"], default=str), "route": json.dumps(a.get("route"), default=str),
             "safer": json.dumps(a.get("safer_route"), default=str), "missing": a["missing_indicators"],
             "conf": json.dumps(a.get("confidence"), default=str), "pop": json.dumps(a.get("population"), default=str),
             "explanation": json.dumps(a["explanation"], default=str)}).scalar()
        for f in factors:
            c.execute(FACTOR_INSERT, {"da": None, "ja": aid, **_factor_params(f)})
        c.execute(text("""insert into public.assessment_history (subject_type, destination_id, journey_id, user_id,
            assessment_id, risk_category, previous_category, data_reliability, assessment_status, scoring_version, assessed_at)
            values ('journey', :d, :j, :u, :id, :cat, :prev, :rel, :st, :sv, :at)"""),
            {"d": a["destination_id"], "j": a.get("journey_id"), "u": a["user_id"], "id": aid, "cat": a["risk_category"],
             "prev": prev, "rel": a["data_reliability"], "st": a["assessment_status"], "sv": a["scoring_version"],
             "at": a["assessed_at"]})
    return str(aid)


# ------------------------------------------------------------------ alerts
def create_alert(alert: dict) -> str | None:
    """Insert unless an active alert with the same dedup key exists for the same recipient. Returns id or None."""
    with tx() as c:
        row = c.execute(text("""insert into public.safety_alerts (user_id, destination_id, journey_id, destination_assessment_id,
              journey_assessment_id, hazard_event_id, level, title, body, recommended_action, dedup_key, expires_at)
            values (:user_id, :destination_id, :journey_id, :destination_assessment_id, :journey_assessment_id,
              :hazard_event_id, :level, :title, :body, :recommended_action, :dedup_key, :expires_at)
            on conflict do nothing returning id"""), alert).first()
        if row and alert.get("user_id"):
            c.execute(text("""insert into public.notifications (user_id, kind, title, body, risk_level, dedup_key, safety_alert_id, expires_at)
                              values (:u, 'risk_warning', :t, :b, :l, :k, :id, :exp) on conflict do nothing"""),
                      {"u": alert["user_id"], "t": alert["title"], "b": alert["body"][:2000], "l": alert["level"],
                       "k": f"alert:{row.id}", "id": row.id, "exp": alert["expires_at"]})
    return str(row.id) if row else None


def expire_alerts(now: datetime | None = None) -> int:
    with tx() as c:
        return c.execute(text("""update public.safety_alerts set status = 'expired'
                                 where status = 'active' and expires_at <= :now"""),
                         {"now": now or datetime.now(timezone.utc)}).rowcount


def resolve_destination_alerts(dest_id: str, keep_keys: list[str]) -> int:
    """Destination-wide alerts whose condition no longer holds are resolved."""
    with tx() as c:
        return c.execute(text("""update public.safety_alerts set status = 'resolved' where destination_id = :d
                                 and user_id is null and status = 'active' and not (dedup_key = any(:k))"""),
                         {"d": dest_id, "k": keep_keys}).rowcount


def purge_expired_locations() -> int:
    with tx() as c:
        return c.execute(text("delete from public.journey_locations where expires_at <= now()")).rowcount


def journeys_to_reassess(horizon_days: int = 7) -> list[dict]:
    with tx() as c:
        return [dict(r._mapping) for r in c.execute(text("""
            select j.id as journey_id, j.user_id, j.destination_id, j.start_date, j.end_date, j.travellers,
                   coalesce((select i.activity_type from public.itinerary_items i where i.journey_id = j.id
                             order by case i.activity_type when 'trekking' then 0 when 'water' then 1 else 2 end limit 1),
                            'sightseeing') as activity
            from public.journeys j join public.destinations d on d.id = j.destination_id
            where j.status in ('planned', 'active') and j.end_date >= current_date
              and j.start_date <= current_date + make_interval(days => :h)"""), {"h": horizon_days})]


def journey_owner(journey_id: str) -> str | None:
    with tx() as c:
        return c.execute(text("select user_id::text from public.journeys where id = :j"), {"j": journey_id}).scalar()


def touch_scoring_version(cfg: dict) -> None:
    if not db_available():
        return
    with tx() as c:
        c.execute(text("""update public.model_versions set config = cast(:cfg as jsonb) where id = :id"""),
                  {"id": cfg["version"], "cfg": json.dumps({k: v for k, v in cfg.items() if not k.startswith("_")})})


def register_model(meta: dict) -> None:
    with tx() as c:
        c.execute(text("""insert into public.model_versions (id, kind, description, metrics, trained_at, is_active, status,
                            features, dataset, artifact_sha256)
                          values (:id, 'ml', :desc, cast(:metrics as jsonb), :trained_at, false, 'experimental', :features,
                            cast(:dataset as jsonb), :sha)
                          on conflict (id) do update set metrics = excluded.metrics, trained_at = excluded.trained_at,
                            features = excluded.features, dataset = excluded.dataset, artifact_sha256 = excluded.artifact_sha256,
                            description = excluded.description"""),
                  {"id": meta["model_id"], "desc": meta["description"], "metrics": json.dumps(meta["metrics"], default=str),
                   "trained_at": meta["trained_at"], "features": meta["features"],
                   "dataset": json.dumps(meta["dataset"], default=str), "sha": meta["artifact_sha256"]})


def since(days: int) -> datetime:
    return datetime.now(timezone.utc) - timedelta(days=days)
