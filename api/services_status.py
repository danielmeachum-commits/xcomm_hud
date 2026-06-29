"""Service status recomputation helpers.

Kept in its own module to avoid a circular import between equipment and
service routers (both need to trigger recomputation when components change).
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from models import Equipment, Service, ServiceComponent
from rollup import service_status


def recompute_service_status(db: Session, service_id: int) -> None:
    service = db.get(Service, service_id)
    if service is None:
        return
    comps = (
        db.query(ServiceComponent, Equipment)
        .join(Equipment, Equipment.id == ServiceComponent.equipment_id)
        .filter(ServiceComponent.service_id == service_id)
        .all()
    )
    pairs = [(eq.status, sc.required) for sc, eq in comps]
    new_status = service_status(pairs, service.manual_status_override, service.status)
    if new_status != service.status:
        service.status = new_status


def recompute_service_status_for_equipment(db: Session, equipment_id: int) -> None:
    rows = (
        db.query(ServiceComponent.service_id)
        .filter(ServiceComponent.equipment_id == equipment_id)
        .all()
    )
    for (svc_id,) in rows:
        recompute_service_status(db, svc_id)
