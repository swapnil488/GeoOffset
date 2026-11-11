"""
End-to-end integration test against a real PostgreSQL + PostGIS
database (not mocked): create a project, submit a verification from
the real Layer 1 fixture, open a dispute, and resolve it with a
synthetic contradicting recheck.

Requires DATABASE_URL to point at a real Postgres+PostGIS instance with
db/init_db.sql already applied. Not part of the default unit test run —
invoke explicitly:

    DATABASE_URL=postgresql://geooffset:geooffset@localhost:5432/geooffset \
        pytest tests/test_integration_e2e.py -v -s
"""

import json
from copy import deepcopy
from decimal import Decimal
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.database import SessionLocal
from app.main import app

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "demo-project-001_timeseries.json"

client = TestClient(app)


@pytest.fixture(autouse=True)
def clean_db():
    """Truncate all tables before each test so this suite is repeatable."""
    db = SessionLocal()
    try:
        db.execute(text(
            "TRUNCATE disputes, aligned_observations, verification_records, projects "
            "RESTART IDENTITY CASCADE"
        ))
        db.commit()
    finally:
        db.close()
    yield


@pytest.fixture
def demo_export() -> dict:
    with open(FIXTURE_PATH) as f:
        return json.load(f)


def test_full_lifecycle_verify_dispute_resolve(demo_export):
    project_id = "e2e-test-project-001"

    # --- 1. Register the project (Ashoka Chakra as a stand-in AOI square) ---
    create_resp = client.post(
        "/projects",
        json={
            "project_id": project_id,
            "name": "E2E Test Reforestation Project",
            "aoi_geojson": {
                "type": "Polygon",
                "coordinates": [[[77.0, 12.0], [77.1, 12.0], [77.1, 12.1], [77.0, 12.1], [77.0, 12.0]]],
            },
            "aoi_area_km2": demo_export["aoi_area_km2"],
            "bond_deposit_amount": "1000.00",
            "owner_address": "0xProjectOwner",
        },
    )
    assert create_resp.status_code == 201, create_resp.text
    project = create_resp.json()
    assert project["project_id"] == project_id

    # --- 2. Submit the real Layer 1 export -> should PROVISIONALLY_VERIFY ---
    demo_export_for_project = deepcopy(demo_export)
    demo_export_for_project["project_id"] = project_id

    verify_resp = client.post(
        f"/projects/{project_id}/verifications", json=demo_export_for_project
    )
    assert verify_resp.status_code == 201, verify_resp.text
    record = verify_resp.json()
    assert record["verification_outcome"] == "PROVISIONALLY_VERIFIED"
    assert record["finalization_status"] == "OPEN_FOR_CHALLENGE"
    assert record["agreement_rate"] == pytest.approx(1.0)
    verification_id = record["id"]

    # --- 3. Fetch the detail view (normalized aligned observations) ---
    detail_resp = client.get(f"/verifications/{verification_id}")
    assert detail_resp.status_code == 200
    detail = detail_resp.json()
    assert len(detail["aligned_observations"]) == 48

    # --- 4. Open a dispute with a matching stake ---
    dispute_resp = client.post(
        f"/verifications/{verification_id}/disputes",
        json={"challenger_address": "0xChallenger", "challenger_stake_amount": "1000.00"},
    )
    assert dispute_resp.status_code == 201, dispute_resp.text
    dispute = dispute_resp.json()
    assert dispute["status"] == "OPEN"
    dispute_id = dispute["id"]

    # Record should now be locked under dispute, not challengeable again.
    second_dispute_resp = client.post(
        f"/verifications/{verification_id}/disputes",
        json={"challenger_address": "0xAnotherChallenger", "challenger_stake_amount": "1000.00"},
    )
    assert second_dispute_resp.status_code == 400

    # --- 5. Resolve with a contradicting recheck (independent re-measurement disagrees) ---
    contradicting_recheck = deepcopy(demo_export_for_project)
    for a in contradicting_recheck["aligned_observations"]:
        if a["matched"]:
            a["ndvi_agreement"] = False
    contradicting_recheck["summary"]["ndvi_agreement_pass_count"] = 0

    resolve_resp = client.post(
        f"/disputes/{dispute_id}/resolve", json={"recheck_payload": contradicting_recheck}
    )
    assert resolve_resp.status_code == 200, resolve_resp.text
    resolution = resolve_resp.json()

    assert resolution["dispute"]["status"] == "RESOLVED_CHALLENGER_WON"
    assert resolution["recheck_verification"]["verification_outcome"] == "REJECTED"
    assert resolution["escrow_verdict"]["winner"] == "challenger"
    assert Decimal(resolution["escrow_verdict"]["amount_transferred"]) == Decimal("1000.00")
    assert resolution["escrow_verdict"]["paid_by"] == "0xProjectOwner"
    assert resolution["escrow_verdict"]["paid_to"] == "0xChallenger"

    # Original record should now be finalized as rejected, not mintable.
    final_record_resp = client.get(f"/verifications/{verification_id}")
    assert final_record_resp.json()["finalization_status"] == "FINALIZED_REJECTED"
