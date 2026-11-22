"""Internal service authentication: only the Express API (holding RISK_SERVICE_TOKEN) may call this service."""
from __future__ import annotations

import hmac

from fastapi import Header, HTTPException, status

from app.core.config import get_settings


def require_service_token(authorization: str | None = Header(default=None)) -> None:
    expected = get_settings().service_token
    if not expected:
        # Development without a token is allowed only when bound to loopback (see main.py startup check)
        if get_settings().env == "production":
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "service token not configured")
        return
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not hmac.compare_digest(token.encode(), expected.encode()):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid service token")
