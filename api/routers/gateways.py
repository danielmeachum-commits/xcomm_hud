"""Gateway CRUD + validation + reorder."""

from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from sqlalchemy import case as sql_case

import datetime

from db import get_db
from deps import get_current_workspace, requires
from effective import reset_cells_for_gateway
from equipment_status import refresh_derived, resolve_status
from models import Gateway, Service, Site, User, Workspace
from pubsub import notify
from rules_engine import emit_trigger
from schemas import (
    GatewayIn,
    GatewayOut,
    GatewayPatch,
    GatewayValidateIn,
    StatusModeIn,
)


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)

router = APIRouter(tags=["gateways"])


def _pace_order():
    return sql_case(
        (Gateway.pace == "primary", 0),
        (Gateway.pace == "alternate", 1),
        (Gateway.pace == "contingency", 2),
        (Gateway.pace == "emergency", 3),
        else_=4,
    )


def _gateway_out(db: Session, gw: Gateway) -> GatewayOut:
    out = GatewayOut.model_validate(gw)
    out.reported_status = gw.status
    out.status = resolve_status(
        gw.status, gw.status_mode, gw.derived_status,
        gw.validated_at, gw.derived_changed_at,
    )
    if gw.validated_by_user_id is not None:
        u = db.get(User, gw.validated_by_user_id)
        if u:
            out.validated_by_username = u.username
    return out


def _site_in_workspace(db: Session, site_id: int, workspace: Workspace) -> Site:
    site = db.get(Site, site_id)
    if site is None or site.workspace_id != workspace.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Site not found")
    return site


def _gateway_in_workspace(
    db: Session, gateway_id: int, workspace: Workspace
) -> Gateway:
    gw = db.get(Gateway, gateway_id)
    if gw is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Gateway not found")
    site = db.get(Site, gw.site_id)
    if site is None or site.workspace_id != workspace.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Gateway not found")
    return gw


@router.get("/sites/{site_id}/gateways", response_model=list[GatewayOut])
def list_site_gateways(
    site_id: int,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("viewer")),
):
    _site_in_workspace(db, site_id, workspace)
    rows = (
        db.query(Gateway)
        .filter(Gateway.site_id == site_id)
        .order_by(_pace_order(), Gateway.display_order, Gateway.name)
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
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("operator")),
):
    _site_in_workspace(db, site_id, workspace)
    max_order = (
        db.query(Gateway)
        .filter(Gateway.site_id == site_id)
        .order_by(Gateway.display_order.desc())
        .first()
    )
    next_order = (max_order.display_order + 1) if max_order else 0
    gw = Gateway(site_id=site_id, display_order=next_order, **body.model_dump())
    db.add(gw)
    db.flush()
    notify(background_tasks)
    return _gateway_out(db, gw)


@router.get("/gateways", response_model=list[GatewayOut])
def list_all_gateways(
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("viewer")),
):
    rows = (
        db.query(Gateway)
        .join(Site, Site.id == Gateway.site_id)
        .filter(Site.workspace_id == workspace.id)
        .order_by(Gateway.site_id, _pace_order(), Gateway.display_order, Gateway.name)
        .all()
    )
    return [_gateway_out(db, g) for g in rows]


@router.patch("/gateways/{gateway_id}", response_model=GatewayOut)
def patch_gateway(
    gateway_id: int,
    body: GatewayPatch,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("operator")),
):
    gw = _gateway_in_workspace(db, gateway_id, workspace)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(gw, k, v)
    db.flush()
    db.refresh(gw)
    notify(background_tasks)
    return _gateway_out(db, gw)


