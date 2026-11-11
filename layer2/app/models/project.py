"""
Project model: one row per registered carbon project (one AOI).

Storing aoi_geom as a real PostGIS geometry (not just an area float) is
what makes cross-border double-counting detection possible later — two
projects claiming overlapping/identical geometry across a jurisdictional
boundary is a spatial query against this column, not a manual audit.
"""

from datetime import datetime, timezone

from geoalchemy2 import Geometry
from sqlalchemy import Column, DateTime, Float, Integer, Numeric, String
from sqlalchemy.orm import relationship

from app.database import Base


class Project(Base):
    __tablename__ = "projects"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(String, unique=True, nullable=False, index=True)
    name = Column(String, nullable=False)

    # SRID 4326 (WGS84 lat/lon), matches the GeoJSON AOI fed into Layer 1.
    aoi_geom = Column(Geometry(geometry_type="POLYGON", srid=4326), nullable=False)
    aoi_area_km2 = Column(Float, nullable=False)

    # Token amount the project has posted as a bond. This is what backs
    # the escrow-based dispute mechanism: a challenger's stake is weighed
    # against this deposit, and it's what gets forfeited if a challenge
    # succeeds.
    bond_deposit_amount = Column(Numeric(20, 6), nullable=False, default=0)
    owner_address = Column(String, nullable=False)

    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    verification_records = relationship("VerificationRecord", back_populates="project")
