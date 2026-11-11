"""
Escrow-backed dispute mechanism.

Courtroom analogy (from design discussion): a PROVISIONALLY_VERIFIED
project sits in a 72-hour "open for challenge" window. A challenger who
thinks the claim is wrong can post a stake matching the project's bond.
That triggers a second, independent satellite re-check. Whichever side
the recheck vindicates wins the other side's deposit — no new value is
created, money just moves from the loser's pre-committed escrow to the
winner's. Layer 2 computes this verdict; Layer 3's smart contract is
what actually moves tokens, using this verdict as its input.

`adjudicate` is pure (no DB) so the win/lose logic is unit-testable in
isolation. `open_dispute` / `resolve_dispute` are the DB-touching
workflow functions used by the API routers.
"""

from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy.orm import Session

from app.config import settings
from app.models.dispute import Dispute, DisputeStatus
from app.models.verification import FinalizationStatus, VerificationOutcome, VerificationRecord
from app.schemas.layer1_export import Layer1ExportPayload
from app.services.verification_engine import VerificationResult, run_verification


class DisputeError(ValueError):
    """Raised for invalid dispute operations (bad stake, wrong window state, etc.)."""


@dataclass
class AdjudicationVerdict:
    winner: str  # "project" | "challenger"
    amount_transferred: Decimal
    paid_by: str  # address or role paying out
    paid_to: str
    notes: str


def adjudicate(
    original_outcome: VerificationOutcome,
    recheck_result: VerificationResult,
    challenger_address: str,
    challenger_stake_amount: Decimal,
    project_bond_snapshot: Decimal,
    project_owner_address: str,
) -> AdjudicationVerdict:
    """
    Pure adjudication: did the independent recheck confirm or contradict
    the original PROVISIONALLY_VERIFIED claim?

    - Recheck also PROVISIONALLY_VERIFIED -> the original claim is
      corroborated a second time -> project wins, challenger's stake is
      forfeited to the project.
    - Recheck REJECTED or INSUFFICIENT_DATA -> the original claim does
      not hold up under independent re-measurement -> challenger wins,
      the project's bond (or the disputed portion of it) is forfeited to
      the challenger.
    """
    if recheck_result.verification_outcome == VerificationOutcome.PROVISIONALLY_VERIFIED:
        return AdjudicationVerdict(
            winner="project",
            amount_transferred=challenger_stake_amount,
            paid_by=challenger_address,
            paid_to=project_owner_address,
            notes=(
                "Independent recheck also passed the dual-pipeline agreement check "
                f"(agreement_rate={recheck_result.agreement_rate:.2%} if available). "
                "Challenge unsubstantiated; challenger's stake is forfeited to the project."
            ),
        )

    transferred = min(challenger_stake_amount, project_bond_snapshot)
    return AdjudicationVerdict(
        winner="challenger",
        amount_transferred=transferred,
        paid_by=project_owner_address,
        paid_to=challenger_address,
        notes=(
            f"Independent recheck came back {recheck_result.verification_outcome.value}, "
            "contradicting the original provisional verification. Challenge upheld; "
            "project bond is forfeited to the challenger."
        ),
    )


def open_dispute(
    db: Session,
    verification_record: VerificationRecord,
    challenger_address: str,
    challenger_stake_amount: Decimal,
    project_bond_snapshot: Decimal,
) -> Dispute:
    if verification_record.finalization_status != FinalizationStatus.OPEN_FOR_CHALLENGE:
        raise DisputeError(
            f"Verification record {verification_record.id} is not open for challenge "
            f"(status={verification_record.finalization_status.value})."
        )

    now = datetime.now(timezone.utc)
    expires_at = verification_record.challenge_window_expires_at
    if expires_at is not None and now > expires_at:
        raise DisputeError(
            f"The 72-hour challenge window for record {verification_record.id} "
            f"expired at {expires_at.isoformat()}."
        )

    min_stake = project_bond_snapshot * Decimal(str(settings.MIN_CHALLENGE_STAKE_RATIO))
    if challenger_stake_amount < min_stake:
        raise DisputeError(
            f"Challenger stake {challenger_stake_amount} is below the required "
            f"minimum of {min_stake} ({settings.MIN_CHALLENGE_STAKE_RATIO:.0%} of the "
            "project's bond deposit)."
        )

    dispute = Dispute(
        verification_record_id=verification_record.id,
        challenger_address=challenger_address,
        challenger_stake_amount=challenger_stake_amount,
        project_bond_snapshot=project_bond_snapshot,
        status=DisputeStatus.OPEN,
    )
    verification_record.finalization_status = FinalizationStatus.UNDER_DISPUTE

    db.add(dispute)
    db.add(verification_record)
    db.commit()
    db.refresh(dispute)
    return dispute


def resolve_dispute(
    db: Session,
    dispute: Dispute,
    project_owner_address: str,
    recheck_payload: Layer1ExportPayload,
) -> tuple[Dispute, VerificationRecord, AdjudicationVerdict]:
    if dispute.status != DisputeStatus.OPEN:
        raise DisputeError(f"Dispute {dispute.id} is already resolved ({dispute.status.value}).")

    from app.services.ingestion import ingest_layer1_export  # local import avoids a cycle

    original_record: VerificationRecord = dispute.verification_record
    recheck_record = ingest_layer1_export(
        db, project_id=original_record.project_id, payload=recheck_payload, is_recheck=True
    )
    recheck_result = run_verification(recheck_payload)

    verdict = adjudicate(
        original_outcome=original_record.verification_outcome,
        recheck_result=recheck_result,
        challenger_address=dispute.challenger_address,
        challenger_stake_amount=dispute.challenger_stake_amount,
        project_bond_snapshot=dispute.project_bond_snapshot,
        project_owner_address=project_owner_address,
    )

    dispute.status = (
        DisputeStatus.RESOLVED_PROJECT_WON
        if verdict.winner == "project"
        else DisputeStatus.RESOLVED_CHALLENGER_WON
    )
    dispute.recheck_verification_record_id = recheck_record.id
    dispute.resolved_at = datetime.now(timezone.utc)
    dispute.resolution_notes = verdict.notes

    original_record.finalization_status = (
        FinalizationStatus.FINALIZED_MINTABLE
        if verdict.winner == "project"
        else FinalizationStatus.FINALIZED_REJECTED
    )

    db.add(dispute)
    db.add(original_record)
    db.commit()
    db.refresh(dispute)
    db.refresh(original_record)
    return dispute, recheck_record, verdict


def finalize_if_window_expired(db: Session, record: VerificationRecord) -> VerificationRecord:
    """
    Called (e.g. by a scheduled job, or manually via the API for demo
    purposes) once the 72-hour challenge window has passed with no
    dispute opened: the claim becomes final and mintable.
    """
    if record.finalization_status != FinalizationStatus.OPEN_FOR_CHALLENGE:
        return record
    if record.challenge_window_expires_at is None:
        return record
    if datetime.now(timezone.utc) >= record.challenge_window_expires_at:
        record.finalization_status = FinalizationStatus.FINALIZED_MINTABLE
        db.add(record)
        db.commit()
        db.refresh(record)
    return record
