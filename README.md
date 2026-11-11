# GeoOffset

**Satellite-verified, cross-border carbon credit tokenization.**

GeoOffset checks a carbon project's sequestration claim with two independent
satellites (Sentinel-2 and Landsat). It only mints on-chain credits once the
claim has survived a 72-hour, escrow-backed challenge window. Retired credits
are burned, so the same tonne can't be claimed twice in two countries.

## Architecture

```
 Layer 1  Google Earth Engine        Sentinel-2 + Landsat NDVI/EVI time series,
          (src/, config/)            cloud-masked and temporally aligned -> JSON
              │  HTTP (scripts/run_full_pipeline.py)
              ▼
 Layer 2  FastAPI dMRV engine        dual-pipeline agreement check, 72h challenge
          (layer2/)                  window, escrow dispute adjudication, PostGIS
              │  oracle relay (layer3/scripts/relay.js)
              ▼
 Layer 3  Solidity contracts         ERC-1155 credits (1 token = 1 tCO2e), bond and
          (layer3/)                  stake escrow, on-chain window + payouts, retirement
              │  ethers.js (wallet) + REST
              ▼
 Layer 4  React frontend             satellite map of AOIs, S2-vs-Landsat agreement
          (layer4/)                  view, challenge window, marketplace, retirement
```

