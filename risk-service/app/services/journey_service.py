"""Journey-context assessment for one traveller: route (OSRM + alternatives), weather at the times the traveller is
at each point, hazards touching the route, response accessibility, safer-route comparison."""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

from shapely.geometry import Point

from app.core.config import ENGINE_VERSION, get_settings
from app.database import repository as repo
from app.geospatial.geometry import sample_line, simplify_for_storage
from app.risk_engine.aggregation.config import load_scoring
from app.risk_engine.context import AssessmentContext, TimedWeather
from app.risk_engine.explanations.builder import build
from app.risk_engine import confidence, population
from app.risk_engine.factors.hazard_exposure import exposure_of
from app.risk_engine.journey_context.assessor import assess_journey
from app.schemas.api import JourneyAssessmentRequest
from app.schemas.domain import Destination
from app.services import data
from app.services.alerts import journey_alerts
from app.services.destination_service import access_for, compute_factors

ROUTE_WEATHER_SAMPLES = 3


def safer_route(primary, alternatives, hazards, start, end, min_reduction: float) -> dict:
    if hazards is None:
        return {"available": False, "reason": "Hazard data unavailable"}
    base = exposure_of(primary, hazards, start, end)
    if base["exposed_m"] == 0:
        return {"available": False, "reason": "The planned route is not exposed to any hazard footprint"}
    if not alternatives:
        return {"available": False, "reason": "No alternative route was returned by the router",
                "primary_exposed_m": round(base["exposed_m"])}
    best = None
    for alt in alternatives:
        e = exposure_of(alt, hazards, start, end)
        if best is None or e["exposed_m"] < best[1]["exposed_m"]:
            best = (alt, e)
    alt, e = best
    reduction = 1 - e["exposed_m"] / base["exposed_m"]
    if reduction < min_reduction:
        return {"available": False, "reason": f"Alternatives reduce hazard exposure by only {reduction:.0%}",
                "primary_exposed_m": round(base["exposed_m"])}
    extra = (alt.duration_s - primary.duration_s) / 60
    return {"available": True, "exposure_reduction": round(reduction, 3), "exposed_m": round(e["exposed_m"]),
            "primary_exposed_m": round(base["exposed_m"]), "extra_minutes": round(extra, 1),
            "distance_m": round(alt.distance_m), "geometry": simplify_for_storage(alt.geometry),
            "summary": (f"An alternative route cuts hazard exposure by {reduction:.0%} "
                        f"({base['exposed_m'] / 1000:.1f} → {e['exposed_m'] / 1000:.1f} km) for "
                        f"{'+' if extra >= 0 else ''}{extra:.0f} min")}


