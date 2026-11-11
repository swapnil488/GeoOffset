from fastapi import APIRouter, Depends, HTTPException
from geoalchemy2.shape import from_shape
from shapely.geometry import shape
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.project import Project
from app.schemas.project import ProjectCreate, ProjectOut

router = APIRouter(prefix="/projects", tags=["projects"])


@router.post("", response_model=ProjectOut, status_code=201)
def create_project(payload: ProjectCreate, db: Session = Depends(get_db)):
    existing = db.query(Project).filter(Project.project_id == payload.project_id).first()
    if existing:
        raise HTTPException(409, f"Project '{payload.project_id}' already exists.")

    geom = shape(payload.aoi_geojson)
    if geom.geom_type not in ("Polygon", "MultiPolygon"):
        raise HTTPException(422, f"AOI must be a Polygon or MultiPolygon, got {geom.geom_type}")

    project = Project(
        project_id=payload.project_id,
        name=payload.name,
        aoi_geom=from_shape(geom, srid=4326),
        aoi_area_km2=payload.aoi_area_km2,
        bond_deposit_amount=payload.bond_deposit_amount,
        owner_address=payload.owner_address,
    )
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(project_id: str, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.project_id == project_id).first()
    if not project:
        raise HTTPException(404, f"Project '{project_id}' not found.")
    return project
