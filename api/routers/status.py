"""Rollup status endpoint that powers the dashboard widgets."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from db import get_db
from deps import requires
from models import Equipment, Service, Site, UTC
from rollup import site_status, utc_status
from schemas import ServiceRollup, SiteRollup, StatusRollupOut

router = APIRouter(prefix="/status", tags=["status"])


@router.get("/rollup", response_model=StatusRollupOut)
def rollup(db: Session = Depends(get_db), _=Depends(requires("viewer"))):
    sites = db.query(Site).order_by(Site.name).all()
    site_rollups: list[SiteRollup] = []
    for site in sites:
        equipment = db.query(Equipment).filter(Equipment.site_id == site.id).all()
        utcs = db.query(UTC).filter(UTC.site_id == site.id).all()
        services = db.query(Service).filter(Service.site_id == site.id).all()
        utc_states = [
            utc_status([e.status for e in equipment if e.utc_id == u.id]) for u in utcs
        ]
        unassigned = [e.status for e in equipment if e.utc_id is None]
        svc_states = [s.status for s in services]
        site_rollups.append(
            SiteRollup(
                id=site.id,
                name=site.name,
                status=site_status(utc_states + unassigned + svc_states),
                utc_count=len(utcs),
                equipment_count=len(equipment),
                service_count=len(services),
            )
        )

    services = db.query(Service).order_by(Service.kind, Service.name).all()
    service_rollups = [
        ServiceRollup(
            id=s.id,
            name=s.name,
            kind=s.kind,
            hosting=s.hosting,
            status=s.status,
            site_id=s.site_id,
        )
        for s in services
    ]

    return StatusRollupOut(sites=site_rollups, services=service_rollups)
