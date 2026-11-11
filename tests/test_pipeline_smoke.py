"""
Smoke tests for the parts of Layer 1 that don't require a live Earth Engine
connection — AOI file parsing and temporal alignment logic. Run with:

    pytest tests/test_pipeline_smoke.py

Full pipeline (GEE calls) should be tested against a real authenticated
session separately, not in CI without credentials.
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.temporal_alignment import align_timeseries


def test_sample_aoi_is_valid_geojson():
    path = os.path.join(os.path.dirname(__file__), "..", "data", "sample_aoi.geojson")
    with open(path) as f:
        gj = json.load(f)
    assert gj["type"] == "Feature"
    assert gj["geometry"]["type"] == "Polygon"
    assert len(gj["geometry"]["coordinates"][0]) >= 4


def test_temporal_alignment_matches_close_dates():
    s2 = [{"date": "2023-06-01", "ndvi": 0.72, "evi": 0.55}]
    landsat = [{"date": "2023-06-03", "ndvi": 0.70, "evi": 0.54}]

    result = align_timeseries(s2, landsat)

    assert len(result) == 1
    assert result[0]["matched"] is True
    assert result[0]["days_apart"] == 2
    assert result[0]["ndvi_agreement"] is True


def test_temporal_alignment_flags_disagreement():
    s2 = [{"date": "2023-06-01", "ndvi": 0.80, "evi": 0.60}]
    landsat = [{"date": "2023-06-02", "ndvi": 0.40, "evi": 0.30}]

    result = align_timeseries(s2, landsat)

    assert result[0]["matched"] is True
    assert result[0]["ndvi_agreement"] is False


def test_temporal_alignment_no_match_outside_window():
    s2 = [{"date": "2023-06-01", "ndvi": 0.72, "evi": 0.55}]
    landsat = [{"date": "2023-06-20", "ndvi": 0.70, "evi": 0.54}]

    result = align_timeseries(s2, landsat)

    assert result[0]["matched"] is False
    assert result[0]["landsat_date"] is None
