from datetime import datetime
from decimal import Decimal
from typing import Any

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

    model_config = ConfigDict(from_attributes=True)
