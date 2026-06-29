"""Site CRUD with status rollup from its services."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from db import get_db
from deps import requires
from models import Service, Site
from rollup import site_status
from schemas import SiteIn, SiteOut, SitePatch

router = APIRouter(prefix="/sites", tags=["sites"])


def _site_with_status(db: Session, site: Site) -> SiteOut:
    services = db.query(Service).filter(Service.site_id == site.id).all()
    out = SiteOut.model_validate(site)
    out.status = site_status([s.status for s in services])
    return out


@router.get("", response_model=list[SiteOut])
def list_sites(db: Session = Depends(get_db), _=Depends(requires("viewer"))):
    sites = db.query(Site).order_by(Site.name).all()
    return [_site_with_status(db, s) for s in sites]


@router.post("", response_model=SiteOut, status_code=status.HTTP_201_CREATED)
def create_site(
    body: SiteIn,
    db: Session = Depends(get_db),
    _=Depends(requires("operator")),
):
    if db.query(Site).filter(Site.name == body.name).first():
        raise HTTPException(status.HTTP_409_CONFLICT, "Site name already exists")
    site = Site(**body.model_dump())
    db.add(site)
    db.flush()
    return _site_with_status(db, site)


@router.get("/{site_id}", response_model=SiteOut)
def get_site(site_id: int, db: Session = Depends(get_db), _=Depends(requires("viewer"))):
    site = db.get(Site, site_id)
    if site is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Site not found")
    return _site_with_status(db, site)


@router.patch("/{site_id}", response_model=SiteOut)
def patch_site(
    site_id: int,
    body: SitePatch,
    db: Session = Depends(get_db),
    _=Depends(requires("operator")),
):
    site = db.get(Site, site_id)
    if site is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Site not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(site, k, v)
    db.flush()
    return _site_with_status(db, site)


@router.delete("/{site_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_site(
    site_id: int,
    db: Session = Depends(get_db),
    _=Depends(requires("admin")),
):
    site = db.get(Site, site_id)
    if site is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Site not found")
    db.delete(site)
