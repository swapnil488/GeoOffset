"""
Unit tests for the pure escrow adjudication logic (no DB).
"""

from decimal import Decimal

from app.models.verification import VerificationOutcome
from app.services.dispute_engine import adjudicate
from app.services.verification_engine import VerificationResult


def _result(outcome: VerificationOutcome, agreement_rate=None) -> VerificationResult:
    return VerificationResult(
        verification_outcome=outcome,
        agreement_rate=agreement_rate,
        coverage_ratio=None,
        ndvi_trend_per_year=None,
        estimated_tons_co2e=None,
        reasons=[],
        challenge_window_expires_at=None,
    )


def test_project_wins_when_recheck_confirms_original():
    verdict = adjudicate(
        original_outcome=VerificationOutcome.PROVISIONALLY_VERIFIED,
        recheck_result=_result(VerificationOutcome.PROVISIONALLY_VERIFIED, agreement_rate=0.9),
        challenger_address="0xChallenger",
        challenger_stake_amount=Decimal("500"),
        project_bond_snapshot=Decimal("500"),
        project_owner_address="0xProject",
    )
    assert verdict.winner == "project"
    assert verdict.amount_transferred == Decimal("500")
    assert verdict.paid_by == "0xChallenger"
    assert verdict.paid_to == "0xProject"


def test_challenger_wins_when_recheck_rejects():
    verdict = adjudicate(
        original_outcome=VerificationOutcome.PROVISIONALLY_VERIFIED,
        recheck_result=_result(VerificationOutcome.REJECTED, agreement_rate=0.2),
        challenger_address="0xChallenger",
        challenger_stake_amount=Decimal("500"),
        project_bond_snapshot=Decimal("500"),
        project_owner_address="0xProject",
    )
    assert verdict.winner == "challenger"
    assert verdict.amount_transferred == Decimal("500")
    assert verdict.paid_by == "0xProject"
    assert verdict.paid_to == "0xChallenger"


def test_challenger_wins_when_recheck_is_insufficient_data():
    verdict = adjudicate(
        original_outcome=VerificationOutcome.PROVISIONALLY_VERIFIED,
        recheck_result=_result(VerificationOutcome.INSUFFICIENT_DATA),
        challenger_address="0xChallenger",
        challenger_stake_amount=Decimal("500"),
        project_bond_snapshot=Decimal("500"),
        project_owner_address="0xProject",
    )
    assert verdict.winner == "challenger"


def test_transferred_amount_capped_at_smaller_of_stake_and_bond():
    verdict = adjudicate(
        original_outcome=VerificationOutcome.PROVISIONALLY_VERIFIED,
        recheck_result=_result(VerificationOutcome.REJECTED),
        challenger_address="0xChallenger",
        challenger_stake_amount=Decimal("1000"),
        project_bond_snapshot=Decimal("500"),
        project_owner_address="0xProject",
    )
    # Challenger wins the dispute but can only claim what's actually
    # posted as the project's bond, not their own (larger) stake.
    assert verdict.amount_transferred == Decimal("500")
