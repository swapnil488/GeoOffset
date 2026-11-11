"""
AOI (area of interest) loading and validation.

Accepts a GeoJSON file (single Polygon/MultiPolygon feature) and converts
it into an ee.Geometry, with basic sanity checks so a malformed or absurdly
large AOI fails loudly here rather than burning GEE quota downstream.
"""

import json
import ee

MAX_AOI_AREA_KM2 = 5000  # sanity cap; tune per your project scale


def load_aoi(geojson_path: str) -> ee.Geometry:
    with open(geojson_path) as f:
        gj = json.load(f)

    # Accept a bare geometry, a Feature, or a FeatureCollection with one feature
    if gj.get("type") == "FeatureCollection":
        if len(gj["features"]) != 1:
            raise ValueError(
                "AOI FeatureCollection must contain exactly one feature "
                f"(got {len(gj['features'])}). Split multi-site AOIs into "
                "separate projects."
            )
        geometry_dict = gj["features"][0]["geometry"]
    elif gj.get("type") == "Feature":
        geometry_dict = gj["geometry"]
    else:
        geometry_dict = gj

    if geometry_dict.get("type") not in ("Polygon", "MultiPolygon"):
        raise ValueError(
            f"AOI must be a Polygon or MultiPolygon, got {geometry_dict.get('type')}"
        )

    geometry = ee.Geometry(geometry_dict)
    _validate_area(geometry)
    return geometry


def _validate_area(geometry: ee.Geometry) -> None:
    area_km2 = geometry.area().divide(1_000_000).getInfo()
    if area_km2 <= 0:
        raise ValueError("AOI has zero or negative area — check your coordinates.")
    if area_km2 > MAX_AOI_AREA_KM2:
        raise ValueError(
            f"AOI area ({area_km2:.1f} km²) exceeds MAX_AOI_AREA_KM2 "
            f"({MAX_AOI_AREA_KM2}). Confirm this is intentional or split "
            "into sub-projects."
        )
    print(f"[aoi] Loaded AOI, area = {area_km2:.2f} km²")
