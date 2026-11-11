"""
Core dual-pipeline adversarial verification logic.

This is the trust mechanism at the heart of GeoOffset: Sentinel-2 and
Landsat are two independent satellite sources. A carbon claim only
becomes eligible to mint if the two sources corroborate each other on
the temporally-matched observations Layer 1 already computed. Neither
sensor is treated as ground truth over the other — agreement between
them is the signal.

Deliberately pure / side-effect-free: takes a validated Layer 1 export
payload in, returns a plain result object out. No DB session, no I/O.
This is what makes it directly unit-testable against the real
demo-project-001_timeseries.json fixture, and it's exactly the function
re-run (on a fresh, independent payload) to resolve a dispute in
dispute_engine.py.
"""

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from app.config import settings
from app.models.verification import VerificationOutcome
from app.schemas.layer1_export import Layer1ExportPayload


@dataclass
class VerificationResult:
    verification_outcome: VerificationOutcome
    agreement_rate: Optional[float]
    coverage_ratio: Optional[float]
    ndvi_trend_per_year: Optional[float]
    estimated_tons_co2e: Optional[float]
    reasons: list[str]
    challenge_window_expires_at: Optional[datetime]


def _ndvi_trend_per_year(payload: Layer1ExportPayload) -> Optional[float]:
    """
    Simple linear regression of mean(S2, Landsat) NDVI over time, on
    matched pairs only (each sensor alone is noisier / more scene-count
    dependent). Returns slope in NDVI-units per year, or None if there
    are fewer than 2 matched pairs to regress on.
    """
    matched = [a for a in payload.aligned_observations if a.matched and a.landsat_ndvi is not None]
    if len(matched) < 2:
        return None

    epoch = date(2000, 1, 1)
    xs = [(a.s2_date - epoch).days / 365.25 for a in matched]
    ys = [(a.s2_ndvi + a.landsat_ndvi) / 2 for a in matched]

    n = len(xs)
    mean_x = sum(xs) / n
    mean_y = sum(ys) / n
    denom = sum((x - mean_x) ** 2 for x in xs)
    if denom == 0:
        return 0.0
    slope = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys)) / denom
    return slope


def _estimate_tons_co2e(ndvi_trend_per_year: Optional[float], aoi_area_km2: float) -> Optional[float]:
    """
    MVP placeholder sequestration estimate. Converts the NDVI trend into
    a biomass-density-per-year change via a linear proxy (see config.py
    docstring — NOT a calibrated allometric model), then to carbon, then
    to CO2e, scaled by AOI area.

    estimated_tons_co2e is therefore an *annual sequestration rate*
    estimate, not a cumulative stock. Returns None if there's no trend
    to work from (INSUFFICIENT_DATA case).
    """
    if ndvi_trend_per_year is None:
        return None

    area_ha = aoi_area_km2 * 100  # 1 km^2 = 100 ha
    biomass_density_change_t_ha_per_yr = ndvi_trend_per_year * settings.NDVI_TO_BIOMASS_SLOPE_T_HA
    total_biomass_change_t_per_yr = biomass_density_change_t_ha_per_yr * area_ha
    carbon_change_t_per_yr = total_biomass_change_t_per_yr * settings.CARBON_FRACTION_OF_BIOMASS
    co2e_change_t_per_yr = carbon_change_t_per_yr * settings.CO2_TO_C_MASS_RATIO
    return co2e_change_t_per_yr


def run_verification(payload: Layer1ExportPayload) -> VerificationResult:
    reasons: list[str] = []
    summary = payload.summary

    # --- 1. Data sufficiency gate ---
    if (
        summary.s2_scene_count < settings.MIN_S2_SCENES
        or summary.landsat_scene_count < settings.MIN_LANDSAT_SCENES
        or summary.matched_pair_count < settings.MIN_MATCHED_PAIRS
    ):
        reasons.append(
            f"Insufficient data: S2={summary.s2_scene_count} "
            f"(min {settings.MIN_S2_SCENES}), Landsat={summary.landsat_scene_count} "
            f"(min {settings.MIN_LANDSAT_SCENES}), matched_pairs={summary.matched_pair_count} "
            f"(min {settings.MIN_MATCHED_PAIRS})."
        )
        return VerificationResult(
            verification_outcome=VerificationOutcome.INSUFFICIENT_DATA,
            agreement_rate=None,
            coverage_ratio=None,
            ndvi_trend_per_year=None,
            estimated_tons_co2e=None,
            reasons=reasons,
            challenge_window_expires_at=None,
        )

    # --- 2. Dual-pipeline adversarial agreement check ---
    agreement_rate = summary.ndvi_agreement_pass_count / summary.matched_pair_count
    coverage_ratio = summary.matched_pair_count / summary.s2_scene_count
    ndvi_trend = _ndvi_trend_per_year(payload)

    if agreement_rate < settings.MIN_AGREEMENT_RATE:
        reasons.append(
            f"Sentinel-2/Landsat agreement rate {agreement_rate:.2%} is below the "
            f"{settings.MIN_AGREEMENT_RATE:.0%} threshold — the two independent sensors "
            "don't sufficiently corroborate each other's NDVI signal."
        )
        return VerificationResult(
            verification_outcome=VerificationOutcome.REJECTED,
            agreement_rate=agreement_rate,
            coverage_ratio=coverage_ratio,
            ndvi_trend_per_year=ndvi_trend,
            estimated_tons_co2e=None,
            reasons=reasons,
            challenge_window_expires_at=None,
        )

    if coverage_ratio < settings.MIN_COVERAGE_RATIO:
        reasons.append(
            f"Temporal coverage ratio {coverage_ratio:.2%} is below the "
            f"{settings.MIN_COVERAGE_RATIO:.0%} threshold — too few S2 observations "
            "found a Landsat counterpart to trust the overlap."
        )
        return VerificationResult(
            verification_outcome=VerificationOutcome.REJECTED,
            agreement_rate=agreement_rate,
            coverage_ratio=coverage_ratio,
            ndvi_trend_per_year=ndvi_trend,
            estimated_tons_co2e=None,
            reasons=reasons,
            challenge_window_expires_at=None,
        )

    # --- 3. Passed the adversarial check: provisionally verified ---
    reasons.append(
        f"Passed dual-pipeline agreement check: {agreement_rate:.2%} agreement rate "
        f"over {summary.matched_pair_count} matched pairs, {coverage_ratio:.2%} coverage."
    )
    estimated_tons_co2e = _estimate_tons_co2e(ndvi_trend, payload.aoi_area_km2)
    expires_at = datetime.now(timezone.utc) + timedelta(hours=settings.CHALLENGE_WINDOW_HOURS)

    return VerificationResult(
        verification_outcome=VerificationOutcome.PROVISIONALLY_VERIFIED,
        agreement_rate=agreement_rate,
        coverage_ratio=coverage_ratio,
        ndvi_trend_per_year=ndvi_trend,
        estimated_tons_co2e=estimated_tons_co2e,
        reasons=reasons,
        challenge_window_expires_at=expires_at,
    )
