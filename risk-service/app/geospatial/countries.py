"""Point → ISO 3166-1 alpha-2 country code, from Natural Earth 1:50m admin-0 boundaries (public domain).

Used only to pick the emergency-number table for a traveller's position. Natural Earth draws de facto boundaries;
disputed areas without an ISO code return None, and so does any point when the boundary file isn't installed
(download: see docs/EMERGENCY_SYSTEM_IMPLEMENTATION_REPORT.md). Callers must then ask the traveller for the country.
"""
from __future__ import annotations

import zipfile
from functools import lru_cache
from pathlib import Path

import shapely
from shapely.strtree import STRtree

from app.core.config import SERVICE_ROOT

COUNTRIES_ZIP = SERVICE_ROOT / "data" / "naturalearth" / "ne_50m_admin_0_countries.zip"
# Points just off a simplified 1:50m coastline (harbours, beaches) still resolve to the nearest country this close
COAST_TOLERANCE_DEG = 0.1


@lru_cache(maxsize=1)
def _index(path: str = str(COUNTRIES_ZIP)) -> tuple[STRtree, list[str | None]] | None:
    if not Path(path).exists():
        return None
    import geopandas as gpd
    with zipfile.ZipFile(path) as z:
        shp = next(n for n in z.namelist() if n.endswith(".shp"))
    g = gpd.read_file(f"zip://{path}!{shp}")
    codes = [c if isinstance(c, str) and len(c) == 2 and c.isalpha() else None for c in g["ISO_A2_EH"]]
    return STRtree(list(g.geometry.values)), codes


def country_at(lat: float, lon: float, path: Path = COUNTRIES_ZIP) -> str | None:
    idx = _index(str(path))
    if idx is None:
        return None
    tree, codes = idx
    p = shapely.Point(lon, lat)
    hits = tree.query(p, predicate="intersects")
    if len(hits):
        return codes[int(hits[0])]
    near = tree.query_nearest(p, max_distance=COAST_TOLERANCE_DEG)
    return codes[int(near[0])] if len(near) else None
