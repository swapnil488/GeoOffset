from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.project import Project
from app.models.verification import VerificationRecord
from app.schemas.layer1_export import Layer1ExportPayload
from app.schemas.verification import VerificationRecordDetailOut, VerificationRecordOut
from app.services.dispute_engine import finalize_if_window_expired
from app.services.ingestion import ingest_layer1_export

router = APIRouter(tags=["verifications"])


@router.post(
    "/projects/{project_id}/verifications",
    response_model=VerificationRecordOut,
    status_code=201,
)
def submit_verification(
    project_id: str, payload: Layer1ExportPayload, db: Session = Depends(get_db)
):
    """
    Ingest a Layer 1 export for this project and run the dual-pipeline
    adversarial verification check. If it passes, the record opens a
    72-hour challenge window before it's mintable.
    """
    project = db.query(Project).filter(Project.project_id == project_id).first()
    if not project:
        raise HTTPException(404, f"Project '{project_id}' not found.")
    if payload.project_id != project_id:
        raise HTTPException(
            422,
            f"Payload project_id '{payload.project_id}' does not match URL project_id "
            f"'{project_id}'.",
        )

    return ingest_layer1_export(db, project_id=project_id, payload=payload, is_recheck=False)


@router.get("/projects/{project_id}/verifications", response_model=list[VerificationRecordOut])
def list_verifications(project_id: str, db: Session = Depends(get_db)):
    return (
        db.query(VerificationRecord)
        .filter(VerificationRecord.project_id == project_id)
        .order_by(VerificationRecord.ingested_at.desc())
        .all()
    )


@router.get("/verifications/{verification_id}", response_model=VerificationRecordDetailOut)
def get_verification(verification_id: int, db: Session = Depends(get_db)):
    record = db.query(VerificationRecord).filter(VerificationRecord.id == verification_id).first()
    if not record:
        raise HTTPException(404, f"Verification record {verification_id} not found.")
    return record


@router.post(
    "/verifications/{verification_id}/finalize", response_model=VerificationRecordOut
)
def finalize_verification(verification_id: int, db: Session = Depends(get_db)):
    """
    Manually trigger the "has the 72-hour challenge window elapsed with
    no dispute?" check. In production this is a scheduled job; exposed
    here so it's testable/demoable without waiting 72 real hours.
    """
    record = db.query(VerificationRecord).filter(VerificationRecord.id == verification_id).first()
    if not record:
        raise HTTPException(404, f"Verification record {verification_id} not found.")
    return finalize_if_window_expired(db, record)
