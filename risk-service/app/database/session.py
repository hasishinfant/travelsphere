"""SQLAlchemy 2.x engine. The schema is owned by the SQL migrations in supabase/migrations (applied by the Express
server's migrate script); this service never creates or alters tables — Alembic is deliberately not used so the
schema has a single owner."""
from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

from sqlalchemy import Engine, create_engine, text
from sqlalchemy.engine import Connection

from app.core.config import get_settings

_engine: Engine | None = None


def get_engine() -> Engine | None:
    global _engine
    url = get_settings().database_url
    if not url:
        return None
    if _engine is None:
        _engine = create_engine(url, pool_size=5, max_overflow=5, pool_pre_ping=True, future=True)
    return _engine


def set_engine(engine: Engine | None) -> None:
    global _engine
    _engine = engine


@contextmanager
def tx() -> Iterator[Connection]:
    eng = get_engine()
    if eng is None:
        raise RuntimeError("DATABASE_URL is not configured")
    with eng.begin() as conn:
        yield conn


def healthy() -> bool:
    eng = get_engine()
    if eng is None:
        return False
    try:
        with eng.connect() as c:
            c.execute(text("select 1"))
        return True
    except Exception:  # noqa: BLE001 — health check reports, never raises
        return False


def postgis_enabled() -> bool:
    eng = get_engine()
    if eng is None:
        return False
    try:
        with eng.connect() as c:
            return bool(c.execute(text("select exists(select 1 from pg_extension where extname = 'postgis')")).scalar())
    except Exception:  # noqa: BLE001
        return False
