from fastapi import APIRouter, Depends, HTTPException
from geoalchemy2.shape import from_shape, to_shape
from shapely.geometry import mapping, shape
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.project import Project
from app.models.verification import VerificationRecord
from app.schemas.project import ProjectCreate, ProjectListItem, ProjectOut
from app.schemas.verification import VerificationRecordOut

router = APIRouter(prefix="/projects", tags=["projects"])


def _aoi_geojson(project: Project) -> dict:
    return mapping(to_shape(project.aoi_geom))


def _project_out(project: Project) -> ProjectOut:
    out = ProjectOut.model_validate(project)
    out.aoi_geojson = _aoi_geojson(project)
    return out


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
    return _project_out(project)


@router.get("", response_model=list[ProjectListItem])
def list_projects(db: Session = Depends(get_db)):
    """
    All projects with their AOI geometry and latest original verification.
    Used by the Layer 4 map; fine at MVP scale (one extra query per project).
    """
    items = []
    for project in db.query(Project).order_by(Project.created_at.desc()).all():
        latest = (
            db.query(VerificationRecord)
            .filter(
                VerificationRecord.project_id == project.project_id,
                VerificationRecord.is_recheck.is_(False),
            )
            .order_by(VerificationRecord.ingested_at.desc())
            .first()
        )
        item = ProjectListItem.model_validate(project)
        item.aoi_geojson = _aoi_geojson(project)
        item.latest_verification = VerificationRecordOut.model_validate(latest) if latest else None
        items.append(item)
    return items


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(project_id: str, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.project_id == project_id).first()
    if not project:
        raise HTTPException(404, f"Project '{project_id}' not found.")
    return _project_out(project)
