"""
GeoOffset — full pipeline glue: Layer 1 (GEE ingestion) -> Layer 2 (dMRV
verification API).

Deliberately kept as a thin, decoupled script rather than a shared
import/process: Layer 1 needs the earthengine-api/geemap/geopandas stack
and its own GEE credentials; Layer 2 needs FastAPI/SQLAlchemy/PostGIS.
Running them as two processes connected over HTTP (not a shared Python
process or shared venv) matches the eventual reality where Layer 1 runs
as a scheduled ingestion job and Layer 2 runs as a persistent API
service, possibly on different machines.

This script only depends on the Python standard library (urllib, json)
for the HTTP leg, so it runs fine from Layer 1's own venv without
installing any Layer 2 dependencies.

Usage — full run (calls GEE, then posts to a running Layer 2 API):

    python scripts/run_full_pipeline.py \
        --aoi data/sample_aoi.geojson \
        --start 2022-01-01 --end 2024-12-31 \
        --project-id demo-project-001 \
        --out data/demo-project-001_timeseries.json \
        --layer2-url http://localhost:8000 \
        --register-project \
        --project-name "Demo Reforestation Project" \
        --bond-deposit 1000.00 \
        --owner-address 0xProjectOwner

Usage — reuse an already-generated Layer 1 export (skip re-hitting GEE),
e.g. to retry posting after Layer 2 was down:

    python scripts/run_full_pipeline.py \
        --skip-run \
        --out data/demo-project-001_timeseries.json \
        --project-id demo-project-001 \
        --layer2-url http://localhost:8000

Prerequisites:
    - Layer 2's FastAPI server must already be running
      (uvicorn app.main:app, from within layer2/).
    - If --register-project is not passed, the project must already
      exist in Layer 2 (POST /projects run separately beforehand).
"""

import argparse
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

# Make `src` and `config` (Layer 1) importable regardless of the caller's
# working directory, since this script lives in scripts/ not repo root.
REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))


def run_layer1(aoi_path: str, start: str, end: str, project_id: str, out_path: str) -> None:
    """Runs Layer 1 exactly as `python -m src.pipeline` would, writing out_path."""
    from src.pipeline import run as layer1_run

    layer1_run(aoi_path=aoi_path, start=start, end=end, project_id=project_id, out_path=out_path)


def _http_post(url: str, payload: dict) -> tuple[int, dict]:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url, data=data, headers={"Content-Type": "application/json"}, method="POST"
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8")
        try:
            return e.code, json.loads(body)
        except json.JSONDecodeError:
            return e.code, {"detail": body}
    except urllib.error.URLError as e:
        print(
            f"[run_full_pipeline] Could not reach Layer 2 at {url}: {e.reason}\n"
            "Is the FastAPI server running? (uvicorn app.main:app, from within layer2/)",
            file=sys.stderr,
        )
        sys.exit(1)


def register_project_if_requested(
    args: argparse.Namespace, aoi_path: str, aoi_area_km2: float
) -> None:
    if not args.register_project:
        return

    missing = [
        name
        for name, val in [
            ("--project-name", args.project_name),
            ("--bond-deposit", args.bond_deposit),
            ("--owner-address", args.owner_address),
        ]
        if val is None
    ]
    if missing:
        print(
            f"[run_full_pipeline] --register-project requires {', '.join(missing)}.",
            file=sys.stderr,
        )
        sys.exit(1)

    with open(aoi_path) as f:
        gj = json.load(f)
    if gj.get("type") == "FeatureCollection":
        aoi_geojson = gj["features"][0]["geometry"]
    elif gj.get("type") == "Feature":
        aoi_geojson = gj["geometry"]
    else:
        aoi_geojson = gj

    status, body = _http_post(
        f"{args.layer2_url}/projects",
        {
            "project_id": args.project_id,
            "name": args.project_name,
            "aoi_geojson": aoi_geojson,
            "aoi_area_km2": aoi_area_km2,
            "bond_deposit_amount": str(args.bond_deposit),
            "owner_address": args.owner_address,
        },
    )
    if status == 201:
        print(f"[run_full_pipeline] Registered project '{args.project_id}' in Layer 2.")
    elif status == 409:
        print(f"[run_full_pipeline] Project '{args.project_id}' already exists in Layer 2, continuing.")
    else:
        print(f"[run_full_pipeline] Failed to register project (HTTP {status}): {body}", file=sys.stderr)
        sys.exit(1)


def submit_verification(args: argparse.Namespace, payload: dict) -> dict:
    url = f"{args.layer2_url}/projects/{args.project_id}/verifications"
    status, body = _http_post(url, payload)
    if status != 201:
        print(f"[run_full_pipeline] Verification submission failed (HTTP {status}): {body}", file=sys.stderr)
        sys.exit(1)
    return body


def print_result(record: dict) -> None:
    print("\n=== Layer 2 verification result ===")
    print(f"  verification_id            : {record['id']}")
    print(f"  verification_outcome       : {record['verification_outcome']}")
    print(f"  finalization_status        : {record['finalization_status']}")
    print(f"  agreement_rate             : {record['agreement_rate']}")
    print(f"  coverage_ratio             : {record['coverage_ratio']}")
    print(f"  ndvi_trend_per_year        : {record['ndvi_trend_per_year']}")
    print(f"  estimated_tons_co2e/yr     : {record['estimated_tons_co2e']}")
    print(f"  challenge_window_expires_at: {record['challenge_window_expires_at']}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Run Layer 1 ingestion, then submit the result to Layer 2 for verification."
    )
    parser.add_argument("--aoi", required=True, help="Path to AOI GeoJSON file")
    parser.add_argument("--start", help="Start date YYYY-MM-DD (required unless --skip-run)")
    parser.add_argument("--end", help="End date YYYY-MM-DD (required unless --skip-run)")
    parser.add_argument("--project-id", required=True, help="Project identifier")
    parser.add_argument("--out", required=True, help="Layer 1 output JSON path")
    parser.add_argument("--layer2-url", default="http://localhost:8000", help="Layer 2 base URL")
    parser.add_argument(
        "--skip-run",
        action="store_true",
        help="Skip calling Layer 1 / GEE; reuse the JSON already at --out.",
    )

    parser.add_argument("--register-project", action="store_true", help="Also register the project in Layer 2 first")
    parser.add_argument("--project-name", help="Required if --register-project")
    parser.add_argument("--bond-deposit", type=float, help="Required if --register-project")
    parser.add_argument("--owner-address", help="Required if --register-project")

    args = parser.parse_args()

    if not args.skip_run and (not args.start or not args.end):
        parser.error("--start and --end are required unless --skip-run is set")

    if args.skip_run:
        if not Path(args.out).exists():
            parser.error(f"--skip-run was set but {args.out} does not exist")
        print(f"[run_full_pipeline] --skip-run set; reusing existing {args.out}")
    else:
        print(f"[run_full_pipeline] Running Layer 1 ingestion for '{args.project_id}'...")
        run_layer1(args.aoi, args.start, args.end, args.project_id, args.out)

    with open(args.out) as f:
        payload = json.load(f)

    register_project_if_requested(args, args.aoi, payload["aoi_area_km2"])

    print(f"[run_full_pipeline] Submitting to Layer 2 at {args.layer2_url}...")
    record = submit_verification(args, payload)
    print_result(record)


if __name__ == "__main__":
    main()
