"""Registry of upstream scoi instances allowed to push into /ingest (admin-only).

Creating a source returns a one-time plaintext ingest token; only the argon2
hash is stored. Use this token in the X-Ingest-Token header on POST /ingest.

Named `scoi_source`, not `enclave_source`: scoi happens to run per-enclave, but
this table answers "which sibling instance do we pull from", which is a
different question from "which network is this gear on". `enclave` is that one.
"""

from __future__ import annotations

import secrets

from argon2 import PasswordHasher
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy.orm import Session

from db import get_db
from deps import requires
from models import ScoiSource
from pubsub import notify
from schemas import ScoiSourceCreated, ScoiSourceIn, ScoiSourceOut

router = APIRouter(prefix="/scoi-sources", tags=["scoi-sources"])

_ph = PasswordHasher()


@router.get("", response_model=list[ScoiSourceOut])
def list_sources(db: Session = Depends(get_db), _=Depends(requires("admin"))):
    return db.query(ScoiSource).order_by(ScoiSource.name).all()


@router.post("", response_model=ScoiSourceCreated, status_code=status.HTTP_201_CREATED)
def create_source(
    body: ScoiSourceIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    _=Depends(requires("admin")),
):
    if db.query(ScoiSource).filter(ScoiSource.name == body.name).first():
        raise HTTPException(status.HTTP_409_CONFLICT, "Source name already exists")
    token = secrets.token_urlsafe(32)
    src = ScoiSource(
        name=body.name,
        scoi_url=body.scoi_url,
        notes=body.notes,
        ingest_token_hash=_ph.hash(token),
        sync_status="unknown",
    )
    db.add(src)
    db.flush()
    notify(background_tasks, "scoi_sources")
    return ScoiSourceCreated(
        scoi_source=ScoiSourceOut.model_validate(src),
        ingest_token=token,
    )


@router.delete("/{source_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_source(
    source_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    _=Depends(requires("admin")),
):
    src = db.get(ScoiSource, source_id)
    if src is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Source not found")
    db.delete(src)
    notify(background_tasks, "scoi_sources")
