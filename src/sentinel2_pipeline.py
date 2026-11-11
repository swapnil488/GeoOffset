"""
Sentinel-2 NDVI/EVI time series extraction for an AOI.

Uses COPERNICUS/S2_SR_HARMONIZED (surface reflectance, harmonized across
processing baselines). Each returned record is one cloud-QA'd observation
date with zonal-mean NDVI and EVI over the AOI.
"""

import ee
from config.settings import S2_BANDS, S2_SCALE_M, EVI_G, EVI_C1, EVI_C2, EVI_L
from src.cloud_mask import mask_sentinel2, scene_passes_qa


def _add_indices(image: ee.Image) -> ee.Image:
    nir = image.select(S2_BANDS["NIR"]).divide(10000)
    red = image.select(S2_BANDS["RED"]).divide(10000)
    blue = image.select(S2_BANDS["BLUE"]).divide(10000)

    ndvi = nir.subtract(red).divide(nir.add(red)).rename("NDVI")
    evi = nir.subtract(red).multiply(EVI_G).divide(
        nir.add(red.multiply(EVI_C1)).subtract(blue.multiply(EVI_C2)).add(EVI_L)
    ).rename("EVI")

    return image.addBands([ndvi, evi])


def get_sentinel2_timeseries(aoi: ee.Geometry, start_date: str, end_date: str) -> list[dict]:
    """
    Returns a list of {date, ndvi, evi, cloud_pct, valid_fraction} dicts,
    one per QA-passing Sentinel-2 scene over the AOI in the date range.
    """
    collection = (
        ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
        .filterBounds(aoi)
        .filterDate(start_date, end_date)
        .map(lambda img: mask_sentinel2(img, aoi))
        .map(_add_indices)
    )

    image_list = collection.toList(collection.size())
    n = image_list.size().getInfo()
    print(f"[sentinel2] {n} candidate scenes found, applying QA filter...")

    records = []
    for i in range(n):
        img = ee.Image(image_list.get(i))
        if not scene_passes_qa(img, cloud_property="CLOUDY_PIXEL_PERCENTAGE"):
            continue

        stats = img.select(["NDVI", "EVI"]).reduceRegion(
            reducer=ee.Reducer.mean(), geometry=aoi, scale=S2_SCALE_M, maxPixels=1e9
        ).getInfo()

        date = ee.Date(img.get("system:time_start")).format("YYYY-MM-dd").getInfo()
        cloud_pct = img.get("CLOUDY_PIXEL_PERCENTAGE").getInfo()
        valid_fraction = img.get("valid_fraction").getInfo()

        if stats.get("NDVI") is None:
            continue  # fully masked over the AOI despite passing coarse QA

        records.append({
            "date": date,
            "sensor": "sentinel2",
            "ndvi": stats["NDVI"],
            "evi": stats["EVI"],
            "cloud_pct": cloud_pct,
            "valid_fraction": valid_fraction,
        })

    print(f"[sentinel2] {len(records)} scenes passed QA and were included.")
    return sorted(records, key=lambda r: r["date"])
