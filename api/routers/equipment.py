"""Equipment CRUD."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from db import get_db
from deps import requires
from models import Equipment, Site, StatusEvent, UTC, User
from schemas import EquipmentIn, EquipmentOut, EquipmentPatch
from services_status import recompute_service_status_for_equipment

router = APIRouter(prefix="/equipment", tags=["equipment"])


@router.get("", response_model=list[EquipmentOut])
def list_equipment(
    site_id: Optional[int] = None,
    utc_id: Optional[int] = None,
    kind: Optional[str] = None,
    db: Session = Depends(get_db),
    _=Depends(requires("viewer")),
):
    q = db.query(Equipment)
    if site_id is not None:
        q = q.filter(Equipment.site_id == site_id)
    if utc_id is not None:
        q = q.filter(Equipment.utc_id == utc_id)
    if kind is not None:
        q = q.filter(Equipment.kind == kind)
    return q.order_by(Equipment.name).all()


@router.post("", response_model=EquipmentOut, status_code=status.HTTP_201_CREATED)
def create_equipment(
    body: EquipmentIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(requires("operator")),
):
    if db.get(Site, body.site_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Site not found")
    if body.utc_id is not None:
        utc = db.get(UTC, body.utc_id)
        if utc is None or utc.site_id != body.site_id:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "utc_id must belong to the same site"
            )
    eq = Equipment(**body.model_dump())
    db.add(eq)
    db.flush()
    recompute_service_status_for_equipment(db, eq.id)
    return eq


@router.get("/{equipment_id}", response_model=EquipmentOut)
def get_equipment(
    equipment_id: int,
    db: Session = Depends(get_db),
    _=Depends(requires("viewer")),
):
    eq = db.get(Equipment, equipment_id)
    if eq is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Equipment not found")
    return eq


@router.patch("/{equipment_id}", response_model=EquipmentOut)
def patch_equipment(
    equipment_id: int,
    body: EquipmentPatch,
    db: Session = Depends(get_db),
    current_user: User = Depends(requires("operator")),
):
    eq = db.get(Equipment, equipment_id)
    if eq is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Equipment not found")

    data = body.model_dump(exclude_unset=True)
    new_status = data.pop("status", None)
    clear_override = data.pop("clear_manual_override", False)

    if "utc_id" in data and data["utc_id"] is not None:
        utc = db.get(UTC, data["utc_id"])
        if utc is None or utc.site_id != eq.site_id:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "utc_id must belong to the same site"
            )

    for k, v in data.items():
        setattr(eq, k, v)

    if new_status is not None and new_status != eq.status:
        db.add(
            StatusEvent(
                subject_kind="equipment",
                subject_id=eq.id,
                old_state=eq.status,
                new_state=new_status,
                source="manual",
                actor_user_id=current_user.id,
            )
        )
        eq.status = new_status
        eq.manual_status_override = True

    if clear_override:
        eq.manual_status_override = False

    db.flush()
    recompute_service_status_for_equipment(db, eq.id)
    return eq


@router.delete("/{equipment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_equipment(
    equipment_id: int,
    db: Session = Depends(get_db),
    _=Depends(requires("admin")),
):
    eq = db.get(Equipment, equipment_id)
    if eq is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Equipment not found")
    db.delete(eq)
