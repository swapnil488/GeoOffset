-- GeoOffset Layer 2 schema (PostgreSQL + PostGIS)
-- Mirrors app/models/*.py. Kept versioned here for review purposes and
-- as the canonical DDL a real migration tool (Alembic) would generate
-- from later on.

CREATE EXTENSION IF NOT EXISTS postgis;

-- ---------------------------------------------------------------------
-- projects: one row per registered carbon project / AOI.
-- Real PostGIS geometry (not just an area float) so cross-border
-- double-counting checks are a spatial query, not a manual audit.
-- ---------------------------------------------------------------------
CREATE TABLE projects (
    id                  SERIAL PRIMARY KEY,
    project_id          TEXT UNIQUE NOT NULL,
    name                TEXT NOT NULL,
    aoi_geom            GEOMETRY(POLYGON, 4326) NOT NULL,
    aoi_area_km2        DOUBLE PRECISION NOT NULL CHECK (aoi_area_km2 > 0),
    bond_deposit_amount NUMERIC(20, 6) NOT NULL DEFAULT 0 CHECK (bond_deposit_amount >= 0),
    owner_address       TEXT NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_projects_aoi_geom ON projects USING GIST (aoi_geom);

-- ---------------------------------------------------------------------
-- verification_records: one row per Layer 1 ingestion run (original
-- submission or dispute-triggered recheck).
-- ---------------------------------------------------------------------
CREATE TYPE verification_outcome AS ENUM (
    'INSUFFICIENT_DATA', 'REJECTED', 'PROVISIONALLY_VERIFIED'
);

CREATE TYPE finalization_status AS ENUM (
    'NOT_APPLICABLE', 'OPEN_FOR_CHALLENGE', 'UNDER_DISPUTE',
    'FINALIZED_MINTABLE', 'FINALIZED_REJECTED'
);

CREATE TABLE verification_records (
    id                          SERIAL PRIMARY KEY,
    project_id                  TEXT NOT NULL REFERENCES projects(project_id),
    generated_at                TIMESTAMPTZ NOT NULL,
    ingested_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),

    s2_scene_count              INTEGER NOT NULL,
    landsat_scene_count         INTEGER NOT NULL,
    matched_pair_count          INTEGER NOT NULL,
    ndvi_agreement_pass_count   INTEGER NOT NULL,

    agreement_rate              DOUBLE PRECISION,
    coverage_ratio              DOUBLE PRECISION,
    ndvi_trend_per_year         DOUBLE PRECISION,
    estimated_tons_co2e         DOUBLE PRECISION,

    verification_outcome        verification_outcome NOT NULL,
    finalization_status         finalization_status NOT NULL DEFAULT 'NOT_APPLICABLE',
    challenge_window_expires_at TIMESTAMPTZ,

    is_recheck                  BOOLEAN NOT NULL DEFAULT FALSE,
    raw_payload                 JSONB NOT NULL
);

CREATE INDEX idx_verification_records_project_id ON verification_records (project_id);
CREATE INDEX idx_verification_records_raw_payload ON verification_records USING GIN (raw_payload);

-- ---------------------------------------------------------------------
-- aligned_observations: normalized per-pair rows mirroring Layer 1's
-- aligned_observations list (queryable, not just JSONB).
-- ---------------------------------------------------------------------
CREATE TABLE aligned_observations (
    id                      SERIAL PRIMARY KEY,
    verification_record_id INTEGER NOT NULL REFERENCES verification_records(id) ON DELETE CASCADE,

    s2_date                 DATE,
    landsat_date            DATE,
    days_apart              INTEGER,

    s2_ndvi                 DOUBLE PRECISION,
    landsat_ndvi            DOUBLE PRECISION,
    ndvi_agreement          BOOLEAN,

    s2_evi                  DOUBLE PRECISION,
    landsat_evi             DOUBLE PRECISION,
    evi_agreement           BOOLEAN,

    matched                 BOOLEAN NOT NULL
);

CREATE INDEX idx_aligned_observations_record_id ON aligned_observations (verification_record_id);

-- ---------------------------------------------------------------------
-- disputes: escrow-backed challenges against a PROVISIONALLY_VERIFIED
-- record during its 72-hour challenge window.
-- ---------------------------------------------------------------------
CREATE TYPE dispute_status AS ENUM (
    'OPEN', 'RESOLVED_PROJECT_WON', 'RESOLVED_CHALLENGER_WON'
);

CREATE TABLE disputes (
    id                              SERIAL PRIMARY KEY,
    verification_record_id         INTEGER NOT NULL REFERENCES verification_records(id),

    challenger_address              TEXT NOT NULL,
    challenger_stake_amount         NUMERIC(20, 6) NOT NULL CHECK (challenger_stake_amount > 0),
    project_bond_snapshot           NUMERIC(20, 6) NOT NULL,

    opened_at                       TIMESTAMPTZ NOT NULL DEFAULT now(),
    status                          dispute_status NOT NULL DEFAULT 'OPEN',

    recheck_verification_record_id  INTEGER REFERENCES verification_records(id),
    resolved_at                     TIMESTAMPTZ,
    resolution_notes                TEXT
);

CREATE INDEX idx_disputes_verification_record_id ON disputes (verification_record_id);
