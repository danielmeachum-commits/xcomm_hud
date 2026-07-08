"""Validation endpoint for a single (service × gateway) matrix cell.

Cells materialize lazily on first write — the row is created if the pair
is legitimate (same site, service enables the gateway's PACE tier) and
the hard invariants R10 (down/offline lock) and R11 (cell ≤ local) hold.
Cascade behaviour driven by gateway or service validation lives on those
routers; this endpoint is only for the operator manually setting one cell.
"""

from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy.orm import Session

import datetime

from db import get_db
from deps import get_current_workspace, requires
from effective import STATUS_RANK, effective_cell_status
from rules_engine import emit_trigger
from models import (
    Gateway,
    Service,
    ServiceGatewayStatus,
    Site,
    User,
    Workspace,
)
from pubsub import notify
from schemas import ServiceGatewayStatusOut, ServiceGatewayStatusValidateIn

router = APIRouter(prefix="/services", tags=["service-gateway-status"])


def _rank(s: str) -> int:
    return STATUS_RANK.get(s, 0)


def _cell_out(
    db: Session, cell: ServiceGatewayStatus, service: Service, gateway: Gateway
) -> ServiceGatewayStatusOut:
    out = ServiceGatewayStatusOut.model_validate(cell)
    out.effective_status = effective_cell_status(
        cell.status, service.status, gateway.status
    )
    if cell.validated_by_user_id is not None:
        u = db.get(User, cell.validated_by_user_id)
        if u:
            out.validated_by_username = u.username
    return out


def _resolve_pair(
    db: Session, service_id: int, gateway_id: int, workspace: Workspace
) -> tuple[Service, Gateway]:
    service = db.get(Service, service_id)
    if service is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Service not found")
    site = db.get(Site, service.site_id)
    if site is None or site.workspace_id != workspace.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Service not found")
    gw = db.get(Gateway, gateway_id)
    if gw is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Gateway not found")
    if gw.site_id != service.site_id:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Gateway is not on the same site as the service",
        )
    if gw.pace not in (service.enabled_pace or []):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Service does not enable this gateway's PACE tier ({gw.pace})",
        )
    return service, gw


def _reject_invalid_write(
    new_status: str, service: Service, gateway: Gateway
) -> None:
    """Hard invariants — reject writes that would violate R10 or R11.

    R10: while the gateway or the local service is down/offline, the only
    permissible cell states are `unknown` (means "I don't know") or the
    matching cascaded value. Setting a cell to `up` while a gateway is
    down would misrepresent reality.

    R11: the cell can't be better than the local service status. `unknown`
    on either side is exempt (no ordering constraint).
    """
    if gateway.status in ("down", "offline"):
        if new_status not in ("unknown", gateway.status):
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                (
                    f"Gateway is {gateway.status}; cell can only be "
                    f"{gateway.status} or unknown."
                ),
            )
        return
    if service.status in ("down", "offline"):
        if new_status not in ("unknown", service.status):
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                (
                    f"Local service is {service.status}; cell can only be "
                    f"{service.status} or unknown."
                ),
            )
        return
    if new_status == "unknown" or service.status == "unknown":
        return
    if _rank(new_status) < _rank(service.status):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            (
                f"Cell status ({new_status}) cannot be better than local "
                f"service status ({service.status})."
            ),
        )


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


@router.post(
    "/{service_id}/gateways/{gateway_id}/validate",
    response_model=ServiceGatewayStatusOut,
)
def validate_cell(
    service_id: int,
    gateway_id: int,
    body: ServiceGatewayStatusValidateIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(requires("operator")),
):
    service, gw = _resolve_pair(db, service_id, gateway_id, workspace)
    _reject_invalid_write(body.status, service, gw)

    cell = (
        db.query(ServiceGatewayStatus)
        .filter(
            ServiceGatewayStatus.service_id == service_id,
            ServiceGatewayStatus.gateway_id == gateway_id,
        )
        .one_or_none()
    )
    prev = cell.status if cell else "unknown"

    when = body.validated_at or _now()
    emit_trigger(
        db,
        "cell.status_changed",
        {
            "service_id": service.id,
            "gateway_id": gw.id,
            "service_name": service.name,
            "gateway_name": gw.name,
            "prev_status": prev,
            "new_status": body.status,
            "source_flow": "validate",
            "note": body.note,
            "user_id": current_user.id,
            "username": current_user.username,
            "occurred_at": when,
        },
        workspace_id=workspace.id,
    )

    if cell is None:
        cell = ServiceGatewayStatus(
            service_id=service.id,
            gateway_id=gw.id,
            status=body.status,
            validated_at=when,
            validated_by_user_id=current_user.id,
        )
        db.add(cell)
    else:
        cell.status = body.status
        cell.validated_at = when
        cell.validated_by_user_id = current_user.id

    db.flush()
    db.refresh(cell)
    notify(background_tasks)
    return _cell_out(db, cell, service, gw)
