"""CRUD for the service catalog (templates).

The catalog defines standardized service types — name, kind, category, reach,
icon, description, and the set of statuses that are valid for instances of
that type. Adding services from the catalog keeps configuration consistent
across sites.
"""

from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy.orm import Session

from db import get_db
from deps import requires
from models import ServiceTemplate
from pubsub import notify
from schemas import ServiceTemplateIn, ServiceTemplateOut, ServiceTemplatePatch

router = APIRouter(prefix="/service-templates", tags=["service-templates"])


@router.get("", response_model=list[ServiceTemplateOut])
def list_templates(
    db: Session = Depends(get_db),
    _=Depends(requires("viewer")),
):
    return (
        db.query(ServiceTemplate)
        .order_by(ServiceTemplate.category, ServiceTemplate.name)
        .all()
    )


@router.post("", response_model=ServiceTemplateOut, status_code=status.HTTP_201_CREATED)
def create_template(
    body: ServiceTemplateIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    _=Depends(requires("admin")),
):
    if db.query(ServiceTemplate).filter(ServiceTemplate.name == body.name).first():
        raise HTTPException(status.HTTP_409_CONFLICT, "Template name already exists")
    t = ServiceTemplate(**body.model_dump())
    db.add(t)
    db.flush()
    notify(background_tasks, "service_templates")
    return t


@router.get("/{template_id}", response_model=ServiceTemplateOut)
def get_template(
    template_id: int,
    db: Session = Depends(get_db),
    _=Depends(requires("viewer")),
):
    t = db.get(ServiceTemplate, template_id)
    if t is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Template not found")
    return t


@router.patch("/{template_id}", response_model=ServiceTemplateOut)
def patch_template(
    template_id: int,
    body: ServiceTemplatePatch,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    _=Depends(requires("admin")),
):
    t = db.get(ServiceTemplate, template_id)
    if t is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Template not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(t, k, v)
    db.flush()
    notify(background_tasks, "service_templates")
    return t


@router.delete("/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_template(
    template_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    _=Depends(requires("admin")),
):
    t = db.get(ServiceTemplate, template_id)
    if t is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Template not found")
    db.delete(t)
    notify(background_tasks, "service_templates")
