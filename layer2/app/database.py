"""
SQLAlchemy engine/session wiring for the dMRV verification engine.

Uses PostgreSQL + PostGIS (via GeoAlchemy2) so a project's AOI can be
stored and queried as a real geometry — needed later for cross-border
overlap checks (the core double-counting-prevention guarantee) rather
than trusting a self-reported bounding box.
"""

from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

from app.config import settings

engine = create_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    """FastAPI dependency: yields a request-scoped DB session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    """
    Create all tables from ORM metadata. For local dev / first run only —
    prefer the versioned DDL in db/init_db.sql (and a real migration tool
    like Alembic) once this moves past MVP.
    """
    import app.models  # noqa: F401 ensure models are registered on Base
    Base.metadata.create_all(bind=engine)
