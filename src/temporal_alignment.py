"""
Temporal alignment between the Sentinel-2 and Landsat time series.

For each Sentinel-2 observation, find the nearest Landsat observation
within TEMPORAL_MATCH_WINDOW_DAYS. Unmatched observations are kept in the
output (useful for coverage analysis) but only matched pairs get an
agreement evaluation — that pair is what Layer 2's dual-pipeline check
actually consumes.
"""

from datetime import datetime
from config.settings import (
    TEMPORAL_MATCH_WINDOW_DAYS,
    NDVI_AGREEMENT_TOLERANCE,
    EVI_AGREEMENT_TOLERANCE,
)


def _days_between(d1: str, d2: str) -> int:
    return abs((datetime.fromisoformat(d1) - datetime.fromisoformat(d2)).days)


def _relative_diff(a: float, b: float) -> float:
    denom = max(abs(a), abs(b), 1e-6)
    return abs(a - b) / denom


def align_timeseries(s2_records: list[dict], landsat_records: list[dict]) -> list[dict]:
    """
    Returns a list of aligned observation records:
    {
        "s2_date", "landsat_date", "days_apart",
        "s2_ndvi", "landsat_ndvi", "ndvi_agreement",
        "s2_evi", "landsat_evi", "evi_agreement",
        "matched": bool
    }
    """
    aligned = []
    used_landsat_dates = set()

    for s2 in s2_records:
        candidates = [
            l for l in landsat_records
            if _days_between(s2["date"], l["date"]) <= TEMPORAL_MATCH_WINDOW_DAYS
            and l["date"] not in used_landsat_dates
        ]

        if not candidates:
            aligned.append({
                "s2_date": s2["date"], "landsat_date": None, "days_apart": None,
                "s2_ndvi": s2["ndvi"], "landsat_ndvi": None, "ndvi_agreement": None,
                "s2_evi": s2["evi"], "landsat_evi": None, "evi_agreement": None,
                "matched": False,
            })
            continue

        best = min(candidates, key=lambda l: _days_between(s2["date"], l["date"]))
        used_landsat_dates.add(best["date"])

        ndvi_diff = _relative_diff(s2["ndvi"], best["ndvi"])
        evi_diff = _relative_diff(s2["evi"], best["evi"])

        aligned.append({
            "s2_date": s2["date"],
            "landsat_date": best["date"],
            "days_apart": _days_between(s2["date"], best["date"]),
            "s2_ndvi": s2["ndvi"],
            "landsat_ndvi": best["ndvi"],
            "ndvi_agreement": ndvi_diff <= NDVI_AGREEMENT_TOLERANCE,
            "s2_evi": s2["evi"],
            "landsat_evi": best["evi"],
            "evi_agreement": evi_diff <= EVI_AGREEMENT_TOLERANCE,
            "matched": True,
        })

    matched_count = sum(1 for a in aligned if a["matched"])
    agree_count = sum(1 for a in aligned if a["matched"] and a["ndvi_agreement"])
    print(
        f"[temporal_alignment] {matched_count}/{len(s2_records)} S2 dates matched to "
        f"a Landsat observation within {TEMPORAL_MATCH_WINDOW_DAYS} days; "
        f"{agree_count}/{matched_count or 1} matched pairs agree on NDVI within tolerance."
    )
    return aligned
