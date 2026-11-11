from datetime import datetime
from decimal import Decimal
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field


class ProjectCreate(BaseModel):
    project_id: str
    name: str
    # GeoJSON Polygon geometry dict, same shape accepted by Layer 1's aoi.py
    aoi_geojson: dict[str, Any]
    aoi_area_km2: float = Field(gt=0)
    bond_deposit_amount: Decimal = Field(ge=0)
    owner_address: str


class ProjectOut(BaseModel):
    id: int
    project_id: str
    name: str
    aoi_area_km2: float
    bond_deposit_amount: Decimal
    owner_address: str
    created_at: datetime
    # AOI polygon back out as GeoJSON so the frontend map can draw it.
    aoi_geojson: Optional[dict[str, Any]] = None

    model_config = ConfigDict(from_attributes=True)


class ProjectListItem(ProjectOut):
    """
    GET /projects row: the project plus its most recent original
    (non-recheck) verification, so the map can colour every AOI by status
    in one request.
    """
    latest_verification: Optional["VerificationRecordOut"] = None


from app.schemas.verification import VerificationRecordOut  # noqa: E402

ProjectListItem.model_rebuild()
