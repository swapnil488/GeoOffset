"""
Unit tests for the pure verification engine.

Uses the real Layer 1 output (demo-project-001_timeseries.json,
48 S2 scenes / 19 Landsat scenes / 15 matched pairs, all agreeing) as
the primary fixture, plus small synthetic payloads for the
INSUFFICIENT_DATA and REJECTED branches.
"""

import json
from copy import deepcopy
from pathlib import Path

import pytest

from app.models.verification import VerificationOutcome
from app.schemas.layer1_export import Layer1ExportPayload
from app.services.verification_engine import run_verification

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "demo-project-001_timeseries.json"


@pytest.fixture
def demo_payload() -> Layer1ExportPayload:
    with open(FIXTURE_PATH) as f:
        return Layer1ExportPayload.model_validate(json.load(f))


def test_real_layer1_output_passes_and_opens_challenge_window(demo_payload):
    result = run_verification(demo_payload)

    assert result.verification_outcome == VerificationOutcome.PROVISIONALLY_VERIFIED
    assert result.agreement_rate == pytest.approx(1.0)  # 15/15 in the fixture
    assert result.coverage_ratio == pytest.approx(15 / 48)
    assert result.ndvi_trend_per_year is not None
    assert result.estimated_tons_co2e is not None
    assert result.challenge_window_expires_at is not None


def test_insufficient_data_when_scene_counts_too_low(demo_payload):
    payload_dict = demo_payload.model_dump(mode="json")
    payload_dict["sentinel2_observations"] = payload_dict["sentinel2_observations"][:2]
    payload_dict["summary"]["s2_scene_count"] = 2
    payload = Layer1ExportPayload.model_validate(payload_dict)

    result = run_verification(payload)
    assert result.verification_outcome == VerificationOutcome.INSUFFICIENT_DATA
    assert result.challenge_window_expires_at is None
    assert result.estimated_tons_co2e is None


def test_rejected_when_agreement_rate_too_low(demo_payload):
    payload_dict = deepcopy(demo_payload.model_dump(mode="json"))
    # Flip most matched pairs to disagreement while keeping counts high
    # enough to clear the data-sufficiency gate.
    matched_flipped = 0
    for a in payload_dict["aligned_observations"]:
        if a["matched"] and matched_flipped < 13:  # leave 2/15 agreeing -> 13% agreement
            a["ndvi_agreement"] = False
            matched_flipped += 1
    payload_dict["summary"]["ndvi_agreement_pass_count"] = 2
    payload = Layer1ExportPayload.model_validate(payload_dict)

    result = run_verification(payload)
    assert result.verification_outcome == VerificationOutcome.REJECTED
    assert result.agreement_rate == pytest.approx(2 / 15)
    assert result.challenge_window_expires_at is None


def test_rejected_when_coverage_ratio_too_low(demo_payload):
    payload_dict = deepcopy(demo_payload.model_dump(mode="json"))
    # Pad with many extra unmatched S2 observations to tank coverage
    # while keeping matched_pair_count / agreement untouched.
    template = payload_dict["sentinel2_observations"][0]
    extra = []
    for i in range(200):
        obs = deepcopy(template)
        obs["date"] = f"2025-01-{(i % 28) + 1:02d}"
        extra.append(obs)
    payload_dict["sentinel2_observations"].extend(extra)
    payload_dict["summary"]["s2_scene_count"] = len(payload_dict["sentinel2_observations"])
    # matched_pair_count stays the same (15) -> coverage_ratio = 15/248 << 0.15
    payload = Layer1ExportPayload.model_validate(payload_dict)

    result = run_verification(payload)
    assert result.verification_outcome == VerificationOutcome.REJECTED
    assert result.coverage_ratio < 0.15