@router.post("/gateways/{gateway_id}/validate", response_model=GatewayOut)
def validate_gateway(
    gateway_id: int,
    body: GatewayValidateIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(requires("operator")),
):
    gw = _gateway_in_workspace(db, gateway_id, workspace)
    when = body.validated_at or _now()
    emit_trigger(
        db,
        "gateway.status_changed",
        {
            "gateway_id": gw.id,
            "gateway_name": gw.name,
            "prev_status": gw.status,
            "new_status": body.status,
            "note": body.note,
            "user_id": current_user.id,
            "username": current_user.username,
            "occurred_at": when,
        },
        workspace_id=workspace.id,
    )
    gw.status = body.status
    gw.validated_at = when
    gw.validated_by_user_id = current_user.id
    # R8/R9/R10 cascade — cell states for this gateway snap to the derived
    # value (unvalidated for active/degraded/setup, ready for ready, matching
    # down/offline). Skipped when the operator unchecked "cascade to cells"
    # in the validation dialog. Cascades are transactional integrity logic,
    # so they stay in code rather than in user-editable rules — but each
    # cell that actually changed emits its own trigger (source_flow
    # "cascade") so the audit trail covers cascaded changes too.
    # Never in derived mode. `reset_cells_for_gateway` is the destructive
    # half of the cascade — it blanks every cell for this gateway AND nulls
    # validated_at/validated_by, discarding who signed for each path. At
    # operator frequency that is a deliberate "re-validate these"; at
    # equipment-flap frequency it is the matrix-wiping behaviour reason 1 in
    # equipment_status.py describes. Read-time R10 still applies on display.
    if body.cascade and gw.status_mode != "derived":
        changed = reset_cells_for_gateway(db, gw.id, body.status)
        # Cells key on deliveries; the display name lives on the identity.
        service_names = {
            d.id: svc.name
            for d, svc in db.query(ServiceDelivery, Service)
            .join(Service, Service.id == ServiceDelivery.service_id)
            .filter(
                ServiceDelivery.id.in_(
                    {cell.service_delivery_id for cell, _, _ in changed}
                )
            )
        } if changed else {}
        for cell, prev, new in changed:
            emit_trigger(
                db,
                "cell.status_changed",
                {
                    "service_id": cell.service_delivery_id,
                    "gateway_id": gw.id,
                    "service_name": service_names.get(cell.service_delivery_id),
                    "gateway_name": gw.name,
                    "prev_status": prev,
                    "new_status": new,
                    "source_flow": "cascade",
                    "note": f"Cascaded from gateway validation ({gw.name} → {body.status})",
                    "user_id": current_user.id,
                    "username": current_user.username,
                    "occurred_at": when,
                },
                workspace_id=workspace.id,
            )
    db.flush()
    db.refresh(gw)
    notify(background_tasks)
    return _gateway_out(db, gw)


@router.post("/gateways/{gateway_id}/move", response_model=GatewayOut)
def move_gateway(
    gateway_id: int,
    background_tasks: BackgroundTasks,
    direction: str = Query(..., pattern="^(up|down)$"),
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("operator")),
):
    gw = _gateway_in_workspace(db, gateway_id, workspace)

    siblings = (
        db.query(Gateway)
        .filter(Gateway.site_id == gw.site_id)
        .order_by(Gateway.display_order, Gateway.id)
        .all()
    )
    idx = next((i for i, g in enumerate(siblings) if g.id == gw.id), None)
    if idx is None:
        return _gateway_out(db, gw)

    swap_idx = idx - 1 if direction == "up" else idx + 1
    if swap_idx < 0 or swap_idx >= len(siblings):
        return _gateway_out(db, gw)

    other = siblings[swap_idx]
    gw.display_order, other.display_order = other.display_order, gw.display_order
    db.flush()
    db.refresh(gw)
    notify(background_tasks)
    return _gateway_out(db, gw)


@router.delete("/gateways/{gateway_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_gateway(
    gateway_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("operator")),
):
    gw = _gateway_in_workspace(db, gateway_id, workspace)
    db.delete(gw)
    notify(background_tasks)


@router.post("/gateways/{gateway_id}/status-mode", response_model=GatewayOut)
def set_gateway_status_mode(
    gateway_id: int,
    body: StatusModeIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("operator")),
):
    """Switch a gateway between operator-reported and chain-derived status.

    Independent of any delivery's mode. Turning this on also turns OFF the
    cell-blanking cascade for this gateway — see the note in validate.
    """
    gw = _gateway_in_workspace(db, gateway_id, workspace)
    gw.status_mode = body.status_mode
    if body.status_mode == "derived":
        refresh_derived(db, [], [gw.id], _now())
    db.flush()
    notify(background_tasks)
    return _gateway_out(db, gw)
