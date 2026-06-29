"""Enclave source registry (admin-only).

Creating a source returns a one-time plaintext ingest token; only the argon2
hash is stored. Use this token in the X-Ingest-Token header on POST /ingest.
"""

from __future__ import annotations

import secrets

from argon2 import PasswordHasher
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from db import get_db
from deps import requires
from models import EnclaveSource
from schemas import EnclaveSourceCreated, EnclaveSourceIn, EnclaveSourceOut

router = APIRouter(prefix="/enclave-sources", tags=["enclave-sources"])

_ph = PasswordHasher()


@router.get("", response_model=list[EnclaveSourceOut])
def list_sources(db: Session = Depends(get_db), _=Depends(requires("admin"))):
    return db.query(EnclaveSource).order_by(EnclaveSource.name).all()


@router.post("", response_model=EnclaveSourceCreated, status_code=status.HTTP_201_CREATED)
def create_source(
    body: EnclaveSourceIn,
    db: Session = Depends(get_db),
    _=Depends(requires("admin")),
):
    if db.query(EnclaveSource).filter(EnclaveSource.name == body.name).first():
        raise HTTPException(status.HTTP_409_CONFLICT, "Source name already exists")
    token = secrets.token_urlsafe(32)
    src = EnclaveSource(
        name=body.name,
        scoi_url=body.scoi_url,
        notes=body.notes,
        ingest_token_hash=_ph.hash(token),
        sync_status="unknown",
    )
    db.add(src)
    db.flush()
    return EnclaveSourceCreated(
        enclave_source=EnclaveSourceOut.model_validate(src),
        ingest_token=token,
    )


@router.delete("/{source_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_source(
    source_id: int,
    db: Session = Depends(get_db),
    _=Depends(requires("admin")),
):
    src = db.get(EnclaveSource, source_id)
    if src is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Source not found")
    db.delete(src)
