"""
Ingests a Layer 1 export payload for a project: runs the verification
engine, then persists the VerificationRecord + normalized
AlignedObservation rows in one transaction.

This is the DB-touching wrapper around the pure verification_engine —
keep new business rules in verification_engine.py where they're testable
without a database; keep this file thin.
"""

from sqlalchemy.orm import Session

from app.models.verification import AlignedObservation, FinalizationStatus, VerificationRecord
from app.schemas.layer1_export import Layer1ExportPayload
from app.services.verification_engine import VerificationOutcome, run_verification


def ingest_layer1_export(
    db: Session,
    project_id: str,
    payload: Layer1ExportPayload,
    is_recheck: bool = False,
) -> VerificationRecord:
    result = run_verification(payload)

    finalization_status = (
        FinalizationStatus.OPEN_FOR_CHALLENGE
        if result.verification_outcome == VerificationOutcome.PROVISIONALLY_VERIFIED
        else FinalizationStatus.NOT_APPLICABLE
    )

    record = VerificationRecord(
        project_id=project_id,
        generated_at=payload.generated_at,
        s2_scene_count=payload.summary.s2_scene_count,
        landsat_scene_count=payload.summary.landsat_scene_count,
        matched_pair_count=payload.summary.matched_pair_count,
        ndvi_agreement_pass_count=payload.summary.ndvi_agreement_pass_count,
        agreement_rate=result.agreement_rate,
        coverage_ratio=result.coverage_ratio,
        ndvi_trend_per_year=result.ndvi_trend_per_year,
        estimated_tons_co2e=result.estimated_tons_co2e,
        verification_outcome=result.verification_outcome,
        finalization_status=finalization_status,
        challenge_window_expires_at=result.challenge_window_expires_at,
        is_recheck=is_recheck,
        raw_payload=payload.model_dump(mode="json"),
    )

    for a in payload.aligned_observations:
        record.aligned_observations.append(
            AlignedObservation(
                s2_date=a.s2_date,
                landsat_date=a.landsat_date,
                days_apart=a.days_apart,
                s2_ndvi=a.s2_ndvi,
                landsat_ndvi=a.landsat_ndvi,
                ndvi_agreement=a.ndvi_agreement,
                s2_evi=a.s2_evi,
                landsat_evi=a.landsat_evi,
                evi_agreement=a.evi_agreement,
                matched=a.matched,
            )
        )

    db.add(record)
    db.commit()
    db.refresh(record)
    return record
