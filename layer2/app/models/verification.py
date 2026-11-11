"""
VerificationRecord: one row per Layer 1 ingestion run for a project
(both the original submission and any dispute-triggered rechecks).

AlignedObservation: normalized per-pair rows mirroring Layer 1's
`aligned_observations` list, kept queryable rather than left buried in
the raw_payload JSONB blob.
"""

import enum
from datetime import datetime, timezone

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    Date,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
)
from sqlalchemy.orm import relationship

from app.database import Base


class VerificationOutcome(str, enum.Enum):
    """Result of the dual-pipeline adversarial agreement check itself."""
    INSUFFICIENT_DATA = "INSUFFICIENT_DATA"     # not enough scenes/pairs to judge
    REJECTED = "REJECTED"                        # sensors disagree too much to trust
    PROVISIONALLY_VERIFIED = "PROVISIONALLY_VERIFIED"  # passed, pending challenge window


class FinalizationStatus(str, enum.Enum):
    """
    Lifecycle of a PROVISIONALLY_VERIFIED record through the 72-hour
    escrow-backed challenge window (see app/services/dispute_engine.py).
    Records that never reach PROVISIONALLY_VERIFIED sit at NOT_APPLICABLE.
    """
    NOT_APPLICABLE = "NOT_APPLICABLE"
    OPEN_FOR_CHALLENGE = "OPEN_FOR_CHALLENGE"
    UNDER_DISPUTE = "UNDER_DISPUTE"
    FINALIZED_MINTABLE = "FINALIZED_MINTABLE"
    FINALIZED_REJECTED = "FINALIZED_REJECTED"


class VerificationRecord(Base):
    __tablename__ = "verification_records"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(String, ForeignKey("projects.project_id"), nullable=False, index=True)

    # Provenance from the Layer 1 export payload.
    generated_at = Column(DateTime(timezone=True), nullable=False)
    ingested_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    s2_scene_count = Column(Integer, nullable=False)
    landsat_scene_count = Column(Integer, nullable=False)
    matched_pair_count = Column(Integer, nullable=False)
    ndvi_agreement_pass_count = Column(Integer, nullable=False)

    agreement_rate = Column(Float, nullable=True)
    coverage_ratio = Column(Float, nullable=True)
    ndvi_trend_per_year = Column(Float, nullable=True)
    estimated_tons_co2e = Column(Float, nullable=True)

    verification_outcome = Column(Enum(VerificationOutcome), nullable=False)
    finalization_status = Column(
        Enum(FinalizationStatus), nullable=False, default=FinalizationStatus.NOT_APPLICABLE
    )
    challenge_window_expires_at = Column(DateTime(timezone=True), nullable=True)

    # True for the second, independent recheck run that resolves a
    # dispute rather than an original project submission.
    is_recheck = Column(Boolean, nullable=False, default=False)

    # Full Layer 1 export, kept for audit trail / re-derivation.
    raw_payload = Column(JSON, nullable=False)

    project = relationship("Project", back_populates="verification_records")
    aligned_observations = relationship(
        "AlignedObservation", back_populates="verification_record", cascade="all, delete-orphan"
    )


class AlignedObservation(Base):
    __tablename__ = "aligned_observations"

    id = Column(Integer, primary_key=True, index=True)
    verification_record_id = Column(
        Integer, ForeignKey("verification_records.id"), nullable=False, index=True
    )

    s2_date = Column(Date, nullable=True)
    landsat_date = Column(Date, nullable=True)
    days_apart = Column(Integer, nullable=True)

    s2_ndvi = Column(Float, nullable=True)
    landsat_ndvi = Column(Float, nullable=True)
    ndvi_agreement = Column(Boolean, nullable=True)

    s2_evi = Column(Float, nullable=True)
    landsat_evi = Column(Float, nullable=True)
    evi_agreement = Column(Boolean, nullable=True)

    matched = Column(Boolean, nullable=False)

    verification_record = relationship("VerificationRecord", back_populates="aligned_observations")
