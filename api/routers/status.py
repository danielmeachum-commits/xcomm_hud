"""Rollup status endpoint that powers the dashboard widgets."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from db import get_db
from deps import requires
from models import Service, Site
from rollup import site_status
from schemas import ServiceRollup, SiteRollup, StatusRollupOut

router = APIRouter(prefix="/status", tags=["status"])


@router.get("/rollup", response_model=StatusRollupOut)
def rollup(db: Session = Depends(get_db), _=Depends(requires("viewer"))):
    sites = db.query(Site).order_by(Site.name).all()
    services = db.query(Service).order_by(Service.kind, Service.name).all()

    site_name_by_id = {s.id: s.name for s in sites}
    services_by_site: dict[int, list[Service]] = {}
    for svc in services:
        if svc.site_id is not None:
            services_by_site.setdefault(svc.site_id, []).append(svc)

    site_rollups = [
        SiteRollup(
            id=site.id,
            name=site.name,
            status=site_status([s.status for s in services_by_site.get(site.id, [])]),
            service_count=len(services_by_site.get(site.id, [])),
        )
        for site in sites
    ]

    service_rollups = [
        ServiceRollup(
            id=s.id,
            name=s.name,
            kind=s.kind,
            hosting=s.hosting,
            status=s.status,
            site_id=s.site_id,
            site_name=site_name_by_id.get(s.site_id) if s.site_id else None,
        )
        for s in services
    ]

    return StatusRollupOut(sites=site_rollups, services=service_rollups)
