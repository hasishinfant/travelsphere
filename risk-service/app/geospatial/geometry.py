"""Geometry utilities.

All stored geometry is WGS84 (EPSG:4326, lon/lat). Distances and lengths are never computed in degrees:
* point-to-point distances use the geodesic on the WGS84 ellipsoid (pyproj.Geod);
* geometry-to-geometry distances, lengths and intersections are computed in an azimuthal-equidistant (AEQD)
  projection centred on the area of interest, where distances from the centre are exact and nearby distortion is
  small (well under 1 % within a few hundred km). Antimeridian-crossing geometries are not supported.
"""
from __future__ import annotations

from functools import lru_cache
from typing import Iterable

import geopandas as gpd
from pyproj import CRS, Geod, Transformer
from shapely import make_valid
from shapely.geometry import LineString, Point, shape
from shapely.geometry.base import BaseGeometry
from shapely.ops import transform, unary_union

GEOD = Geod(ellps="WGS84")


def valid_coordinate(lat: float | None, lon: float | None) -> bool:
    return (isinstance(lat, (int, float)) and isinstance(lon, (int, float))
            and -90 <= lat <= 90 and -180 <= lon <= 180
            and not (lat == 0 and lon == 0))  # (0,0) "null island" is almost always a missing-value artefact


def parse_geojson(obj: dict) -> BaseGeometry | None:
    try:
        if obj.get("type") == "FeatureCollection":
            geoms = [shape(f["geometry"]) for f in obj.get("features", []) if f.get("geometry")]
            g = unary_union(geoms) if geoms else None
        elif obj.get("type") == "Feature":
            g = shape(obj["geometry"]) if obj.get("geometry") else None
        else:
            g = shape(obj)
    except (KeyError, TypeError, ValueError, AttributeError):
        return None
    if g is None or g.is_empty:
        return None
    return g if g.is_valid else make_valid(g)


def geodesic_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    return abs(GEOD.inv(lon1, lat1, lon2, lat2)[2])


@lru_cache(maxsize=256)
def _aeqd(lat: float, lon: float) -> CRS:
    return CRS.from_proj4(f"+proj=aeqd +lat_0={lat:.4f} +lon_0={lon:.4f} +datum=WGS84 +units=m +no_defs")


@lru_cache(maxsize=256)
def _to_local(lat: float, lon: float) -> Transformer:
    return Transformer.from_crs("EPSG:4326", _aeqd(lat, lon), always_xy=True)


def local_crs_for(geom: BaseGeometry) -> CRS:
    c = geom.centroid
    return _aeqd(round(c.y, 2), round(c.x, 2))


def to_local(geom: BaseGeometry, centre: BaseGeometry) -> BaseGeometry:
    c = centre.centroid
    return transform(_to_local(round(c.y, 2), round(c.x, 2)).transform, geom)


def distance_m(a: BaseGeometry, b: BaseGeometry) -> float:
    """Minimum distance in metres between two WGS84 geometries (0 if they touch/overlap)."""
    if isinstance(a, Point) and isinstance(b, Point):
        return geodesic_m(a.y, a.x, b.y, b.x)
    if a.intersects(b):
        return 0.0
    return float(to_local(a, a).distance(to_local(b, a)))


def length_m(line: BaseGeometry) -> float:
    if isinstance(line, LineString):
        return float(GEOD.geometry_length(line))
    return float(to_local(line, line).length)


def nearest_points_distance(points: Iterable[tuple[float, float]], lat: float, lon: float) -> list[float]:
    """Geodesic distance from (lat, lon) to each (lat, lon) point."""
    return [geodesic_m(lat, lon, p_lat, p_lon) for p_lat, p_lon in points]


def route_hazard_overlay(route: LineString, hazards: list[tuple[str, BaseGeometry]]) -> dict:
    """Intersect a route with hazard footprints (GeoPandas overlay in a local metric CRS).

    Returns the total route length, the length inside the union of all footprints (overlaps counted once),
    and the length inside each footprint.
    """
    total = length_m(route)
    areal = [(hid, g) for hid, g in hazards if g.geom_type in ("Polygon", "MultiPolygon", "GeometryCollection")]
    if not areal or total == 0:
        return {"total_m": total, "exposed_m": 0.0, "per_hazard_m": {}}
    crs = local_crs_for(route)
    zones = gpd.GeoDataFrame({"hazard_id": [h for h, _ in areal]}, geometry=[g for _, g in areal], crs="EPSG:4326").to_crs(crs)
    zones["geometry"] = zones.geometry.make_valid()
    line = gpd.GeoDataFrame({"route": [0]}, geometry=[route], crs="EPSG:4326").to_crs(crs)
    pieces = gpd.overlay(line, zones, how="intersection", keep_geom_type=False)
    per_hazard = {str(r.hazard_id): float(r.geometry.length) for r in pieces.itertuples()} if len(pieces) else {}
    union = unary_union(list(zones.geometry))
    exposed = float(line.geometry.iloc[0].intersection(union).length)
    # The overlay was in a local projection; scale to the geodesic total so fractions stay consistent
    proj_total = float(line.geometry.iloc[0].length) or 1.0
    k = total / proj_total
    return {"total_m": total, "exposed_m": exposed * k, "per_hazard_m": {h: v * k for h, v in per_hazard.items()}}


def sample_line(line: LineString, n: int) -> list[Point]:
    """n points evenly spaced along a line (by fraction of length), including both ends."""
    if n <= 1:
        return [Point(line.coords[0])]
    return [line.interpolate(i / (n - 1), normalized=True) for i in range(n)]


def simplify_for_storage(line: LineString, tolerance_deg: float = 0.0005) -> dict:
    """~50 m simplification: enough to redraw the route, not a precise movement trace."""
    simple = line.simplify(tolerance_deg, preserve_topology=False)
    return {"type": "LineString", "coordinates": [[round(x, 5), round(y, 5)] for x, y in simple.coords]}


def geodesic_circle(lat: float, lon: float, radius_m: float, segments: int = 64) -> BaseGeometry:
    """Circle of true radius_m around (lat, lon) as a WGS84 polygon (buffer built in a local AEQD projection)."""
    crs = _aeqd(round(lat, 4), round(lon, 4))
    fwd = Transformer.from_crs("EPSG:4326", crs, always_xy=True)
    inv = Transformer.from_crs(crs, "EPSG:4326", always_xy=True)
    local = transform(fwd.transform, Point(lon, lat)).buffer(radius_m, segments)
    return transform(inv.transform, local)
