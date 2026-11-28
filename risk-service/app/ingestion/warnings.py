"""Official weather warnings from national meteorological services, as active hazards (factor 2).

  * MeteoAlarm (EUMETNET) — the official warnings of European national weather services (Météo-France, Met Office,
    Aeronautica Militare, HNMS, Veðurstofa Íslands …) as CAP messages, one JSON feed per country.
  * US National Weather Service — CAP alerts for a point (api.weather.gov).
A warning affects a destination when it is issued for the destination's warning area (MeteoAlarm: the region's
NUTS3/EMMA code or name, configured below) or covers the point (NWS). Warnings are matched by area, not by polygon,
so they are treated as point hazards at the destination (no footprint).
Severity is the issuing service's own CAP severity: Minor → minor, Moderate → moderate (yellow), Severe → severe
(orange), Extreme → extreme (red). "Green"/no-warning and cancelled or expired messages are ignored.
Not covered: Japan (JMA replaced its warning system on 28 May 2026 and the old JSON feed stopped updating),
Indonesia (BMKG feed refuses automated access) and India (IMD API requires registration).
"""
from __future__ import annotations

import re
from datetime import datetime, timezone

from shapely.geometry import Point

from app.ingestion.http import ProviderError, get_http
from app.schemas.domain import Destination, HazardEvent

METEOALARM = "meteoalarm"
NWS = "nws"
METEOALARM_URL = "https://feeds.meteoalarm.org/api/v1/warnings/feeds-{country}"
NWS_URL = "https://api.weather.gov/alerts/active"

# destination id → (MeteoAlarm country feed, region codes, region-name fragments)
METEOALARM_AREAS: dict[str, tuple[str, set[str], tuple[str, ...]]] = {
    "paris": ("france", {"FR101"}, ("Paris",)),
    "london": ("united-kingdom", set(), ("London & South East",)),
    "rome": ("italy", {"IT012"}, ("Lazio",)),
    "santorini": ("greece", set(), ("Cyclades", "Κυκλάδ", "South Aegean", "Νότιο Αιγαίο")),
    "iceland": ("iceland", {"IS002"}, ("South Iceland",)),
}
NWS_DESTINATIONS = {"new-york"}
NOT_COVERED = {"tokyo": "JMA warning feed stopped updating on 28 May 2026 (new system)",
               "kyoto": "JMA warning feed stopped updating on 28 May 2026 (new system)",
               "bali": "BMKG warning feed refuses automated access",
               "bengaluru": "IMD warning API requires registration"}

CAP_CLASS = {"minor": "minor", "moderate": "moderate", "severe": "severe", "extreme": "extreme"}
# MeteoAlarm awareness_type number → our hazard type (drives the recommended action)
AWARENESS_TYPE = {1: "wind", 2: "cold", 3: "thunderstorm", 4: "fog", 5: "heat", 6: "cold", 7: "coastal",
                  8: "wildfire", 9: "avalanche", 10: "rain", 12: "flood", 13: "flood"}


def _ts(s: str | None) -> datetime | None:
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")) if s else None
    except ValueError:
        return None


def _param(info: dict, name: str) -> str | None:
    return next((p.get("value") for p in info.get("parameter") or [] if p.get("valueName") == name), None)


