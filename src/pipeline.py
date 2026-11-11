"""
End-to-end Layer 1 orchestration: AOI -> S2 + Landsat extraction ->
temporal alignment -> export.

Usage:
    python -m src.pipeline --aoi data/sample_aoi.geojson \
        --start 2022-01-01 --end 2024-12-31 \
        --project-id demo-project-001 \
        --out data/demo-project-001_timeseries.json
"""

import argparse

from src.gee_auth import initialize_earth_engine
from src.aoi import load_aoi
from src.sentinel2_pipeline import get_sentinel2_timeseries
from src.landsat_pipeline import get_landsat_timeseries
from src.temporal_alignment import align_timeseries
from src.export import export_result


def run(aoi_path: str, start: str, end: str, project_id: str, out_path: str) -> None:
    initialize_earth_engine()

    aoi = load_aoi(aoi_path)
    aoi_area_km2 = aoi.area().divide(1_000_000).getInfo()

    s2_records = get_sentinel2_timeseries(aoi, start, end)
    landsat_records = get_landsat_timeseries(aoi, start, end)
    aligned = align_timeseries(s2_records, landsat_records)

    export_result(
        project_id=project_id,
        aoi_area_km2=aoi_area_km2,
        s2_records=s2_records,
        landsat_records=landsat_records,
        aligned_records=aligned,
        out_path=out_path,
    )


def main():
    parser = argparse.ArgumentParser(description="GeoOffset Layer 1 ingestion pipeline")
    parser.add_argument("--aoi", required=True, help="Path to AOI GeoJSON file")
    parser.add_argument("--start", required=True, help="Start date YYYY-MM-DD")
    parser.add_argument("--end", required=True, help="End date YYYY-MM-DD")
    parser.add_argument("--project-id", required=True, help="Project identifier")
    parser.add_argument("--out", required=True, help="Output JSON path")
    args = parser.parse_args()

    run(args.aoi, args.start, args.end, args.project_id, args.out)


if __name__ == "__main__":
    main()
