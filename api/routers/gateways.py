"""Gateway CRUD — per-site uplink equipment (ISP, modem, satellite)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from db import get_db
from deps import requires
from models import Gateway, Site, StatusEvent, User
from schemas import GatewayIn, GatewayOut, GatewayPatch

router = APIRouter(tags=["gateways"])


@router.get("/sites/{site_id}/gateways", response_model=list[GatewayOut])
def list_site_gateways(
    site_id: int,
    db: Session = Depends(get_db),
    _=Depends(requires("viewer")),
):
    if db.get(Site, site_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Site not found")
    return (
        db.query(Gateway)
        .filter(Gateway.site_id == site_id)
        .order_by(Gateway.name)
        .all()
    )


@router.post(
    "/sites/{site_id}/gateways",
    response_model=GatewayOut,
    status_code=status.HTTP_201_CREATED,
)
def create_gateway(
    site_id: int,
    body: GatewayIn,
    db: Session = Depends(get_db),
    _=Depends(requires("operator")),
):
    if db.get(Site, site_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Site not found")
    gw = Gateway(site_id=site_id, **body.model_dump())
    db.add(gw)
    db.flush()
    return gw


@router.get("/gateways", response_model=list[GatewayOut])
def list_all_gateways(
    db: Session = Depends(get_db),
    _=Depends(requires("viewer")),
):
    return db.query(Gateway).order_by(Gateway.site_id, Gateway.name).all()


@router.patch("/gateways/{gateway_id}", response_model=GatewayOut)
def patch_gateway(
    gateway_id: int,
    body: GatewayPatch,
    db: Session = Depends(get_db),
    current_user: User = Depends(requires("operator")),
):
    gw = db.get(Gateway, gateway_id)
    if gw is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Gateway not found")

    data = body.model_dump(exclude_unset=True)
    new_status = data.pop("status", None)

    for k, v in data.items():
        setattr(gw, k, v)

    if new_status is not None and new_status != gw.status:
        db.add(
            StatusEvent(
                subject_kind="gateway",
                subject_id=gw.id,
                old_state=gw.status,
                new_state=new_status,
                source="manual",
                actor_user_id=current_user.id,
            )
        )
        gw.status = new_status

    db.flush()
    db.refresh(gw)
    return gw


@router.delete("/gateways/{gateway_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_gateway(
    gateway_id: int,
    db: Session = Depends(get_db),
    _=Depends(requires("operator")),
):
    gw = db.get(Gateway, gateway_id)
    if gw is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Gateway not found")
    db.delete(gw)
