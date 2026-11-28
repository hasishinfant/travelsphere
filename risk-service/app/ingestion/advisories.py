"""Official government travel advice — the live "safety index" of the Tourist Confidence Score.

Two official sources, because each government does not advise on its own country:
  * US Department of State travel advisories (cadataapi.state.gov): Level 1 "Exercise normal precautions",
    2 "Exercise increased caution", 3 "Reconsider travel", 4 "Do not travel". Covers every country except the US.
  * UK FCDO foreign travel advice (GOV.UK content API): alert_status codes, e.g. "avoid_all_travel_to_parts".
    Covers every country except the UK.
Each is mapped to a 0–1 risk value on an equal-step ordinal scale (the mapping is ours, the levels are theirs):
  State Dept  L1 0 · L2 0.33 · L3 0.67 · L4 1
  FCDO        none 0 · avoid all but essential travel to parts 0.25 · avoid all travel to parts 0.5 ·
              avoid all but essential travel to the whole country 0.75 · avoid all travel to the whole country 1
The safety index is the MORE CAUTIOUS of the two available values. Advice describes crime, terrorism, unrest and
health as well as natural hazards, for the whole country — not a specific street.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone

from app.ingestion.http import ProviderError, get_http

STATE_SOURCE = "us-state-dept-advisories"
FCDO_SOURCE = "fcdo-travel-advice"
STATE_URL = "https://cadataapi.state.gov/api/TravelAdvisories"
FCDO_URL = "https://www.gov.uk/api/content/foreign-travel-advice/{slug}"
TTL_S = 12 * 3600

STATE_LEVEL_VALUE = {1: 0.0, 2: 1 / 3, 3: 2 / 3, 4: 1.0}
STATE_LEVEL_TEXT = {1: "Exercise normal precautions", 2: "Exercise increased caution", 3: "Reconsider travel",
                    4: "Do not travel"}
FCDO_VALUE = {
    "avoid_all_but_essential_travel_to_parts": 0.25,
    "avoid_all_travel_to_parts": 0.5,
    "avoid_all_but_essential_travel_to_whole_country": 0.75,
    "avoid_all_travel_to_whole_country": 1.0,
}
FCDO_TEXT = {
    "avoid_all_but_essential_travel_to_parts": "Advises against all but essential travel to parts of the country",
    "avoid_all_travel_to_parts": "Advises against all travel to parts of the country",
    "avoid_all_but_essential_travel_to_whole_country": "Advises against all but essential travel to the whole country",
    "avoid_all_travel_to_whole_country": "Advises against all travel to the whole country",
}
# GOV.UK slugs for ISO 3166-1 alpha-2 codes (extend as destinations are added). The FCDO has no page for the UK.
FCDO_SLUG = {"FR": "france", "IT": "italy", "GR": "greece", "JP": "japan", "ID": "indonesia", "US": "usa",
             "IS": "iceland", "IN": "india", "ES": "spain", "PT": "portugal", "DE": "germany", "TH": "thailand",
             "AE": "united-arab-emirates", "SG": "singapore", "AU": "australia", "NZ": "new-zealand"}
# The State Department's "Category" field uses US FIPS 10-4 country codes, not ISO (checked against the live list)
STATE_CODE = {"GB": "UK", "IS": "IC", "JP": "JA", "ES": "SP", "PT": "PO", "DE": "GM", "AU": "AS", "SG": "SN"}


def _iso(s: str | None) -> datetime | None:
    try:
        return datetime.fromisoformat(s) if s else None
    except ValueError:
        return None


async def state_dept(country: str) -> dict | None:
    """{level, value, text, updated, url} for the country, or None when the State Dept has no advisory (e.g. US)."""
    res = await get_http().get_json(STATE_SOURCE, STATE_URL, ttl_s=TTL_S)
    if not isinstance(res.data, list):
        raise ProviderError(STATE_SOURCE, "unexpected advisory list format")
    code = STATE_CODE.get(country, country)
    for a in res.data:
        cats = re.findall(r"[A-Z]{2}", str(a.get("Category", "")))
        if code not in cats:
            continue
        m = re.search(r"Level\s+([1-4])", a.get("Title", ""))
        if not m:
            continue
        level = int(m.group(1))
        return {"source": STATE_SOURCE, "level": level, "value": round(STATE_LEVEL_VALUE[level], 4),
                "text": f"US State Department Level {level}: {STATE_LEVEL_TEXT[level]}",
                "updated": (_iso(a.get("Updated")) or _iso(a.get("Published"))), "url": a.get("Link")}
    return None


async def fcdo(country: str) -> dict | None:
    """{codes, value, text, updated, url} for the country, or None when the FCDO has no page (e.g. the UK)."""
    slug = FCDO_SLUG.get(country)
    if not slug:
        return None
    res = await get_http().get_json(FCDO_SOURCE, FCDO_URL.format(slug=slug), ttl_s=TTL_S)
    d = res.data or {}
    status = (d.get("details") or {}).get("alert_status") or []
    codes = [c for c in status if isinstance(c, str)]
    value = max((FCDO_VALUE.get(c, 0.0) for c in codes), default=0.0)
    worst = max(codes, key=lambda c: FCDO_VALUE.get(c, 0.0)) if codes else None
    text = f"UK FCDO: {FCDO_TEXT.get(worst, worst)}" if worst else "UK FCDO: no advice against travel"
    return {"source": FCDO_SOURCE, "codes": codes, "value": value, "text": text,
            "updated": _iso(d.get("public_updated_at")), "url": f"https://www.gov.uk/foreign-travel-advice/{slug}"}


def combine(parts: list[dict], now: datetime | None = None) -> dict:
    """The more cautious of the available official values."""
    now = now or datetime.now(timezone.utc)
    if not parts:
        return {"available": False, "value": None, "sources": [], "explanation": "No official travel advice found"}
    worst = max(parts, key=lambda p: p["value"])
    return {"available": True, "value": worst["value"], "sources": parts,
            "explanation": "; ".join(p["text"] for p in parts) + (
                f" — using the more cautious ({worst['text'].split(':')[0]})" if len(parts) > 1 else ""),
            "retrieved_at": now.isoformat()}