def parse_meteoalarm(body: dict, dest: Destination, now: datetime) -> list[HazardEvent]:
    """Active warnings for the destination's region from one country feed."""
    _, codes, names = METEOALARM_AREAS[dest.id]
    out: dict[str, HazardEvent] = {}
    for w in (body or {}).get("warnings") or []:
        alert = w.get("alert") or {}
        if alert.get("msgType") == "Cancel" or alert.get("status", "Actual") != "Actual":
            continue
        infos = alert.get("info") or []
        info = next((i for i in infos if str(i.get("language", "")).lower().startswith("en")), infos[0] if infos else None)
        if not info:
            continue
        onset, expires = _ts(info.get("onset") or info.get("effective")), _ts(info.get("expires"))
        if not expires or expires <= now:
            continue
        level = (_param(info, "awareness_level") or "")       # e.g. "3; orange; Severe"
        colour = (level.split(";")[1].strip().lower() if level.count(";") >= 1 else "")
        if colour in ("green", "") and (info.get("severity") or "").lower() in ("minor", "unknown", ""):
            continue                                            # "no warning" / informational
        areas = [a for i in infos for a in i.get("area") or []]
        match = [a for a in areas if {g.get("value") for g in a.get("geocode") or []} & codes
                 or any(n.lower() in (a.get("areaDesc") or "").lower() for n in names)]
        if not match:
            continue
        cls = CAP_CLASS.get((info.get("severity") or "").lower())
        if not cls:
            continue
        tnum = re.match(r"\s*(\d+)", _param(info, "awareness_type") or "")
        htype = AWARENESS_TYPE.get(int(tnum.group(1)), "weather") if tnum else "weather"
        ident = alert.get("identifier") or f"{dest.id}:{info.get('event')}:{expires.isoformat()}"
        title = info.get("headline") or info.get("event") or "Weather warning"
        out[ident] = HazardEvent(
            source_id=METEOALARM, external_id=ident, hazard_type=htype, title=title, severity_class=cls,
            latitude=dest.latitude, longitude=dest.longitude, geometry=Point(dest.longitude, dest.latitude),
            geometry_kind="point", valid_from=onset or now, valid_to=expires, is_current=True, verified=True,
            observed_at=_ts(alert.get("sent")) or now, retrieved_at=now, alert_level=colour or None,
            severity_text=f"{info.get('senderName') or 'National weather service'} {colour or ''} warning".strip(),
            country=dest.country_code, url=info.get("web"),
            raw={"area": match[0].get("areaDesc"), "event": info.get("event"), "instruction": info.get("instruction")})
    return list(out.values())


def parse_nws(body: dict, dest: Destination, now: datetime) -> list[HazardEvent]:
    out = []
    for f in (body or {}).get("features") or []:
        p = f.get("properties") or {}
        if p.get("status") != "Actual" or p.get("messageType") == "Cancel":
            continue
        expires = _ts(p.get("ends") or p.get("expires"))
        if expires and expires <= now:
            continue
        cls = CAP_CLASS.get((p.get("severity") or "").lower())
        if not cls:
            continue
        event = p.get("event") or "Weather alert"
        e = event.lower()
        htype = next((t for k, t in (("flood", "flood"), ("wind", "wind"), ("winter", "cold"), ("snow", "cold"),
                                     ("ice", "cold"), ("cold", "cold"), ("heat", "heat"), ("thunder", "thunderstorm"),
                                     ("tornado", "wind"), ("hurricane", "cyclone"), ("tropical", "cyclone"),
                                     ("fog", "fog"), ("fire", "wildfire"), ("rain", "rain")) if k in e), "weather")
        out.append(HazardEvent(
            source_id=NWS, external_id=p.get("id") or f.get("id") or event, hazard_type=htype,
            title=p.get("headline") or event, severity_class=cls, latitude=dest.latitude, longitude=dest.longitude,
            geometry=Point(dest.longitude, dest.latitude), geometry_kind="point",
            valid_from=_ts(p.get("onset") or p.get("effective")) or now, valid_to=expires, is_current=True,
            verified=True, observed_at=_ts(p.get("sent")) or now, retrieved_at=now,
            alert_level={"extreme": "red", "severe": "orange", "moderate": "yellow"}.get(cls),
            severity_text=f"US National Weather Service {event}", country="US", url=p.get("@id"),
            raw={"area": p.get("areaDesc"), "event": event, "instruction": p.get("instruction")}))
    return out


def source_for(dest: Destination) -> str | None:
    return METEOALARM if dest.id in METEOALARM_AREAS else NWS if dest.id in NWS_DESTINATIONS else None


async def fetch_warnings(dest: Destination, now: datetime | None = None) -> list[HazardEvent]:
    """Active official warnings for the destination. Raises ProviderError when the feed fails; returns [] when the
    destination has no warning source (callers report that via NOT_COVERED)."""
    now = now or datetime.now(timezone.utc)
    if dest.id in METEOALARM_AREAS:
        country = METEOALARM_AREAS[dest.id][0]
        res = await get_http().get_json(METEOALARM, METEOALARM_URL.format(country=country), ttl_s=10 * 60)
        return parse_meteoalarm(res.data or {}, dest, now)
    if dest.id in NWS_DESTINATIONS:
        res = await get_http().get_json(NWS, NWS_URL, {"point": f"{dest.latitude:.4f},{dest.longitude:.4f}"},
                                        ttl_s=5 * 60)
        return parse_nws(res.data or {}, dest, now)
    return []


__all__ = ["fetch_warnings", "source_for", "NOT_COVERED", "parse_meteoalarm", "parse_nws", "ProviderError"]
