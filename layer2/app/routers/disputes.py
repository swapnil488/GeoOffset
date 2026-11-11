from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.dispute import Dispute
from app.models.project import Project
from app.models.verification import VerificationRecord
from app.schemas.dispute import (
    DisputeCreate,
    DisputeOut,
    DisputeResolutionOut,
    DisputeResolveRequest,
    EscrowVerdict,
)
from app.services.dispute_engine import DisputeError, open_dispute, resolve_dispute

router = APIRouter(tags=["disputes"])


@router.post(
    "/verifications/{verification_id}/disputes", response_model=DisputeOut, status_code=201
)
def create_dispute(
    verification_id: int, payload: DisputeCreate, db: Session = Depends(get_db)
):
    record = db.query(VerificationRecord).filter(VerificationRecord.id == verification_id).first()
    if not record:
        raise HTTPException(404, f"Verification record {verification_id} not found.")

    project = db.query(Project).filter(Project.project_id == record.project_id).first()
    if not project:
        raise HTTPException(404, f"Project '{record.project_id}' not found.")

    try:
        return open_dispute(
            db,
            verification_record=record,
            challenger_address=payload.challenger_address,
            challenger_stake_amount=payload.challenger_stake_amount,
            project_bond_snapshot=project.bond_deposit_amount,
        )
    except DisputeError as e:
        raise HTTPException(400, str(e))


@router.get("/verifications/{verification_id}/disputes", response_model=list[DisputeOut])
def list_disputes(verification_id: int, db: Session = Depends(get_db)):
    return (
        db.query(Dispute)
        .filter(Dispute.verification_record_id == verification_id)
        .order_by(Dispute.opened_at.desc())
        .all()
    )


@router.get("/disputes/{dispute_id}", response_model=DisputeOut)
def get_dispute(dispute_id: int, db: Session = Depends(get_db)):
    dispute = db.query(Dispute).filter(Dispute.id == dispute_id).first()
    if not dispute:
        raise HTTPException(404, f"Dispute {dispute_id} not found.")
    return dispute


@router.post("/disputes/{dispute_id}/resolve", response_model=DisputeResolutionOut)
def resolve_dispute_endpoint(
    dispute_id: int, payload: DisputeResolveRequest, db: Session = Depends(get_db)
):
    """
    Submit the second, independent satellite recheck to resolve a
    dispute. Returns the updated dispute, the recheck's own
    VerificationRecord, and the escrow verdict for Layer 3 to execute.
    """
    dispute = db.query(Dispute).filter(Dispute.id == dispute_id).first()
    if not dispute:
        raise HTTPException(404, f"Dispute {dispute_id} not found.")

    original_record = dispute.verification_record
    project = db.query(Project).filter(Project.project_id == original_record.project_id).first()
    if not project:
        raise HTTPException(404, f"Project '{original_record.project_id}' not found.")

    try:
        dispute, recheck_record, verdict = resolve_dispute(
            db,
            dispute=dispute,
            project_owner_address=project.owner_address,
            recheck_payload=payload.recheck_payload,
        )
    except DisputeError as e:
        raise HTTPException(400, str(e))

    return DisputeResolutionOut(
        dispute=dispute,
        recheck_verification=recheck_record,
        escrow_verdict=EscrowVerdict(
            winner=verdict.winner,
            amount_transferred=verdict.amount_transferred,
            paid_by=verdict.paid_by,
            paid_to=verdict.paid_to,
        ),
    )
