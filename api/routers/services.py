"""Service CRUD. Status is a direct field; setting it emits a status_event."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from db import get_db
from deps import requires
from models import Service, Site, StatusEvent, User
from schemas import ServiceIn, ServiceOut, ServicePatch

router = APIRouter(prefix="/services", tags=["services"])


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
    service = Service(**body.model_dump())
    db.add(service)
    db.flush()
    return service


@router.get("/{service_id}", response_model=ServiceOut)
def get_service(
    service_id: int,
    db: Session = Depends(get_db),
    _=Depends(requires("viewer")),
):
    service = db.get(Service, service_id)
    if service is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Service not found")
    return service


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
    note = data.pop("note", None)

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
                note=note,
            )
        )
        service.status = new_status

    db.flush()
    db.refresh(service)
    return service


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
