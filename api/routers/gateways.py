"""Gateway CRUD + validation endpoint."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from db import get_db
from deps import requires
from models import Gateway, Site, User, Validation
from schemas import GatewayIn, GatewayOut, GatewayPatch, GatewayValidateIn

router = APIRouter(tags=["gateways"])


def _gateway_out(db: Session, gw: Gateway) -> GatewayOut:
    out = GatewayOut.model_validate(gw)
    if gw.validated_by_user_id is not None:
        u = db.get(User, gw.validated_by_user_id)
        if u:
            out.validated_by_username = u.username
    return out


@router.get("/sites/{site_id}/gateways", response_model=list[GatewayOut])
def list_site_gateways(
    site_id: int,
    db: Session = Depends(get_db),
    _=Depends(requires("viewer")),
):
    if db.get(Site, site_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Site not found")
    rows = (
        db.query(Gateway)
        .filter(Gateway.site_id == site_id)
        .order_by(Gateway.name)
        .all()
    )
    return [_gateway_out(db, g) for g in rows]


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
    return _gateway_out(db, gw)


@router.get("/gateways", response_model=list[GatewayOut])
def list_all_gateways(
    db: Session = Depends(get_db),
    _=Depends(requires("viewer")),
):
    rows = db.query(Gateway).order_by(Gateway.site_id, Gateway.name).all()
    return [_gateway_out(db, g) for g in rows]


@router.patch("/gateways/{gateway_id}", response_model=GatewayOut)
def patch_gateway(
    gateway_id: int,
    body: GatewayPatch,
    db: Session = Depends(get_db),
    _=Depends(requires("operator")),
):
    gw = db.get(Gateway, gateway_id)
    if gw is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Gateway not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(gw, k, v)
    db.flush()
    db.refresh(gw)
    return _gateway_out(db, gw)


@router.post("/gateways/{gateway_id}/validate", response_model=GatewayOut)
def validate_gateway(
    gateway_id: int,
    body: GatewayValidateIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(requires("operator")),
):
    gw = db.get(Gateway, gateway_id)
    if gw is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Gateway not found")
    prev = gw.status
    kwargs = dict(
        subject_kind="gateway",
        subject_id=gw.id,
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
    gw.status = body.status
    gw.validated_at = v.validated_at
    gw.validated_by_user_id = current_user.id
    db.flush()
    db.refresh(gw)
    return _gateway_out(db, gw)


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
