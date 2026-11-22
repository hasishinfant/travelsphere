"""Internal API (called only by the Express backend, authenticated with RISK_SERVICE_TOKEN)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from app.core.config import ENGINE_VERSION, get_settings
from app.core.security import require_service_token
from app.database import repository as repo
from app.database.session import healthy, postgis_enabled
from app.ml.inference import predictor
from app.risk_engine.aggregation.config import load_scoring
from app.schemas.api import DestinationAssessmentRequest, JourneyAssessmentRequest
from app.services.destination_service import assess_destination
from app.services.journey_service import assess_journey_request

public = APIRouter()
internal = APIRouter(prefix="/internal/v1", dependencies=[Depends(require_service_token)])


@public.get("/health")
def health() -> dict:
    db = healthy()
    return {"status": "ok" if db else "degraded", "engine_version": ENGINE_VERSION,
            "scoring_version": get_settings().scoring_config, "database": "connected" if db else "unavailable"}


@internal.get("/status")
def status() -> dict:
    return {"engine_version": ENGINE_VERSION, "scoring": {k: v for k, v in load_scoring(get_settings().scoring_config).items()
                                                          if not k.startswith("_")},
            "postgis": postgis_enabled(), "sources": repo.source_status() if healthy() else None,
            "ml_model": predictor.status()}


def _destination(dest_id: str):
    if not repo.db_available():
        raise HTTPException(503, "database not configured")
    dest = repo.get_destination(dest_id)
    if dest is None:
        raise HTTPException(404, "unknown destination")
    return dest


@internal.post("/assessments/destination")
async def destination(req: DestinationAssessmentRequest) -> dict:
    return await assess_destination(_destination(req.destination_id), persist=req.persist)


@internal.post("/assessments/destinations")
async def destinations_batch(persist: bool = True) -> dict:
    """All active destinations (used by the place-conditions list). Assessed sequentially to stay polite to providers;
    HTTP-level caching makes repeated weather/hazard calls cheap."""
    out = []
    for d in repo.list_destinations():
        out.append(await assess_destination(d, persist=persist))
    return {"assessments": out}


@internal.post("/assessments/journey")
async def journey(req: JourneyAssessmentRequest) -> dict:
    dest = _destination(req.destination_id)
    if req.journey_id is not None:
        owner = repo.journey_owner(str(req.journey_id))
        if owner is None:
            raise HTTPException(404, "unknown journey")
        if owner != str(req.user_id):
            raise HTTPException(403, "journey belongs to another user")
    return await assess_journey_request(req, dest)
