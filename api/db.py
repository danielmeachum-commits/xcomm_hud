"""Database engine and session factory."""

import os
import urllib.parse

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session


def _build_database_url() -> str:
    """Build a SQLAlchemy URL.

    Prefers component env vars (POSTGRES_USER/PASSWORD/HOST/PORT/DB) so we can
    safely URL-encode the password — DATABASE_URL with a literal '@' or ':' in
    the password gets misparsed. Falls back to DATABASE_URL for callers that
    set it directly.
    """
    user = os.environ.get("POSTGRES_USER")
    password = os.environ.get("POSTGRES_PASSWORD")
    db_name = os.environ.get("POSTGRES_DB")
    if user and password and db_name:
        host = os.environ.get("POSTGRES_HOST", "postgres")
        port = os.environ.get("POSTGRES_PORT", "5432")
        encoded = urllib.parse.quote_plus(password)
        return f"postgresql+psycopg://{user}:{encoded}@{host}:{port}/{db_name}"
    return os.environ["DATABASE_URL"]


DATABASE_URL = _build_database_url()

engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    pool_size=10,
    max_overflow=20,
)

SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


def get_db() -> Session:
    """Yield a SQLAlchemy session; close on exit. Use as a FastAPI dependency."""
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
