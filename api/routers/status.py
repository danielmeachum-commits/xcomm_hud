"""Rollup status endpoint."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from db import get_db
from deps import requires
from effective import effective_service_status
from models import Gateway, Service, Site
from rollup import site_status
from schemas import ServiceRollup, SiteRollup, StatusRollupOut

router = APIRouter(prefix="/status", tags=["status"])


@router.get("/rollup", response_model=StatusRollupOut)
def rollup(db: Session = Depends(get_db), _=Depends(requires("viewer"))):
    sites = db.query(Site).order_by(Site.name).all()
    services = db.query(Service).order_by(Service.category, Service.name).all()
    gateways = db.query(Gateway).all()

    services_by_site: dict[int, list[Service]] = {}
    for s in services:
        services_by_site.setdefault(s.site_id, []).append(s)
    gateways_by_site: dict[int, list[Gateway]] = {}
    for g in gateways:
        gateways_by_site.setdefault(g.site_id, []).append(g)
    site_name_by_id = {s.id: s.name for s in sites}

    site_rollups: list[SiteRollup] = []
    for site in sites:
        site_gws = gateways_by_site.get(site.id, [])
        site_svcs = services_by_site.get(site.id, [])
        site_rollups.append(
            SiteRollup(
                id=site.id,
                name=site.name,
                status=site_status(
                    [effective_service_status(s, site_gws) for s in site_svcs]
                ),
                fpcon=site.fpcon,
                emcon=site.emcon,
                service_count=len(site_svcs),
                gateway_count=len(site_gws),
            )
        )

    service_rollups = [
        ServiceRollup(
            id=s.id,
            name=s.name,
            kind=s.kind,
            category=s.category,
            reach=s.reach,
            icon=s.icon,
            status=s.status,
            effective_status=effective_service_status(
                s, gateways_by_site.get(s.site_id, [])
            ),
            site_id=s.site_id,
            site_name=site_name_by_id[s.site_id],
            validated_at=s.validated_at,
        )
        for s in services
    ]

    return StatusRollupOut(sites=site_rollups, services=service_rollups)
