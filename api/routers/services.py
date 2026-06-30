"""Service CRUD + validation endpoint."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from db import get_db
from deps import requires
from effective import effective_service_status
from models import Gateway, Service, Site, User, Validation
from schemas import ServiceIn, ServiceOut, ServicePatch, ServiceValidateIn

router = APIRouter(prefix="/services", tags=["services"])


def _service_out(db: Session, service: Service) -> ServiceOut:
    gateways = (
        db.query(Gateway).filter(Gateway.site_id == service.site_id).all()
    )
    out = ServiceOut.model_validate(service)
    out.effective_status = effective_service_status(service, gateways)
    if service.validated_by_user_id is not None:
        u = db.get(User, service.validated_by_user_id)
        if u:
            out.validated_by_username = u.username
    return out


@router.get("", response_model=list[ServiceOut])
def list_services(
    db: Session = Depends(get_db),
    _=Depends(requires("viewer")),
):
    services = db.query(Service).order_by(Service.name).all()
    return [_service_out(db, s) for s in services]


@router.post("", response_model=ServiceOut, status_code=status.HTTP_201_CREATED)
def create_service(
    body: ServiceIn,
    db: Session = Depends(get_db),
    _=Depends(requires("operator")),
):
    if db.get(Site, body.site_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Site not found")
    service = Service(**body.model_dump())
    db.add(service)
    db.flush()
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
    _=Depends(requires("operator")),
):
    service = db.get(Service, service_id)
    if service is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Service not found")

    data = body.model_dump(exclude_unset=True)
    if "site_id" in data and db.get(Site, data["site_id"]) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Site not found")

    for k, v in data.items():
        setattr(service, k, v)

    db.flush()
    db.refresh(service)
    return _service_out(db, service)


@router.post("/{service_id}/validate", response_model=ServiceOut)
def validate_service(
    service_id: int,
    body: ServiceValidateIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(requires("operator")),
):
    """Record a validation: someone confirmed the service is in this state.

    Always creates a `validation` row; updates the service's stored status,
    validated_at, validated_by_user_id.
    """
    service = db.get(Service, service_id)
    if service is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Service not found")

    prev = service.status
    kwargs = dict(
        subject_kind="service",
        subject_id=service.id,
        prev_status=prev,
        status=body.status,
        source="manual",
        validated_by_user_id=current_user.id,
        note=body.note,
    )
    if body.validated_at is not None:
        kwargs["validated_at"] = body.validated_at
    v = Validation(**kwargs)
    db.add(v)
    db.flush()
    service.status = body.status
    service.validated_at = v.validated_at
    service.validated_by_user_id = current_user.id
    db.flush()
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