| Layer | What it does | Stack | Docs |
|---|---|---|---|
| 1 | Pulls and aligns dual-satellite vegetation indices for a project AOI | Python, Earth Engine API | [below](#layer-1--data-ingestion-google-earth-engine) |
| 2 | Decides whether a claim is trustworthy, runs disputes | FastAPI, SQLAlchemy, PostgreSQL + PostGIS | [layer2/README.md](layer2/README.md) |
| 3 | Holds bonds and stakes, enforces the challenge window, mints and retires credits | Solidity 0.8.24, OpenZeppelin 5, Hardhat | [layer3/README.md](layer3/README.md) |
| 4 | Map of projects, verification view, challenge/finalize, marketplace, retirement | React 18, Vite, Leaflet, Recharts, ethers v6 | [layer4/README.md](layer4/README.md) |

## How a claim flows end to end

1. **Register:** the project owner registers the AOI in Layer 2 and posts a bond on-chain (`registerProject`). The same AOI hash can't be registered twice.
2. **Measure:** Layer 1 pulls Sentinel-2 (10 m) and Landsat (30 m) NDVI/EVI for the AOI and pairs observations by date.
3. **Verify:** Layer 2 checks that the two sensors agree often enough. If they do, the record becomes `PROVISIONALLY_VERIFIED`.
4. **Open the window:** the relay records the verdict on-chain, and the contract starts a 72-hour challenge window.
5. **Challenge (optional):** anyone can stake at least the bond amount. Layer 2 runs a second, independent recheck, and the relay reports the verdict. The loser's deposit pays the winner.
6. **Mint:** if nobody challenges or the project wins, ERC-1155 credits are minted to the owner.
7. **Trade:** holders list credits on the marketplace contract; a buyer pays in GEO and receives the credits in the same transaction.
8. **Retire:** a buyer burns credits with `retire()`, naming the beneficiary and jurisdiction.

Layer 4 drives every step above from the browser.

## Repository structure

```
GeoOffset/
├── src/, config/, data/, tests/   # Layer 1 — GEE ingestion pipeline
├── scripts/run_full_pipeline.py   # Layer 1 -> Layer 2 glue (HTTP)
├── layer2/                        # Layer 2 — FastAPI verification + dispute engine
├── layer3/                        # Layer 3 — Solidity contracts, tests, deploy/relay scripts
├── layer4/                        # Layer 4 — React frontend (map, verification view, marketplace)
└── requirements.txt               # Layer 1 Python deps
```

## Quick start

```powershell
# Layer 1 — needs Earth Engine auth + GEE_PROJECT_ID (see below)
python -m venv venv; venv\Scripts\activate
pip install -r requirements.txt
python -m src.pipeline --aoi data/sample_aoi.geojson --start 2022-01-01 --end 2024-12-31 `
  --project-id demo-project-001 --out data/demo-project-001_timeseries.json

# Layer 2 — needs PostgreSQL + PostGIS
cd layer2; pip install -r requirements.txt; copy .env.example .env
psql -d geooffset -f db/init_db.sql
uvicorn app.main:app --reload --port 8000

# Layer 1 -> Layer 2 in one go
python scripts/run_full_pipeline.py --skip-run --out data/demo-project-001_timeseries.json `
  --project-id demo-project-001 --layer2-url http://localhost:8000

# Layer 3 — needs Node.js 18+
cd layer3; npm install
npx hardhat test                  # 19 contract tests
npx hardhat run scripts/demo.js   # full on-chain lifecycle demo

# Layer 4 — local chain + Layer 2 running (see layer4/README.md)
npx hardhat node                                          # in layer3/, separate terminal
npx hardhat run scripts/deploy.js --network localhost     # in layer3/
cd layer4; npm install; npm run dev                       # http://localhost:3000
```

## Tests

| Layer | Command | Tests |
|---|---|---|
| 1 | `pytest tests/` | smoke test |
| 2 | `cd layer2; pytest tests/` | 9 (incl. end-to-end against real Postgres + PostGIS) |
| 3 | `cd layer3; npx hardhat test` | 19 |

## Status

- [x] Layer 1: dual-satellite ingestion pipeline, run successfully against a real AOI
- [x] Layer 2: verification engine, dispute engine, REST API, tests
- [x] Layer 1 -> Layer 2 glue script
- [x] Layer 3: ERC-1155 credits, escrow contract, deploy and oracle relay scripts
- [ ] Layer 3 testnet deployment (Polygon Amoy / Arbitrum Sepolia)
- [x] Layer 4: React frontend with GIS visualizer, verification view and marketplace
- [x] Marketplace contract (non-custodial fixed-price listings)

---

## Layer 1 — Data Ingestion (Google Earth Engine)

This layer pulls dual-satellite (Sentinel-2 + Landsat) NDVI/EVI time series
for a project AOI, cloud-masks and QA-filters the scenes, aligns the two
series temporally, and exports a structured dataset that Layer 2 (FastAPI
verification engine) consumes.

### 0. Prerequisites

1. **Google account** with Earth Engine access. Sign up at
   https://signup.earthengine.google.com/ if you haven't already
   (approval is usually near-instant for individual/dev use now).
2. **Google Cloud project** — GEE now requires a linked GCP project for
   API-based (non-console) use.
   - Go to https://console.cloud.google.com/, create a project (e.g. `geooffset-dev`).
   - Enable the **Earth Engine API** for that project.
3. **Python 3.10+** locally or in your dev container.

### 1. Install dependencies

```bash
python -m venv venv
source venv/bin/activate   # or venv\Scripts\activate on Windows
pip install -r requirements.txt
```

### 2. Authenticate

#### Option A — Interactive (fastest for local dev)
```bash
earthengine authenticate
```
This opens a browser, you log in, and it caches a token locally. Fine for
your own machine, not for a server/CI.

#### Option B — Service account (required for FastAPI backend / production)
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

### 3. Project structure

```
GeoOffset/  (Layer 1 files)
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

### 4. Run it end to end

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

### 5. What "done" looks like for Layer 1

- [ ] Can ingest an arbitrary AOI (GeoJSON polygon)
- [ ] Pulls cloud-masked Sentinel-2 NDVI/EVI time series over a date range
- [ ] Pulls cloud-masked Landsat 8/9 NDVI/EVI time series over the same range
- [ ] Rejects/flags unusable scenes (cloud % over threshold) rather than
      silently including bad data
- [ ] Aligns the two series by nearest-date-within-window matching
- [ ] Exports a clean structured dataset (JSON/CSV) with both series +
      alignment metadata
- [ ] Runs against a real AOI end-to-end without manual GEE console steps

### Notes / gotchas

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
