"""
Landsat 8/9 NDVI/EVI time series extraction for an AOI.

Uses Collection 2 Level 2 surface reflectance from both Landsat 8 and 9,
merged into one collection so the "second independent pipeline" doesn't
silently thin out during Landsat 8-only or 9-only periods.
"""

import ee
from config.settings import LANDSAT_BANDS, LANDSAT_SCALE_M, EVI_G, EVI_C1, EVI_C2, EVI_L
from src.cloud_mask import mask_landsat, scene_passes_qa

# Landsat C2L2 SR bands are scaled: reflectance = DN * 0.0000275 - 0.2
SR_SCALE_FACTOR = 0.0000275
SR_OFFSET = -0.2


def _apply_scale_factors(image: ee.Image) -> ee.Image:
    optical = image.select("SR_B.").multiply(SR_SCALE_FACTOR).add(SR_OFFSET)
    return image.addBands(optical, None, True)


def _add_indices(image: ee.Image) -> ee.Image:
    nir = image.select(LANDSAT_BANDS["NIR"])
    red = image.select(LANDSAT_BANDS["RED"])
    blue = image.select(LANDSAT_BANDS["BLUE"])

    ndvi = nir.subtract(red).divide(nir.add(red)).rename("NDVI")
    evi = nir.subtract(red).multiply(EVI_G).divide(
        nir.add(red.multiply(EVI_C1)).subtract(blue.multiply(EVI_C2)).add(EVI_L)
    ).rename("EVI")

    return image.addBands([ndvi, evi])


def get_landsat_timeseries(aoi: ee.Geometry, start_date: str, end_date: str) -> list[dict]:
    """
    Returns a list of {date, ndvi, evi, cloud_pct, valid_fraction} dicts,
    one per QA-passing Landsat 8/9 scene over the AOI in the date range.
    """
    l8 = ee.ImageCollection("LANDSAT/LC08/C02/T1_L2")
    l9 = ee.ImageCollection("LANDSAT/LC09/C02/T1_L2")

    collection = (
        l8.merge(l9)
        .filterBounds(aoi)
        .filterDate(start_date, end_date)
        .map(_apply_scale_factors)
        .map(lambda img: mask_landsat(img, aoi))
        .map(_add_indices)
    )

    image_list = collection.toList(collection.size())
    n = image_list.size().getInfo()
    print(f"[landsat] {n} candidate scenes found, applying QA filter...")

    records = []
    for i in range(n):
        img = ee.Image(image_list.get(i))
        if not scene_passes_qa(img, cloud_property="CLOUD_COVER"):
            continue

        stats = img.select(["NDVI", "EVI"]).reduceRegion(
            reducer=ee.Reducer.mean(), geometry=aoi, scale=LANDSAT_SCALE_M, maxPixels=1e9
        ).getInfo()

        date = ee.Date(img.get("system:time_start")).format("YYYY-MM-dd").getInfo()
        cloud_pct = img.get("CLOUD_COVER").getInfo()
        valid_fraction = img.get("valid_fraction").getInfo()

        if stats.get("NDVI") is None:
            continue

        records.append({
            "date": date,
            "sensor": "landsat",
            "ndvi": stats["NDVI"],
            "evi": stats["EVI"],
            "cloud_pct": cloud_pct,
            "valid_fraction": valid_fraction,
        })

    print(f"[landsat] {len(records)} scenes passed QA and were included.")
    return sorted(records, key=lambda r: r["date"])
