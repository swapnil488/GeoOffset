# GeoOffset — Layer 2: dMRV Verification Engine (FastAPI)

Consumes Layer 1's satellite-derived NDVI/EVI time series, runs the
**dual-pipeline adversarial verification** check (Sentinel-2 vs Landsat must
corroborate each other before anything is eligible to mint), manages the
**72-hour escrow-backed challenge window**, and adjudicates disputes via an
independent recheck. This layer computes verdicts and eligibility only — it
never touches tokens; Layer 3's smart contracts execute against its output.

## 0. Design summary

- **Trust mechanism**: two independent satellite sources (Sentinel-2, 10m;
  Landsat 8/9, 30m) must agree on NDVI/EVI within Layer 1's tolerance band
  on a sufficient fraction of their temporally-matched observations. Neither
  sensor is ground truth over the other — agreement between them is the
  signal (`app/services/verification_engine.py`).
- **Escrow dispute mechanism**: a project that passes the check enters a
  72-hour `OPEN_FOR_CHALLENGE` window. A challenger can stake tokens
  (matching the project's bond by default) to force a second, independent
  satellite recheck. Whichever side that recheck vindicates wins the other
  side's deposit — no value is created, it's a transfer from the loser's
  pre-committed escrow (`app/services/dispute_engine.py`).
- **Carbon estimate is an explicit placeholder.** The NDVI-trend →
  biomass → carbon → CO2e conversion in `verification_engine.py` /
  `config.py` is a simple linear proxy, *not* a calibrated allometric
  model. It's isolated in one place (`config.py`'s
  `NDVI_TO_BIOMASS_SLOPE_T_HA` etc.) specifically so it can be swapped for
  a land-cover-specific, field-validated regression without touching the
  verification/dispute logic around it. This is flagged deliberately —
  the differentiator this project is built to demonstrate is the
  dual-pipeline trust + escrow-dispute architecture, not a novel biomass
  model.

## 1. Project structure

```
layer2/
├── app/
│   ├── main.py                 # FastAPI app, routers, CORS, /health
│   ├── config.py                # all thresholds (agreement rate, coverage,
│   │                             #   challenge window hours, stake ratio, ...)
│   ├── database.py              # SQLAlchemy engine/session, get_db dependency
│   ├── models/                  # ORM: Project (PostGIS AOI), VerificationRecord,
│   │                             #   AlignedObservation, Dispute
│   ├── schemas/                 # Pydantic: Layer1ExportPayload (mirrors Layer 1's
│   │                             #   export.py output), API request/response models
│   ├── services/
│   │   ├── verification_engine.py  # PURE dual-pipeline check (no DB/IO) — unit
│   │   │                            #   tested directly against real Layer 1 output
│   │   ├── dispute_engine.py       # PURE adjudication (adjudicate()) + DB workflow
│   │   │                            #   (open_dispute, resolve_dispute)
│   │   └── ingestion.py            # persists a Layer 1 export + verification result
│   └── routers/                 # projects.py, verifications.py, disputes.py
├── db/
│   └── init_db.sql               # versioned PostGIS DDL mirroring the ORM models
├── tests/
│   ├── fixtures/demo-project-001_timeseries.json   # real Layer 1 output
│   ├── test_verification_engine.py   # unit tests, no DB
│   ├── test_dispute_engine.py        # unit tests, no DB
│   └── test_integration_e2e.py       # full HTTP lifecycle against real Postgres+PostGIS
├── requirements.txt
└── .env.example
```

## 2. Prerequisites

1. **PostgreSQL 14+ with PostGIS** (the AOI geometry column requires it —
   this is also what makes cross-border double-counting checks a real
   spatial query later, not a manual audit).
2. **Python 3.10+**.

## 3. Install & configure

```bash
cd layer2
python -m venv venv
source venv/bin/activate      # venv\Scripts\activate on Windows
pip install -r requirements.txt

cp .env.example .env
# edit .env with your real DATABASE_URL
```

## 4. Set up the database

```bash
createdb geooffset
psql -d geooffset -f db/init_db.sql
```

(Or use `app.database.init_db()` to create tables from the ORM metadata for
quick local dev — the SQL file is the canonical, review-friendly DDL.)

## 5. Run the API

```bash
uvicorn app.main:app --reload --port 8000
```

Interactive docs at `http://localhost:8000/docs`.

## 6. Run the tests

```bash
# Pure unit tests (verification engine + dispute adjudication) — no DB needed
pytest tests/test_verification_engine.py tests/test_dispute_engine.py -v

# Full end-to-end integration test — requires DATABASE_URL pointing at a
# real Postgres+PostGIS instance with db/init_db.sql already applied
DATABASE_URL=postgresql://geooffset:geooffset@localhost:5432/geooffset \
    pytest tests/test_integration_e2e.py -v
```

All 9 tests pass as of this build, including the end-to-end lifecycle
(create project → submit real Layer 1 output → PROVISIONALLY_VERIFIED →
open dispute → resolve with a contradicting recheck → RESOLVED_CHALLENGER_WON
→ escrow verdict → original record FINALIZED_REJECTED) run against a real
PostgreSQL + PostGIS database.

## 7. API overview

| Method | Path | Purpose |
|---|---|---|
| POST | `/projects` | Register a project + AOI (GeoJSON) + bond deposit |
| GET | `/projects/{project_id}` | Fetch project |
| POST | `/projects/{project_id}/verifications` | Ingest a Layer 1 export, run the dual-pipeline check |
| GET | `/projects/{project_id}/verifications` | List a project's verification history |
| GET | `/verifications/{id}` | Fetch a verification record (with normalized aligned observations) |
| POST | `/verifications/{id}/finalize` | Manually check if the 72h challenge window has elapsed unchallenged (a scheduled job would call this in production) |
| POST | `/verifications/{id}/disputes` | Open a dispute with a staked challenge |
| GET | `/disputes/{id}` | Fetch a dispute |
| POST | `/disputes/{id}/resolve` | Submit the independent recheck payload, get the adjudication + escrow verdict |

## 8. What Layer 3 (smart contracts) consumes from here

`POST /disputes/{id}/resolve` and the `finalization_status` field on a
`VerificationRecord` are the two things Layer 3's Solidity escrow contract
needs: whether a project is `FINALIZED_MINTABLE` (safe to mint ERC-1155
credits against), and, for a resolved dispute, the `escrow_verdict`
(`winner`, `amount_transferred`, `paid_by`, `paid_to`) telling the contract
exactly how to settle the stake/bond. Layer 2 never calls a wallet or moves
a token itself.

## 9. Known MVP simplifications (worth stating explicitly in review)

- The carbon-estimate conversion is a placeholder linear model (see §0).
- `POST /verifications/{id}/finalize` is manual here; production would run
  it as a scheduled job checking all `OPEN_FOR_CHALLENGE` records past their
  `challenge_window_expires_at`.
- No auth/signature verification on `owner_address` /
  `challenger_address` yet — Layer 3's wallet-based auth (or a
  signed-message check at the API boundary) is the next layer to add this.
- Migrations are raw SQL (`db/init_db.sql`) rather than Alembic-managed;
  fine for MVP, worth upgrading before multiple schema iterations.
