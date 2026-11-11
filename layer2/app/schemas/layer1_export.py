"""
Pydantic models mirroring Layer 1's export.py output byte-for-byte.

Kept as a separate, explicit contract (rather than accepting an
unstructured dict) so a Layer 1 schema change fails loudly at the Layer
2 boundary instead of silently corrupting a verification record.

Verified against the real output of src/pipeline.py
(data/demo-project-001_timeseries.json): 48 S2 scenes, 19 Landsat scenes,
48 aligned records (one per S2 date; unmatched ones carry nulls).
"""

from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, Field


class SatelliteObservation(BaseModel):
    date: date
    sensor: str  # "sentinel2" | "landsat"
    ndvi: float
    evi: float
    cloud_pct: float
    valid_fraction: float


class AlignedObservation(BaseModel):
    s2_date: date
    landsat_date: Optional[date] = None
    days_apart: Optional[int] = None

    s2_ndvi: float
    landsat_ndvi: Optional[float] = None
    ndvi_agreement: Optional[bool] = None

    s2_evi: float
    landsat_evi: Optional[float] = None
    evi_agreement: Optional[bool] = None

    matched: bool


class Layer1Summary(BaseModel):
    s2_scene_count: int
    landsat_scene_count: int
    matched_pair_count: int
    ndvi_agreement_pass_count: int


class Layer1ExportPayload(BaseModel):
    project_id: str
    generated_at: datetime
    aoi_area_km2: float = Field(gt=0)
    sentinel2_observations: list[SatelliteObservation]
    landsat_observations: list[SatelliteObservation]
    aligned_observations: list[AlignedObservation]
    summary: Layer1Summary