async def assess_journey_request(req: JourneyAssessmentRequest, dest: Destination, now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    cfg = load_scoring(get_settings().scoring_config)
    jcfg = cfg["journey"]
    start = req.travel_start.astimezone(timezone.utc)

    origin = req.origin or req.current_location
    stops = [(p.latitude, p.longitude) for p in req.waypoints]
    waypoints = ([(origin.latitude, origin.longitude)] if origin else []) + (stops or [(dest.latitude, dest.longitude)])
    has_route = len(waypoints) >= 2
    location = Point(origin.longitude, origin.latitude) if origin else Point(dest.longitude, dest.latitude)

    route, alternatives = (await data.routes_for(waypoints, req.transport_mode)) if has_route else (None, [])
    travel_min = route.duration_s / 60 if route else 0
    end = (req.travel_end.astimezone(timezone.utc) if req.travel_end
           else start + timedelta(minutes=travel_min + req.activity_duration_minutes))

    # Weather where the traveller will be, when they will be there
    timed: list[tuple[Point, datetime]] = []
    if route:
        for i, p in enumerate(sample_line(route.geometry, ROUTE_WEATHER_SAMPLES)):
            timed.append((p, start + timedelta(seconds=route.duration_s * i / (ROUTE_WEATHER_SAMPLES - 1))))
    pts = [(p.y, p.x) for p, _ in timed] + [(dest.latitude, dest.longitude)]

    search = cfg["hazard_search_radius_m"]
    fac_radius = jcfg["facility_search_radius_m"]
    access_centre = location if not route else route.geometry.interpolate(0.5, normalized=True)
    # Terrain and remoteness at up to 5 points along the route (or the stay location)
    shape_pts = [(p.y, p.x) for p in sample_line(route.geometry, 5)] if route else [(location.y, location.x)]
    (snaps, w_err), hz, hist, (place, p_err), (facilities, f_err), (samples, t_err), warn = await asyncio.gather(
        data.weather_for(pts, now),
        data.active_hazards(location.y, location.x, search, now),
        data.history_for(dest.latitude, dest.longitude, cfg, now),
        data.place_info(dest),
        data.facilities_near(access_centre.y, access_centre.x,
                             fac_radius + (int(route.distance_m / 2) if route else 0)),
        data.terrain_for(shape_pts),
        data.official_warnings(dest, now),
    )
    hazards, ok, failed, checks = data.merge_warnings(hz, *warn)
    ctx = AssessmentContext(
        now=now, mode="journey", destination=dest, location=location, window_start=start, window_end=end,
        weather=snaps[-1], weather_error=w_err,
        route_weather=[TimedWeather(p, t, s) for (p, t), s in zip(timed, snaps[:-1])],
        hazards=hazards, hazard_sources_ok=ok, hazard_sources_failed=failed, agreement_checks=checks,
        route=route, alternatives=alternatives, activity=req.activity, travellers=req.travellers,
        place_info=place, place_error=p_err, history=hist, facilities=facilities, facility_error=f_err,
        facility_search_radius_m=fac_radius, terrain=samples, terrain_error=t_err,
        remoteness=data.remoteness_for(shape_pts))
    # Response accessibility (routed drive time from the least-served point when OSRM is reachable)
    ctx.access = access = await access_for(ctx.subject, facilities, f_err, cfg)

    re_minutes = exposure_of(route, hazards, start, end)["exposed_minutes"] if route and hazards is not None else None
    factors = compute_factors(ctx)
    conf = confidence.compute(ctx, factors, cfg["confidence"]["levels"])

    result = assess_journey(ctx, factors, access, cfg)
    safer = safer_route(route, alternatives, hazards, start, end, jcfg["safer_route_min_reduction"]) if route else \
        {"available": False, "reason": "No route"}
    explanation = build(ctx, factors, result["category"], result["status"], result["rationale"], access, safer)

    out = {
        "id": None, "journey_id": str(req.journey_id) if req.journey_id else None, "user_id": str(req.user_id),
        "destination_id": dest.id, "risk_category": result["category"], "assessment_status": result["status"],
        "composite_index": result["composite_index"], "data_coverage": result["coverage"], "data_reliability": conf["value"],
        "confidence": conf, "population": population.context(ctx, re_minutes),
        "missing_indicators": result["missing"], "critical_override": result["critical_override"],
        "override_event": result["override_event"], "dimensions": result["dimensions"],
        "route": None if not route else {"source": route.source, "profile": route.profile, "distance_m": round(route.distance_m),
                                         "duration_min": round(route.duration_s / 60, 1), "precision_note": route.precision_note,
                                         "alternatives": len(alternatives), "geometry": simplify_for_storage(route.geometry)},
        "safer_route": safer, "activity": req.activity, "travellers": req.travellers,
        "travel_start": start.isoformat(), "travel_end": end.isoformat(),
        "factors": [f.model_dump(mode="json") for f in factors], "explanation": explanation,
        "scoring_version": cfg["version"], "engine_version": ENGINE_VERSION, "assessed_at": now.isoformat(),
    }
    if req.persist and repo.db_available():
        out["id"] = repo.save_journey_assessment({**out, "destination_assessment_id": None, "assessed_at": now,
                                                  "travel_start": start, "travel_end": end}, factors)
        journey_alerts(out, ctx, cfg, now)
    return out
