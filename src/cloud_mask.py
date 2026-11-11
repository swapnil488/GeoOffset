"""
Per-sensor cloud/shadow masking and scene-level QA.

Both masking functions return the image with a cloud/shadow mask applied
AND a `valid_fraction` property recording how much of the AOI survived
masking — this lets the pipeline reject scenes with too little usable
data instead of silently averaging in noise.
"""

import ee
from config.settings import MAX_CLOUD_COVER_PCT, MIN_VALID_PIXEL_FRACTION


def mask_sentinel2(image: ee.Image, aoi: ee.Geometry) -> ee.Image:
    """Cloud/cirrus/shadow mask using the Sentinel-2 SCL band."""
    scl = image.select("SCL")
    # SCL classes to exclude: 3=shadow, 8=cloud medium, 9=cloud high,
    # 10=cirrus, 11=snow (drop if not relevant to your biomes)
    bad = scl.eq(3).Or(scl.eq(8)).Or(scl.eq(9)).Or(scl.eq(10))
    masked = image.updateMask(bad.Not())

    valid_fraction = _compute_valid_fraction(masked.select("B8"), aoi, scale=10)
    return masked.set("valid_fraction", valid_fraction)


def mask_landsat(image: ee.Image, aoi: ee.Geometry) -> ee.Image:
    """Cloud/shadow mask using the Landsat C2L2 QA_PIXEL band."""
    qa = image.select("QA_PIXEL")
    # Bits: 3 = cloud, 4 = cloud shadow (Collection 2 QA_PIXEL spec)
    cloud_bit = 1 << 3
    shadow_bit = 1 << 4
    mask = qa.bitwiseAnd(cloud_bit).eq(0).And(qa.bitwiseAnd(shadow_bit).eq(0))
    masked = image.updateMask(mask)

    valid_fraction = _compute_valid_fraction(masked.select("SR_B5"), aoi, scale=30)
    return masked.set("valid_fraction", valid_fraction)


def _compute_valid_fraction(band: ee.Image, aoi: ee.Geometry, scale: int) -> ee.Number:
    total = ee.Image(1).reduceRegion(
        reducer=ee.Reducer.count(), geometry=aoi, scale=scale, maxPixels=1e9
    ).values().get(0)
    valid = band.mask().reduceRegion(
        reducer=ee.Reducer.sum(), geometry=aoi, scale=scale, maxPixels=1e9
    ).values().get(0)
    return ee.Number(valid).divide(ee.Number(total))


def scene_passes_qa(image: ee.Image, cloud_property: str) -> bool:
    """
    Evaluate (client-side) whether a scene should be kept.
    Called after mask_* has set 'valid_fraction'; cloud_property is the
    native per-scene cloud % property name (differs by collection).
    """
    props = image.toDictionary([cloud_property, "valid_fraction"]).getInfo()
    cloud_pct = props.get(cloud_property, 100)
    valid_fraction = props.get("valid_fraction", 0)

    return (
        cloud_pct <= MAX_CLOUD_COVER_PCT
        and valid_fraction >= MIN_VALID_PIXEL_FRACTION
    )
