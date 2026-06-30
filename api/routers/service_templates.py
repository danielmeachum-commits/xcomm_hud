"""Read-only catalog of standardized service templates."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from db import get_db
from deps import requires
from models import ServiceTemplate
from schemas import ServiceTemplateOut

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
