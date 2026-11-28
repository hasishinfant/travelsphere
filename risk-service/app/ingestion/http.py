"""Resilient HTTP access for every external provider.

* timeouts on every request
* retries with exponential backoff on network errors, 429 and 5xx (honours Retry-After, capped)
* per-host minimum interval (client-side rate limiting, polite to free public APIs)
* in-memory TTL cache keyed by URL + params (cache hits are reported, so freshness can be judged)
* every result carries its retrieval timestamp and whether it came from cache
"""
from __future__ import annotations

import asyncio
import json
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlencode, urlparse

import httpx

from app.core.config import get_settings


class ProviderError(Exception):
    def __init__(self, source: str, message: str, status: int | None = None):
        super().__init__(f"{source}: {message}")
        self.source = source
        self.status = status


@dataclass
class FetchResult:
    source: str
    url: str
    data: Any
    retrieved_at: datetime
    from_cache: bool = False
    attempts: int = 1


@dataclass
class _CacheEntry:
    expires: float
    result: FetchResult


@dataclass
class HttpClient:
    timeout_s: float = field(default_factory=lambda: get_settings().http_timeout_s)
    retries: int = field(default_factory=lambda: get_settings().http_retries)
    min_interval_s: dict[str, float] = field(default_factory=lambda: {
        "overpass-api.de": 2.0, "overpass.kumi.systems": 2.0, "maps.mail.ru": 2.0,
        "router.project-osrm.org": 1.0, "routing.openstreetmap.de": 1.0,
        "www.gdacs.org": 0.5, "archive-api.open-meteo.com": 0.2,
    })
    transport: httpx.AsyncBaseTransport | None = None
    max_backoff_s: float = 20.0
    _cache: dict[str, _CacheEntry] = field(default_factory=dict)
    _last_call: dict[str, float] = field(default_factory=dict)
    _locks: dict[str, asyncio.Lock] = field(default_factory=dict)
    _client: httpx.AsyncClient | None = None

    def _http(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                timeout=self.timeout_s, transport=self.transport, follow_redirects=True,
                headers={"User-Agent": get_settings().user_agent, "Accept": "application/json"},
            )
        return self._client

    async def close(self) -> None:
        if self._client is not None:
            await self._client.aclose()

    def clear_cache(self) -> None:
        self._cache.clear()

    async def _throttle(self, host: str) -> None:
        gap = self.min_interval_s.get(host, 0.0)
        if not gap:
            return
        lock = self._locks.setdefault(host, asyncio.Lock())
        async with lock:
            wait = self._last_call.get(host, 0.0) + gap - time.monotonic()
            if wait > 0:
                await asyncio.sleep(wait)
            self._last_call[host] = time.monotonic()

    async def get_json(self, source: str, url: str, params: dict[str, Any] | None = None, *,
                       ttl_s: float = 0, method: str = "GET", data: dict[str, str] | None = None,
                       retries: int | None = None, timeout_s: float | None = None) -> FetchResult:
        key = f"{method} {url}?{urlencode(sorted((params or {}).items()), doseq=True)}|{json.dumps(data, sort_keys=True)}"
        hit = self._cache.get(key)
        # Wall-clock expiry: time.monotonic() stops while a Mac sleeps, so a 10-minute entry cached in the evening
        # was still "fresh" the next morning (a 6-hour-old weather reading served as current).
        if hit and hit.expires > time.time():
            r = hit.result
            return FetchResult(r.source, r.url, r.data, r.retrieved_at, from_cache=True, attempts=0)

        host = urlparse(url).hostname or ""
        last: Exception | None = None
        for attempt in range(1, (self.retries if retries is None else retries) + 2):
            await self._throttle(host)
            try:
                resp = await self._http().request(method, url, params=params, data=data,
                                                  timeout=timeout_s if timeout_s is not None else self.timeout_s)
            except (httpx.TimeoutException, httpx.TransportError) as e:
                last = ProviderError(source, f"network error: {type(e).__name__}")
                await asyncio.sleep(min(self.max_backoff_s, 0.5 * 2 ** (attempt - 1)))
                continue
            if resp.status_code == 429 or resp.status_code >= 500:
                last = ProviderError(source, f"HTTP {resp.status_code}", resp.status_code)
                retry_after = resp.headers.get("Retry-After")
                delay = float(retry_after) if retry_after and retry_after.isdigit() else 0.5 * 2 ** (attempt - 1)
                await asyncio.sleep(min(self.max_backoff_s, delay))
                continue
            if resp.status_code >= 400:
                raise ProviderError(source, f"HTTP {resp.status_code}", resp.status_code)
            try:
                payload = resp.json()
            except ValueError as e:
                raise ProviderError(source, "response is not JSON") from e
            result = FetchResult(source, str(resp.url), payload, datetime.now(timezone.utc), attempts=attempt)
            if ttl_s > 0:
                self._cache[key] = _CacheEntry(time.time() + ttl_s, result)
            return result
        raise last or ProviderError(source, "request failed")


_shared: HttpClient | None = None


def get_http() -> HttpClient:
    global _shared
    if _shared is None:
        _shared = HttpClient()
    return _shared


def set_http(client: HttpClient | None) -> None:
    """Tests inject a client with a mock transport."""
    global _shared
    _shared = client
