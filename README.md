# GeoOffset — Layer 1: Data Ingestion (Google Earth Engine)

This layer pulls dual-satellite (Sentinel-2 + Landsat) NDVI/EVI time series
for a project AOI, cloud-masks and QA-filters the scenes, aligns the two
series temporally, and exports a structured dataset that Layer 2 (FastAPI
verification engine) consumes.

## 0. Prerequisites

1. **Google account** with Earth Engine access. Sign up at
   https://signup.earthengine.google.com/ if you haven't already
   (approval is usually near-instant for individual/dev use now).
2. **Google Cloud project** — GEE now requires a linked GCP project for
   API-based (non-console) use.
   - Go to https://console.cloud.google.com/, create a project (e.g. `geooffset-dev`).
   - Enable the **Earth Engine API** for that project.
3. **Python 3.10+** locally or in your dev container.

## 1. Install dependencies

```bash
python -m venv venv
source venv/bin/activate   # or venv\Scripts\activate on Windows
pip install -r requirements.txt
```

## 2. Authenticate

### Option A — Interactive (fastest for local dev)
```bash
earthengine authenticate
```
This opens a browser, you log in, and it caches a token locally. Fine for
your own machine, not for a server/CI.

### Option B — Service account (required for FastAPI backend / production)
1. In GCP console → IAM & Admin → Service Accounts → Create service account
   (e.g. `geooffset-gee@<project>.iam.gserviceaccount.com`).
2. Grant it the **Earth Engine Resource Viewer** role (or Editor if it needs
   to write to Earth Engine assets).
3. Create a JSON key, download it, and register the service account for
   Earth Engine access at https://signup.earthengine.google.com/#!/service_accounts
4. Store the JSON key path in an environment variable — never commit it:
   ```bash
   export GEE_SERVICE_ACCOUNT_KEY=/path/to/geooffset-gee-key.json
   export GEE_SERVICE_ACCOUNT_EMAIL=geooffset-gee@<project>.iam.gserviceaccount.com
   ```

`src/gee_auth.py` tries the service account first, falls back to the
interactive-authenticated credentials if the env vars aren't set — so the
same code works on your laptop and in production.

## 3. Project structure

```
geooffset-layer1/
├── README.md
├── requirements.txt
├── config/
│   └── settings.py          # tolerance bands, index defs, date ranges
├── src/
│   ├── gee_auth.py          # authentication
│   ├── aoi.py                # AOI loading/validation (GeoJSON -> ee.Geometry)
│   ├── cloud_mask.py         # per-sensor cloud/shadow masking + scene QA
│   ├── sentinel2_pipeline.py # Sentinel-2 NDVI/EVI time series extraction
│   ├── landsat_pipeline.py   # Landsat 8/9 NDVI/EVI time series extraction
│   ├── temporal_alignment.py # match S2 <-> Landsat observations in time
│   ├── export.py             # write structured output (CSV/JSON/Parquet)
│   └── pipeline.py           # orchestrates the full run for one AOI
├── data/
│   └── sample_aoi.geojson    # example project polygon for testing
└── tests/
    └── test_pipeline_smoke.py
```

## 4. Run it end to end

```bash
python -m src.pipeline \
  --aoi data/sample_aoi.geojson \
  --start 2022-01-01 \
  --end 2024-12-31 \
  --project-id demo-project-001 \
  --out data/demo-project-001_timeseries.json
```

This produces one JSON file containing:
- Per-date Sentinel-2 NDVI/EVI zonal stats over the AOI
- Per-date Landsat NDVI/EVI zonal stats over the AOI
- A temporally aligned pairing of the two, flagged with an `agreement`
  field (pass/fail against the configured tolerance band) — this is the
  raw input Layer 2's dual-pipeline check consumes.

## 5. What "done" looks like for Layer 1

- [ ] Can ingest an arbitrary AOI (GeoJSON polygon)
- [ ] Pulls cloud-masked Sentinel-2 NDVI/EVI time series over a date range
- [ ] Pulls cloud-masked Landsat 8/9 NDVI/EVI time series over the same range
- [ ] Rejects/flags unusable scenes (cloud % over threshold) rather than
      silently including bad data
- [ ] Aligns the two series by nearest-date-within-window matching
- [ ] Exports a clean structured dataset (JSON/CSV) with both series +
      alignment metadata
- [ ] Runs against a real AOI end-to-end without manual GEE console steps

## Notes / gotchas

- **Earth Engine quotas**: interactive/free-tier accounts have request
  quotas. For repeated backend calls, request a higher-quota service
  account or batch exports via `ee.batch.Export` instead of synchronous
  `getInfo()` calls once you move past prototyping.
- **Scale parameter matters**: Sentinel-2 is 10m/px, Landsat is 30m/px.
  Zonal stats must be computed at each sensor's native scale — don't
  resample one to match the other before extraction, or you'll bias the
  "independent pipeline" comparison that's core to your verification story.
- **NDVI vs EVI**: EVI corrects for atmospheric/soil background noise
  better in dense canopy — worth exposing both since your biomass formula
  in Layer 2 may end up using EVI as primary and NDVI as a sanity check.
