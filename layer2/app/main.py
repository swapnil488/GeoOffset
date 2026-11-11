"""
GeoOffset Layer 2 — dMRV Verification Engine (FastAPI)

Consumes Layer 1's satellite-derived NDVI/EVI time series, runs the
dual-pipeline adversarial agreement check, manages the 72-hour
escrow-backed challenge window, and adjudicates disputes via an
independent recheck. Hands off minting eligibility + escrow verdicts to
Layer 3's smart contracts — this service never touches tokens itself.

Run locally:
    uvicorn app.main:app --reload --port 8000
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import disputes, projects, verifications

app = FastAPI(
    title="GeoOffset dMRV Verification Engine",
    description=(
        "Layer 2: dual-pipeline (Sentinel-2 x Landsat) adversarial "
        "verification and escrow-backed dispute resolution."
    ),
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",")],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(projects.router)
app.include_router(verifications.router)
app.include_router(disputes.router)


@app.get("/health", tags=["health"])
def health():
    return {"status": "ok"}
