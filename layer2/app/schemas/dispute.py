from datetime import datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

from app.models.dispute import DisputeStatus
from app.schemas.layer1_export import Layer1ExportPayload


class DisputeCreate(BaseModel):
    challenger_address: str
    challenger_stake_amount: Decimal = Field(gt=0)


class DisputeOut(BaseModel):
    id: int
    verification_record_id: int
    challenger_address: str
    challenger_stake_amount: Decimal
    project_bond_snapshot: Decimal
    opened_at: datetime
    status: DisputeStatus
    recheck_verification_record_id: Optional[int]
    resolved_at: Optional[datetime]
    resolution_notes: Optional[str]

    model_config = ConfigDict(from_attributes=True)


class DisputeResolveRequest(BaseModel):
    """
    Body for POST /disputes/{id}/resolve: the second, independent
    satellite re-check payload (same shape as the original Layer 1
    export), typically produced by re-running src/pipeline.py for the
    same AOI/date range from a separate execution context so the
    challenger and project can't influence which scenes get pulled.
    """
    recheck_payload: Layer1ExportPayload


class EscrowVerdict(BaseModel):
    """
    The economic outcome Layer 2 hands to Layer 3's escrow contract.
    Layer 2 never moves tokens itself — it only adjudicates.
    """
    winner: str  # "project" | "challenger"
    amount_transferred: Decimal
    paid_by: str
    paid_to: str


class DisputeResolutionOut(BaseModel):
    dispute: DisputeOut
    recheck_verification: "VerificationRecordOut"  # forward ref, resolved below
    escrow_verdict: EscrowVerdict


from app.schemas.verification import VerificationRecordOut  # noqa: E402

DisputeResolutionOut.model_rebuild()
