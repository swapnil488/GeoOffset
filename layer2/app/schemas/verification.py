from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict

from app.models.verification import FinalizationStatus, VerificationOutcome


class AlignedObservationOut(BaseModel):
    s2_date: Optional[date]
    landsat_date: Optional[date]
    days_apart: Optional[int]
    s2_ndvi: Optional[float]
    landsat_ndvi: Optional[float]
    ndvi_agreement: Optional[bool]
    s2_evi: Optional[float]
    landsat_evi: Optional[float]
    evi_agreement: Optional[bool]
    matched: bool

    model_config = ConfigDict(from_attributes=True)


class VerificationRecordOut(BaseModel):
    id: int
    project_id: str
    generated_at: datetime
    ingested_at: datetime

    s2_scene_count: int
    landsat_scene_count: int
    matched_pair_count: int
    ndvi_agreement_pass_count: int

    agreement_rate: Optional[float]
    coverage_ratio: Optional[float]
    ndvi_trend_per_year: Optional[float]
    estimated_tons_co2e: Optional[float]

    verification_outcome: VerificationOutcome
    finalization_status: FinalizationStatus
    challenge_window_expires_at: Optional[datetime]
    is_recheck: bool

    model_config = ConfigDict(from_attributes=True)


class VerificationRecordDetailOut(VerificationRecordOut):
    aligned_observations: list[AlignedObservationOut]
