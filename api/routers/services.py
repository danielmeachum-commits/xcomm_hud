"""Service CRUD + component management."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from db import get_db
from deps import requires
from models import Equipment, Service, ServiceComponent, Site, StatusEvent, User
from schemas import (
    ServiceComponentIn,
    ServiceIn,
    ServiceOut,
    ServicePatch,
)
from services_status import recompute_service_status

router = APIRouter(prefix="/services", tags=["services"])


def _service_out(db: Session, service: Service) -> ServiceOut:
    return ServiceOut.model_validate(service)


@router.get("", response_model=list[ServiceOut])
def list_services(
    db: Session = Depends(get_db),
    _=Depends(requires("viewer")),
):
    return db.query(Service).order_by(Service.name).all()


@router.post("", response_model=ServiceOut, status_code=status.HTTP_201_CREATED)
def create_service(
    body: ServiceIn,
    db: Session = Depends(get_db),
    _=Depends(requires("operator")),
):
    if body.site_id is not None and db.get(Site, body.site_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Site not found")

    data = body.model_dump(exclude={"components"})
    service = Service(**data)
    db.add(service)
    db.flush()

    for comp in body.components:
        if db.get(Equipment, comp.equipment_id) is None:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"Equipment {comp.equipment_id} not found",
            )
        db.add(
            ServiceComponent(
                service_id=service.id,
                equipment_id=comp.equipment_id,
                role=comp.role,
                required=comp.required,
            )
        )
    db.flush()
    recompute_service_status(db, service.id)
    db.refresh(service)
    return _service_out(db, service)


@router.get("/{service_id}", response_model=ServiceOut)
def get_service(
    service_id: int,
    db: Session = Depends(get_db),
    _=Depends(requires("viewer")),
):
    service = db.get(Service, service_id)
    if service is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Service not found")
    return _service_out(db, service)


@router.patch("/{service_id}", response_model=ServiceOut)
def patch_service(
    service_id: int,
    body: ServicePatch,
    db: Session = Depends(get_db),
    current_user: User = Depends(requires("operator")),
):
    service = db.get(Service, service_id)
    if service is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Service not found")

    data = body.model_dump(exclude_unset=True)
    new_status = data.pop("status", None)
    clear_override = data.pop("clear_manual_override", False)

    if "site_id" in data and data["site_id"] is not None:
        if db.get(Site, data["site_id"]) is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Site not found")

    for k, v in data.items():
        setattr(service, k, v)

    if new_status is not None and new_status != service.status:
        db.add(
            StatusEvent(
                subject_kind="service",
                subject_id=service.id,
                old_state=service.status,
                new_state=new_status,
                source="manual",
                actor_user_id=current_user.id,
            )
        )
        service.status = new_status
        service.manual_status_override = True

    if clear_override:
        service.manual_status_override = False
        recompute_service_status(db, service.id)

    db.flush()
    db.refresh(service)
    return _service_out(db, service)


@router.post(
    "/{service_id}/components",
    response_model=ServiceOut,
    status_code=status.HTTP_201_CREATED,
)
def attach_component(
    service_id: int,
    body: ServiceComponentIn,
    db: Session = Depends(get_db),
    _=Depends(requires("operator")),
):
    service = db.get(Service, service_id)
    if service is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Service not found")
    if db.get(Equipment, body.equipment_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Equipment not found")
    existing = (
        db.query(ServiceComponent)
        .filter(
            ServiceComponent.service_id == service_id,
            ServiceComponent.equipment_id == body.equipment_id,
        )
        .first()
    )
    if existing:
        existing.role = body.role
        existing.required = body.required
    else:
        db.add(
            ServiceComponent(
                service_id=service_id,
                equipment_id=body.equipment_id,
                role=body.role,
                required=body.required,
            )
        )
    db.flush()
    recompute_service_status(db, service_id)
    db.refresh(service)
    return _service_out(db, service)


@router.delete(
    "/{service_id}/components/{equipment_id}",
    response_model=ServiceOut,
)
def detach_component(
    service_id: int,
    equipment_id: int,
    db: Session = Depends(get_db),
    _=Depends(requires("operator")),
):
    service = db.get(Service, service_id)
    if service is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Service not found")
    sc = (
        db.query(ServiceComponent)
        .filter(
            ServiceComponent.service_id == service_id,
            ServiceComponent.equipment_id == equipment_id,
        )
        .first()
    )
    if sc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Component not found")
    db.delete(sc)
    db.flush()
    recompute_service_status(db, service_id)
    db.refresh(service)
    return _service_out(db, service)


@router.delete("/{service_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_service(
    service_id: int,
    db: Session = Depends(get_db),
    _=Depends(requires("admin")),
):
    service = db.get(Service, service_id)
    if service is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Service not found")
    db.delete(service)
