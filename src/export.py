"""
Export the ingestion result to a structured file that Layer 2 can consume.
"""

import json
from datetime import datetime, timezone


def export_result(
    project_id: str,
    aoi_area_km2: float,
    s2_records: list[dict],
    landsat_records: list[dict],
    aligned_records: list[dict],
    out_path: str,
) -> None:
    payload = {
        "project_id": project_id,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "aoi_area_km2": aoi_area_km2,
        "sentinel2_observations": s2_records,
        "landsat_observations": landsat_records,
        "aligned_observations": aligned_records,
        "summary": {
            "s2_scene_count": len(s2_records),
            "landsat_scene_count": len(landsat_records),
            "matched_pair_count": sum(1 for a in aligned_records if a["matched"]),
            "ndvi_agreement_pass_count": sum(
                1 for a in aligned_records if a["matched"] and a["ndvi_agreement"]
            ),
        },
    }

    with open(out_path, "w") as f:
        json.dump(payload, f, indent=2)

    print(f"[export] Wrote result to {out_path}")
