"""
Dispute: one row per challenge opened against a PROVISIONALLY_VERIFIED
verification record during its 72-hour challenge window.

Escrow mechanics (see memory/build notes): the challenger's stake is
weighed against the project's bond deposit. A second, independent
satellite recheck resolves the dispute — the losing side's deposit pays
the winner. Layer 2 computes the adjudication verdict and the amounts
owed; actual custody/transfer of tokens happens on-chain in Layer 3's
escrow contract, executed against this verdict.
"""

import enum
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, Enum, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import relationship

from app.database import Base


class DisputeStatus(str, enum.Enum):
    OPEN = "OPEN"
    RESOLVED_PROJECT_WON = "RESOLVED_PROJECT_WON"
    RESOLVED_CHALLENGER_WON = "RESOLVED_CHALLENGER_WON"


class Dispute(Base):
    __tablename__ = "disputes"

    id = Column(Integer, primary_key=True, index=True)

    # The verification record being challenged.
    verification_record_id = Column(
        Integer, ForeignKey("verification_records.id"), nullable=False, index=True
    )

    challenger_address = Column(String, nullable=False)
    challenger_stake_amount = Column(Numeric(20, 6), nullable=False)

    # Snapshot of the project's bond at the moment the dispute opened,
    # so a later bond top-up/withdrawal can't retroactively change what
    # was at stake in an in-flight dispute.
    project_bond_snapshot = Column(Numeric(20, 6), nullable=False)

    opened_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    status = Column(Enum(DisputeStatus), nullable=False, default=DisputeStatus.OPEN)

    # The independent recheck VerificationRecord (is_recheck=True) that
    # resolved this dispute, once resolved.
    recheck_verification_record_id = Column(
        Integer, ForeignKey("verification_records.id"), nullable=True
    )
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    resolution_notes = Column(Text, nullable=True)

    verification_record = relationship(
        "VerificationRecord", foreign_keys=[verification_record_id]
    )
    recheck_verification_record = relationship(
        "VerificationRecord", foreign_keys=[recheck_verification_record_id]
    )
