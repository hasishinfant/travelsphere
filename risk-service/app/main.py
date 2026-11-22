"""TravelSphere risk-intelligence service (FastAPI).

Run:  uvicorn app.main:app --host 127.0.0.1 --port 8001
Bind to loopback (default) or a private network only — the Express API is the public entry point.
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.api.routes import internal, public
from app.background.scheduler import start_scheduler, stop_scheduler
from app.core.config import ENGINE_VERSION, get_settings
from app.ingestion.http import get_http

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("risk")


@asynccontextmanager
async def lifespan(_: FastAPI):
    s = get_settings()
    if not s.service_token and s.host not in ("127.0.0.1", "localhost", "::1"):
        raise RuntimeError("RISK_SERVICE_TOKEN is required when the service is not bound to loopback")
    if not s.service_token:
        log.warning("RISK_SERVICE_TOKEN not set — internal API is unauthenticated (loopback development only)")
    if s.scheduler_enabled:
        start_scheduler()
    yield
    stop_scheduler()
    await get_http().close()


app = FastAPI(title="TravelSphere Risk Intelligence", version=ENGINE_VERSION, lifespan=lifespan,
              docs_url=None if get_settings().env == "production" else "/docs", redoc_url=None)
app.include_router(public)
app.include_router(internal)


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
    details = [{"field": ".".join(str(p) for p in e["loc"][1:]) or "(body)", "message": e["msg"]} for e in exc.errors()]
    return JSONResponse(status_code=422, content={"error": {"code": "validation_failed", "message": "Invalid request",
                                                            "details": details}})


@app.exception_handler(Exception)
async def unhandled(_: Request, exc: Exception) -> JSONResponse:
    log.exception("unhandled error: %s", type(exc).__name__)
    return JSONResponse(status_code=500, content={"error": {"code": "internal", "message": "Risk service error"}})
