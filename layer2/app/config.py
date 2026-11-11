"""
Central config for Layer 2 (dMRV verification engine).

Same philosophy as Layer 1's config/settings.py: tolerance bands and
thresholds that affect the verification verdict live here, versioned and
reviewable, not buried inside service logic.
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # --- Database ---
    # Driver named explicitly: SQLAlchemy 2.1+ maps a bare postgresql:// URL
    # to psycopg (v3), which isn't in requirements.txt.
    database_url: str = "postgresql+psycopg2://geooffset:geooffset@localhost:5432/geooffset"
    cors_origins: str = "http://localhost:3000"

    # --- Data sufficiency thresholds ---
    # Below these, there isn't enough signal to make a verification call at
    # all (distinct from failing the call). Sentinel-2's ~5-day revisit vs
    # Landsat's ~16-day revisit means MIN_LANDSAT_SCENES is intentionally
    # lower than MIN_S2_SCENES.
    MIN_S2_SCENES: int = 5
    MIN_LANDSAT_SCENES: int = 3
    MIN_MATCHED_PAIRS: int = 3

    # --- Dual-pipeline adversarial agreement thresholds ---
    # Fraction of temporally-matched S2/Landsat pairs that must agree
    # (within Layer 1's NDVI_AGREEMENT_TOLERANCE) for the project's claim
    # to be trusted. This is the core "two independent witnesses must
    # corroborate" check before anything is eligible to mint.
    MIN_AGREEMENT_RATE: float = 0.7

    # Fraction of S2 observations that found a Landsat match at all. Low
    # coverage means the two sensors barely overlap in time, which is a
    # data-quality flag independent of whether the matches that do exist
    # agree.
    MIN_COVERAGE_RATIO: float = 0.15

    # Minimum NDVI trend (per year, unitless index units) to treat the AOI
    # as demonstrating sequestration activity rather than flat/declining
    # vegetation. Purely a sanity gate, not the sequestration estimate
    # itself.
    MIN_NDVI_TREND_PER_YEAR: float = 0.0

    # --- Carbon estimate placeholder model ---
    # MVP linear NDVI -> aboveground biomass density proxy. This is NOT a
    # calibrated allometric model — a production dMRV system would use
    # land-cover-specific, field-validated regressions (e.g. from published
    # forest inventory studies for the AOI's biome). Flagged here so the
    # assumption is explicit and swappable in one place.
    NDVI_TO_BIOMASS_SLOPE_T_HA: float = 250.0   # t/ha biomass per unit NDVI
    NDVI_TO_BIOMASS_INTERCEPT_T_HA: float = -50.0
    CARBON_FRACTION_OF_BIOMASS: float = 0.47    # IPCC default dry-biomass carbon fraction
    CO2_TO_C_MASS_RATIO: float = 44.0 / 12.0    # molecular weight ratio, C -> CO2

    # --- Escrow-backed dispute mechanism ---
    # 72-hour challenge window (see memory/build notes): after a project
    # passes verification, anyone can challenge before this elapses.
    CHALLENGE_WINDOW_HOURS: int = 72

    # Challenger must stake at least this fraction of the project's bond
    # deposit — symmetric "put up or shut down" stakes, so a challenge
    # carries real cost and can't be spammed for free.
    MIN_CHALLENGE_STAKE_RATIO: float = 1.0

    model_config = SettingsConfigDict(env_file=".env")


settings = Settings()
