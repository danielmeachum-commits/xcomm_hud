"""UTC CRUD nested under sites."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from db import get_db
from deps import requires
from models import Equipment, Site, UTC
from rollup import utc_status
from schemas import UTCIn, UTCOut, UTCPatch

router = APIRouter(tags=["utcs"])


def _utc_with_status(db: Session, utc: UTC) -> UTCOut:
    states = [
        e.status for e in db.query(Equipment).filter(Equipment.utc_id == utc.id).all()
    ]
    out = UTCOut.model_validate(utc)
    out.status = utc_status(states)
    return out


@router.get("/sites/{site_id}/utcs", response_model=list[UTCOut])
def list_utcs(site_id: int, db: Session = Depends(get_db), _=Depends(requires("viewer"))):
    if db.get(Site, site_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Site not found")
    utcs = (
        db.query(UTC)
        .filter(UTC.site_id == site_id)
        .order_by(UTC.designation)
        .all()
    )
    return [_utc_with_status(db, u) for u in utcs]


@router.post(
    "/sites/{site_id}/utcs",
    response_model=UTCOut,
    status_code=status.HTTP_201_CREATED,
)
def create_utc(
    site_id: int,
    body: UTCIn,
    db: Session = Depends(get_db),
    _=Depends(requires("operator")),
):
    if db.get(Site, site_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Site not found")
    existing = (
        db.query(UTC)
        .filter(UTC.site_id == site_id, UTC.designation == body.designation)
        .first()
    )
    if existing:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "UTC designation already exists at site"
        )
    utc = UTC(site_id=site_id, **body.model_dump())
    db.add(utc)
    db.flush()
    return _utc_with_status(db, utc)


@router.patch("/utcs/{utc_id}", response_model=UTCOut)
def patch_utc(
    utc_id: int,
    body: UTCPatch,
    db: Session = Depends(get_db),
    _=Depends(requires("operator")),
):
    utc = db.get(UTC, utc_id)
    if utc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "UTC not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(utc, k, v)
    db.flush()
    return _utc_with_status(db, utc)


@router.delete("/utcs/{utc_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_utc(
    utc_id: int,
    db: Session = Depends(get_db),
    _=Depends(requires("admin")),
):
    utc = db.get(UTC, utc_id)
    if utc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "UTC not found")
    db.delete(utc)
