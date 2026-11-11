"""
Central config for Layer 1 ingestion.

Keep tolerance bands and thresholds here, not buried in pipeline code —
these are exactly the numbers you'll want to tune once you see real data,
and they should be versioned alongside your methodology doc since they
directly affect the dual-pipeline agreement check in Layer 2.
"""

# --- Cloud / scene QA ---
MAX_CLOUD_COVER_PCT = 20          # reject scenes above this cloud % over the AOI
MIN_VALID_PIXEL_FRACTION = 0.6    # reject scenes where <60% of AOI pixels are unmasked

# --- Temporal alignment ---
# Max number of days apart a Sentinel-2 and Landsat observation can be
# and still be considered "the same" measurement window for comparison.
TEMPORAL_MATCH_WINDOW_DAYS = 5

# --- Dual-pipeline agreement tolerance ---
# Fractional difference allowed between S2 and Landsat NDVI for a matched
# pair to be considered "agreeing". e.g. 0.15 = 15% relative difference.
# This is the MVP version of the tolerance band mentioned in the build plan —
# expect to recalibrate against ground-truth/validation plots.
NDVI_AGREEMENT_TOLERANCE = 0.15
EVI_AGREEMENT_TOLERANCE = 0.15

# --- Spectral index band maps ---
# Sentinel-2 surface reflectance (COPERNICUS/S2_SR_HARMONIZED)
S2_BANDS = {"NIR": "B8", "RED": "B4", "BLUE": "B2"}
S2_SCALE_M = 10

# Landsat 8/9 Collection 2 Level 2 surface reflectance
LANDSAT_BANDS = {"NIR": "SR_B5", "RED": "SR_B4", "BLUE": "SR_B2"}
LANDSAT_SCALE_M = 30

# EVI coefficients (standard MODIS-style formula)
EVI_G = 2.5
EVI_C1 = 6.0
EVI_C2 = 7.5
EVI_L = 1.0
